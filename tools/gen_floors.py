#!/usr/bin/env python3
"""Gem Guardians floor generator.

config/balance.json + enemies.json + obstacles.json -> config/floors.json (+ floors.csv)
The game ports this file to JS (src/core/balance/floorGen.js) and must produce the
same output for floors 1..100 (test: compare with floors.json). Floors > 100 are
generated at runtime with the same code.

Rules for an exact JS port:
- rng = mulberry32(seed) with seed = floor * 7919 (32-bit math, see below)
- rounding = floor(x + 0.5) (NOT Python round / banker's rounding)
"""
import json, math, os, sys, csv

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = os.path.join(HERE, '..', 'config')


def load(name):
    with open(os.path.join(CFG, name), encoding='utf-8') as fh:
        return json.load(fh)


def rnd(x):
    return int(math.floor(x + 0.5))


def rdec(x, d):
    m = 10 ** d
    return math.floor(x * m + 0.5) / m


def mulberry32(seed):
    state = [seed & 0xFFFFFFFF]

    def nxt():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296
    return nxt


def ramp(spec, f, integer=True):
    if f < spec['from']:
        return 0
    v = spec['start'] + spec['perFloor'] * (f - spec['from'])
    v = max(spec['min'], min(spec['max'], v))
    if 'decimals' in spec:
        m = 10 ** spec['decimals']
        return math.floor(v * m + 0.5) / m
    return rnd(v) if integer else v


def scaling(B, f):
    s = B['scaling']
    return {
        'hpMul': rdec(s['hpGrowth'] ** (f - 1), 4),
        'wallDmgMul': rdec(s['wallDmgGrowth'] ** (f - 1), 4),
        'speedMul': rdec(min(s['speedCap'], 1 + s['speedPerFloor'] * (f - 1)), 4),
        'defAdd': (f - 1) // s['defEvery'],
        'goldMul': rdec(s['goldGrowth'] ** (f - 1), 4),
    }


def wall_hp(B, f):
    w = B['wall']
    return rnd(w['baseHp'] * (1 + w['hpGrowthPerFloor'] * (f - 1)))


def pick_weighted(rng, items):
    total = sum(w for _, w in items)
    r = rng() * total
    for k, w in items:
        r -= w
        if r < 0:
            return k
    return items[-1][0]


def monsters(E):
    """monster id -> merged stats (role stats + monster overrides)."""
    out = {}
    for mid, m in E['monsters'].items():
        d = dict(E['roles'].get(m['role'], {}))
        d.update({k: v for k, v in m.items() if k in ('hp', 'def', 'travelTime', 'wallDmg', 'gold', 'threat', 'weight', 'unlockFloor')})
        d['role'] = m['role']
        out[mid] = d
    return out


