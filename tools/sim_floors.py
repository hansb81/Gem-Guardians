#!/usr/bin/env python3
"""Rough balance check for floors 1..100 (design tool, not game code).

- Economy: gold from first clears (kills + clear bonus) is spent on the cheapest
  tower level each time -> expected average tower level when entering floor f.
- Battle: enemies walk, towers hit the front enemy. The player makes a move every
  playerModel.secondsPerMove. Auto attack only if tower.autoAttack.enabled.
- Obstacles: puzzle efficiency x (1 - 0.02 * occupants); time bombs explode with
  probability BOMB_MISS (active player) and hit the wall.
Writes ../floors.csv and prints a summary.
"""
import json, os, math, random, csv, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_floors import load, unit_stats, rnd

HERE = os.path.dirname(os.path.abspath(__file__))
B, E, O = load('balance.json'), load('enemies.json'), load('obstacles.json')
FLOORS = load('floors.json')['floors']
T = B['tower']
PM = B['playerModel']
BOMB_MISS = 0.15
DT = 0.05


def atk_at(level):
    return T['baseAtk'] * T['atkGrowthPerLevel'] ** (level - 1)


def level_cost(level):  # cost to go level -> level+1
    c = T['levelCost']
    return rnd(c['base'] * c['growth'] ** (level - 1))


def sample(rng, table):
    r = rng.random()
    for v, p in table:
        r -= p
        if r < 0:
            return v
    return table[-1][0]


def simulate(floor, levels, active, seed=1, power=1.0):
    rng = random.Random(seed * 1000 + floor['floor'])
    wall_max = floor['wallHp']
    wall = float(wall_max)
    atks = [atk_at(l) * power for l in levels]
    occupants = sum(o.get('initial', 0) for k, o in floor['obstacles'].items() if O['types'][k]['layer'] == 'occupant')
    eff = 1 - 0.02 * occupants
    tb = floor['obstacles'].get('timeBomb')
    t = 0.0
    moves = 0
    next_move = 1.0
    auto_cd = [0.2 * i for i in range(5)]
    for wi, wave in enumerate([{'spawns': floor['spawns'], 'interval': floor['spawnInterval']}]):
        queue = [unit_stats(B, E, floor, s) for s in wave['spawns']]
        alive = []
        spawn_t = t
        while queue or alive:
            t += DT
            if t > 600:
                return False, wall / wall_max, t
            while queue and t >= spawn_t:
                u = queue.pop(0)
                u['x'] = 1.0
                u['atkcd'] = 0.0
                alive.append(u)
                spawn_t += wave['interval']
            for u in alive:
                if u['x'] > 0:
                    u['x'] = max(0.0, u['x'] - u['speed'] * DT)
                else:
                    u['atkcd'] -= DT
                    if u['atkcd'] <= 0:
                        wall -= u['wallDmg']
                        u['atkcd'] += E['attackInterval']
            if wall <= 0:
                return False, 0.0, t

            def front():
                return min(alive, key=lambda u: u['x']) if alive else None
            # auto attack
            for i in (range(5) if T['autoAttack'].get('enabled', True) else ()):
                auto_cd[i] -= DT
                if auto_cd[i] <= 0:
                    auto_cd[i] += 1.0 / T['autoAttack']['shotsPerSec']
                    f = front()
                    if f and f['x'] <= T['autoAttack']['range']:
                        f['hp'] -= max(1, atks[i] * T['autoAttack']['ratio'] - f['def'])
            # puzzle
            if active and t >= next_move:
                next_move += PM['secondsPerMove']
                moves += 1
                k = sample(rng, PM['colorsPerMove'])
                c = sample(rng, PM['cascade'])
                colors = rng.sample(range(5), k)
                for col in colors:
                    n = sample(rng, PM['gemsPerColor'])
                    f = front()
                    if f:
                        dmg = atks[col] * n * eff * (1 + T['puzzleShot']['cascadeBonus'] * (c - 1)) - f['def']
                        f['hp'] -= max(1, dmg)
                if tb and moves % tb['everyMoves'] == 0 and rng.random() < BOMB_MISS:
                    wall -= wall_max * tb['wallDamagePct']
                    if wall <= 0:
                        return False, 0.0, t
            alive = [u for u in alive if u['hp'] > 0]
    return True, wall / wall_max, t