def chapter_of(E, f):
    ch = E['chapters']
    return ch[((f - 1) // 10) % len(ch)]


def first_seen(E):
    """monster -> first floor it can appear (first cycle of chapters)."""
    M = monsters(E)
    seen = {}
    for c in E['chapters']:
        for mid in c['pool']:
            f0 = max(c['from'], M[mid]['unlockFloor'])
            if f0 < c['from'] + 10 and (mid not in seen or f0 < seen[mid]):
                seen[mid] = f0
    return seen


def gen_floor(B, E, O, f):
    rng = mulberry32(f * 7919)
    fs = B['floorShape']
    types = monsters(E)
    chap = chapter_of(E, f)
    unlocked = [(k, types[k]['weight']) for k in chap['pool'] if types[k]['unlockFloor'] <= f]
    fs_map = first_seen(E)
    new_types = [k for k in chap['pool'] if fs_map.get(k) == f]

    tb = fs['threatBudget']
    budget = min(tb['max'], tb['base'] + tb['perFloor'] * (f - 1))
    n_waves = 1  # 웨이브 구분 없음: 층 전체가 한 줄
    is_boss = f % fs['bossEvery'] == 0
    is_elite = f % fs['eliteEvery']['mod'] == fs['eliteEvery']['rem']

    # wave budgets grow: weights 2..W+1
    wts = [i + 2 for i in range(n_waves)]
    budgets = [budget * w / sum(wts) for w in wts]
    if is_elite:
        budgets[-1] *= fs['eliteFloorBudgetMul']

    waves = []
    for wi, wb in enumerate(budgets):
        units = []
        last = wi == n_waves - 1
        if last and is_boss:
            wb = wb * fs['bossEscortRatio']
        spent = 0.0
        # introduce new monsters: first wave starts with up to 2 new kinds, 2 each
        if wi == 0:
            for nt in new_types[:2]:
                for _ in range(2):
                    units.append(nt)
                    spent += types[nt]['threat']
        while spent < wb - 0.25 or not units:
            room = wb - spent + 0.5
            cand = [(k, w) for k, w in unlocked if types[k]['threat'] <= room]
            if not cand:
                cand = [min(unlocked, key=lambda kw: types[kw[0]]['threat'])]
            u = pick_weighted(rng, cand)
            units.append(u)
            spent += types[u]['threat']

        # shuffle (Fisher-Yates)
        for i in range(len(units) - 1, 0, -1):
            j = int(math.floor(rng() * (i + 1)))
            units[i], units[j] = units[j], units[i]
        # elites
        elite_n = 0
        if last and is_elite:
            elite_n = 1 if f < 55 else 2
        ec = fs['eliteChanceFrom50']
        if f >= ec['from'] and not (last and (is_boss or is_elite)) and rng() < ec['chancePerFloor']:
            elite_n += 1
        # elite = upgrade a unit; remove other units worth the extra threat (budget-neutral)
        emul = fs['eliteMul']['hp']
        for i in range(elite_n):
            idx = len(units) - 1 - i * 2
            if idx < 0:
                break
            base = units[idx]
            units[idx] = base + '@elite'
            extra = types[base]['threat'] * (emul - 1)
            while extra > 0.25:
                j = next((k for k in range(len(units)) if '@' not in units[k]), None)
                if j is None or len(units) <= 2:
                    break
                extra -= types[units[j]]['threat']
                units.pop(j)
        if last and is_boss:
            units.append(chap['boss'] + '@boss')
        interval = max(fs['spawnInterval']['min'], fs['spawnInterval']['base'] + fs['spawnInterval']['perFloor'] * (f - 1))
        waves.append({'interval': rdec(interval, 3), 'spawns': units})

    # obstacles
    S = O['schedule']
    obs = {}
    c_init = ramp(S['crate']['initial'], f)
    c_every = ramp(S['crate']['everyMoves'], f)
    if c_init or c_every:
        obs['crate'] = {'initial': c_init, 'everyMoves': c_every, 'maxAlive': c_init + S['crate']['maxAliveExtra']}
    s_init = ramp(S['stone']['initial'], f)
    s_every = ramp(S['stone']['everyMoves'], f)
    if s_init or s_every:
        obs['stone'] = {'initial': s_init, 'everyMoves': s_every, 'maxAlive': s_init + S['stone']['maxAliveExtra']}
    tb_every = ramp(S['timeBomb']['everyMoves'], f)
    if tb_every:
        timer = ramp(S['timeBomb']['timer'], f)
        if is_boss:
            timer = max(4, timer + S['bossOverride']['timeBomb.timer'])
        obs['timeBomb'] = {
            'initial': 0, 'everyMoves': tb_every, 'maxAlive': ramp(S['timeBomb']['maxAlive'], f),
            'timer': timer, 'wallDamagePct': ramp(S['timeBomb']['wallDamagePct'], f),
        }
    # board cap: trim initial occupants
    cap = O['boardCap']
    occ = sum(o['initial'] for k, o in obs.items() if O['types'][k]['layer'] == 'occupant')
    while occ > cap:
        for k in ('crate', 'stone'):
            if k in obs and obs[k]['initial'] > 0 and occ > cap:
                obs[k]['initial'] -= 1
                occ -= 1

    tag = 'boss' if is_boss else ('elite' if is_elite else 'normal')
    return {
        'floor': f, 'tag': tag, 'chapter': chap['name'],
        'wallHp': wall_hp(B, f),
        'scaling': scaling(B, f),
        'spawnInterval': waves[0]['interval'],
        'totalEnemies': len(waves[0]['spawns']),
        'spawns': waves[0]['spawns'],
        'obstacles': obs,
    }


def unit_stats(B, E, floor, spawn):
    """Final stats of one spawn entry on a floor (shared with sim)."""
    typ, _, rank = spawn.partition('@')
    t = monsters(E)[typ]
    sc = floor['scaling']
    mul = {'hp': 1, 'wallDmg': 1, 'def': 0, 'speed': 1, 'gold': 1}
    if rank == 'elite':
        mul = B['floorShape']['eliteMul']
    elif rank == 'boss':
        mul = B['floorShape']['bossMul']
    if rank == 'boss':
        return {
            'type': typ, 'rank': 'boss',
            'hp': rnd(mul['hpBase'] * sc['hpMul']),
            'def': sc['defAdd'] + mul['def'],
            'speed': (1.0 / mul['travelTime']) * sc['speedMul'],
            'wallDmg': rnd(mul['wallDmgBase'] * sc['wallDmgMul']),
            'gold': rnd(mul['goldBase'] * sc['goldMul']),
        }
    return {
        'type': typ, 'rank': rank or 'normal',
        'hp': rnd(t['hp'] * sc['hpMul'] * mul['hp']),
        'def': t['def'] + sc['defAdd'] + mul['def'],
        'speed': (1.0 / t['travelTime']) * sc['speedMul'] * mul['speed'],
        'wallDmg': rnd(t['wallDmg'] * sc['wallDmgMul'] * mul['wallDmg']),
        'gold': rnd(t['gold'] * sc['goldMul'] * mul['gold']),
    }


def main(n=100):
    B, E, O = load('balance.json'), load('enemies.json'), load('obstacles.json')
    floors = [gen_floor(B, E, O, f) for f in range(1, n + 1)]
    out = {'_doc': 'tools/gen_floors.py가 생성. 직접 고치지 말고 balance/enemies/obstacles.json을 고친 뒤 다시 생성. 101층부터는 게임이 같은 규칙으로 생성.',
           'version': B['version'], 'floors': floors}
    with open(os.path.join(CFG, 'floors.json'), 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    return floors


if __name__ == '__main__':
    fl = main()
    print('floors', len(fl))