def need_power(fl, levels, active, seeds=3):
    """Smallest atk multiplier that clears the floor for all seeds (1.0 = expected level)."""
    lo, hi = 0.02, 8.0
    def ok(m):
        return all(simulate(fl, levels, active, s, m)[0] for s in range(seeds))
    if not ok(hi):
        return 99.0
    for _ in range(12):
        mid = math.sqrt(lo * hi)
        if ok(mid):
            hi = mid
        else:
            lo = mid
    return hi


def fmt_ob(o):
    if not o:
        return ''
    return f"{o['initial']}" + (f" +1/{o['everyMoves']}moves" if o['everyMoves'] else '')


def main():
    levels = [1] * 5
    gold = 0
    rows = []
    for fl in FLOORS:
        f = fl['floor']
        # spend
        while True:
            i = min(range(5), key=lambda j: levels[j])
            c = level_cost(levels[i])
            if gold >= c and levels[i] < T['maxLevel']:
                gold -= c
                levels[i] += 1
            else:
                break
        avg = sum(levels) / 5
        wins_a, walls_a = 0, []
        for seed in range(5):
            w, r, _ = simulate(fl, levels, True, seed)
            wins_a += w; walls_a.append(r)
        need_a = need_power(fl, levels, True)
        units = [unit_stats(B, E, fl, s) for s in fl['spawns']]
        kill_gold = sum(u['gold'] for u in units)
        gold += kill_gold * (1 + B['economy']['clearBonusMul'])
        comp = {}
        for s in fl['spawns']:
            comp[s] = comp.get(s, 0) + 1
        boss = [u for u in units if u['rank'] == 'boss']
        ob = fl['obstacles']
        rows.append({
            'floor': f, 'tag': fl['tag'], 'chapter': fl['chapter'], 'enemies': len(units),
            'composition': ' '.join(f'{k}x{v}' for k, v in sorted(comp.items())),
            'hpMul': fl['scaling']['hpMul'], 'speedMul': fl['scaling']['speedMul'],
            'wallDmgMul': fl['scaling']['wallDmgMul'], 'defAdd': fl['scaling']['defAdd'],
            'totalEnemyHp': sum(u['hp'] for u in units),
            'bossHp': boss[0]['hp'] if boss else '',
            'wallHp': fl['wallHp'],
            'spawnInterval': fl['spawnInterval'],
            'crate': fmt_ob(ob.get('crate')),
            'stone': fmt_ob(ob.get('stone')),
            'timeBomb': f"1/{ob['timeBomb']['everyMoves']}moves timer{ob['timeBomb']['timer']} -{int(ob['timeBomb']['wallDamagePct']*1000)/10}%" if 'timeBomb' in ob else '',
            'killGold': kill_gold,
            'expTowerLevel': round(avg, 1), 'expTowerAtk': round(atk_at(avg), 1),
            'needPower': round(need_a, 2),
            'simWin': f'{wins_a}/5', 'simWallLeft': round(sum(walls_a) / 5, 2),
        })
    out = os.path.join(HERE, '..', 'floors.csv')
    with open(out, 'w', newline='', encoding='utf-8-sig') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        if r['floor'] in (1, 2, 3, 5, 8, 10, 11, 15, 20, 21, 25, 30, 31, 40, 45, 50, 55, 60, 70, 75, 80, 90, 95, 99, 100):
            print(r['floor'], r['tag'], r['enemies'], r['totalEnemyHp'], r['bossHp'], 'L', r['expTowerLevel'], r['simWin'], r['simWallLeft'], r['needPower'])
    return rows


if __name__ == '__main__':
    main()
