// 층 생성기. tools/gen_floors.py를 그대로 JS로 옮긴 것 - 같은 입력(balance/enemies/
// obstacles.json)에 같은 층 번호를 주면 항상 같은 결과가 나와야 한다(tests/floorGen.test.js가
// 1~100층을 config/floors.json과 deep-equal로 비교). 브라우저 API 사용 금지 - 데이터는
// 전부 인자로 받는다(로드는 src/game 쪽 책임).
import { createRng } from '../rng.js';

export function rnd(x) {
  return Math.floor(x + 0.5);
}

export function rdec(x, d) {
  const m = 10 ** d;
  return Math.floor(x * m + 0.5) / m;
}

function ramp(spec, f) {
  if (f < spec.from) return 0;
  let v = spec.start + spec.perFloor * (f - spec.from);
  v = Math.max(spec.min, Math.min(spec.max, v));
  if (spec.decimals != null) {
    const m = 10 ** spec.decimals;
    return Math.floor(v * m + 0.5) / m;
  }
  return rnd(v);
}

function scaling(B, f) {
  const s = B.scaling;
  return {
    hpMul: rdec(s.hpGrowth ** (f - 1), 4),
    wallDmgMul: rdec(s.wallDmgGrowth ** (f - 1), 4),
    speedMul: rdec(Math.min(s.speedCap, 1 + s.speedPerFloor * (f - 1)), 4),
    defAdd: Math.floor((f - 1) / s.defEvery),
    goldMul: rdec(s.goldGrowth ** (f - 1), 4),
  };
}

function wallHp(B, f) {
  const w = B.wall;
  return rnd(w.baseHp * (1 + w.hpGrowthPerFloor * (f - 1)));
}

function pickWeighted(rng, items) {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [k, w] of items) {
    r -= w;
    if (r < 0) return k;
  }
  return items[items.length - 1][0];
}

// 몬스터 id -> 역할 스탯 + 몬스터 자체 덮어쓰기(hp/def/travelTime/wallDmg/gold/threat/weight/unlockFloor).
function monsters(E) {
  const out = {};
  const OWN_KEYS = ['hp', 'def', 'travelTime', 'wallDmg', 'gold', 'threat', 'weight', 'unlockFloor'];
  for (const [mid, m] of Object.entries(E.monsters)) {
    const d = { ...(E.roles[m.role] ?? {}) };
    for (const k of OWN_KEYS) if (m[k] !== undefined) d[k] = m[k];
    d.role = m.role;
    out[mid] = d;
  }
  return out;
}

function chapterOf(E, f) {
  const ch = E.chapters;
  return ch[Math.floor((f - 1) / 10) % ch.length];
}

// 몬스터 -> 처음 등장하는 층(지역 1회전 안에서). chapters[].pool 순서대로.
function firstSeen(E) {
  const M = monsters(E);
  const seen = {};
  for (const c of E.chapters) {
    for (const mid of c.pool) {
      const f0 = Math.max(c.from, M[mid].unlockFloor);
      if (f0 < c.from + 10 && (seen[mid] === undefined || f0 < seen[mid])) seen[mid] = f0;
    }
  }
  return seen;
}

// 층 f의 구성(웨이브·적·방해요소 등장 수)을 생성한다. 1~100층은 game/loadBalanceData가
// 읽은 config/floors.json 결과를 그대로 쓰므로, 보통은 getFloor()를 통해서만 호출된다
// (101층부터는 매번 이 함수로 즉석 생성).
export function genFloor(B, E, O, f) {
  const rng = createRng(f * 7919);
  const fs = B.floorShape;
  const types = monsters(E);
  const chap = chapterOf(E, f);
  const unlocked = chap.pool.filter((k) => types[k].unlockFloor <= f).map((k) => [k, types[k].weight]);
  const fsMap = firstSeen(E);
  const newTypes = chap.pool.filter((k) => fsMap[k] === f);

  const tb = fs.threatBudget;
  const budget = Math.min(tb.max, tb.base + tb.perFloor * (f - 1));
  const nWaves = fs.waves.filter((w) => w.fromFloor <= f).at(-1).count;
  const isBoss = f % fs.bossEvery === 0;
  const isElite = f % fs.eliteEvery.mod === fs.eliteEvery.rem;

  const wts = Array.from({ length: nWaves }, (_, i) => i + 2);
  const sumWts = wts.reduce((a, b) => a + b, 0);
  const budgets = wts.map((w) => (budget * w) / sumWts);
  if (isElite) budgets[budgets.length - 1] *= fs.eliteFloorBudgetMul;

  const waves = [];
  for (let wi = 0; wi < budgets.length; wi++) {
    let wb = budgets[wi];
    const units = [];
    const last = wi === nWaves - 1;
    if (last && isBoss) wb = wb * fs.bossEscortRatio;

    let spent = 0;
    if (wi === 0) {
      for (const nt of newTypes.slice(0, 2)) {
        for (let i = 0; i < 2; i++) {
          units.push(nt);
          spent += types[nt].threat;
        }
      }
    }
    while (spent < wb - 0.25 || units.length === 0) {
      const room = wb - spent + 0.5;
      let cand = unlocked.filter(([k]) => types[k].threat <= room);
      if (cand.length === 0) {
        cand = [unlocked.reduce((min, kw) => (types[kw[0]].threat < types[min[0]].threat ? kw : min))];
      }
      const u = pickWeighted(rng, cand);
      units.push(u);
      spent += types[u].threat;
    }

    // Fisher-Yates(결정적 rng).
    for (let i = units.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [units[i], units[j]] = [units[j], units[i]];
    }

    let eliteN = 0;
    if (last && isElite) eliteN = f < 55 ? 1 : 2;
    const ec = fs.eliteChanceFrom50;
    if (f >= ec.from && !(last && (isBoss || isElite)) && rng() < ec.chancePerWave) eliteN += 1;

    const emul = fs.eliteMul.hp;
    for (let i = 0; i < eliteN; i++) {
      const idx = units.length - 1 - i * 2;
      if (idx < 0) break;
      const base = units[idx];
      units[idx] = `${base}@elite`;
      let extra = types[base].threat * (emul - 1);
      while (extra > 0.25) {
        const j = units.findIndex((u) => !u.includes('@'));
        if (j === -1 || units.length <= 2) break;
        extra -= types[units[j]].threat;
        units.splice(j, 1);
      }
    }

    if (last && isBoss) units.push(`${chap.boss}@boss`);

    const interval = Math.max(fs.spawnInterval.min, fs.spawnInterval.base + fs.spawnInterval.perFloor * (f - 1));
    waves.push({ interval: rdec(interval, 3), spawns: units });
  }

  const S = O.schedule;
  const obstacles = {};
  const cInit = ramp(S.crate.initial, f);
  const cEvery = ramp(S.crate.everyMoves, f);
  if (cInit || cEvery) obstacles.crate = { initial: cInit, everyMoves: cEvery, maxAlive: cInit + S.crate.maxAliveExtra };
  const sInit = ramp(S.stone.initial, f);
  const sEvery = ramp(S.stone.everyMoves, f);
  if (sInit || sEvery) obstacles.stone = { initial: sInit, everyMoves: sEvery, maxAlive: sInit + S.stone.maxAliveExtra };
  const tbEvery = ramp(S.timeBomb.everyMoves, f);
  if (tbEvery) {
    let timer = ramp(S.timeBomb.timer, f);
    if (isBoss) timer = Math.max(4, timer + S.bossOverride['timeBomb.timer']);
    obstacles.timeBomb = {
      initial: 0,
      everyMoves: tbEvery,
      maxAlive: ramp(S.timeBomb.maxAlive, f),
      timer,
      wallDamagePct: ramp(S.timeBomb.wallDamagePct, f),
    };
  }
  const cap = O.boardCap;
  let occ = Object.entries(obstacles).reduce((sum, [k, o]) => (O.types[k].layer === 'occupant' ? sum + o.initial : sum), 0);
  while (occ > cap) {
    for (const k of ['crate', 'stone']) {
      if (obstacles[k] && obstacles[k].initial > 0 && occ > cap) {
        obstacles[k].initial -= 1;
        occ -= 1;
      }
    }
  }

  const tag = isBoss ? 'boss' : isElite ? 'elite' : 'normal';
  return {
    floor: f,
    tag,
    chapter: chap.name,
    wallHp: wallHp(B, f),
    scaling: scaling(B, f),
    waveBreak: fs.waveBreak,
    waves,
    obstacles,
  };
}

// 1~100층은 floorsData(config/floors.json)에서 그대로, 101층부터는 genFloor로 즉석 생성.
export function getFloor(B, E, O, floorsData, f) {
  const cached = floorsData?.floors?.[f - 1];
  if (cached && cached.floor === f) return cached;
  return genFloor(B, E, O, f);
}

// "goblin" / "orc_warrior@elite" / "troll@boss" 같은 소환 문자열 -> 최종 스탯
// (tools/gen_floors.py의 unit_stats와 같은 결과). 보스는 종류와 상관없이 bossMul만 쓴다
// (방어는 층 방어 추가 + bossMul.def, 몬스터 자체 방어는 쓰지 않음).
export function unitStats(B, E, floor, spawn) {
  const at = spawn.indexOf('@');
  const type = at === -1 ? spawn : spawn.slice(0, at);
  const rank = at === -1 ? '' : spawn.slice(at + 1);
  const t = monsters(E)[type];
  const sc = floor.scaling;

  if (rank === 'boss') {
    const mul = B.floorShape.bossMul;
    return {
      type,
      rank: 'boss',
      hp: rnd(mul.hpBase * sc.hpMul),
      def: sc.defAdd + mul.def,
      speed: (1 / mul.travelTime) * sc.speedMul,
      wallDmg: rnd(mul.wallDmgBase * sc.wallDmgMul),
      gold: rnd(mul.goldBase * sc.goldMul),
    };
  }

  const mul = rank === 'elite' ? B.floorShape.eliteMul : { hp: 1, wallDmg: 1, def: 0, speed: 1, gold: 1 };
  return {
    type,
    rank: rank || 'normal',
    hp: rnd(t.hp * sc.hpMul * mul.hp),
    def: t.def + sc.defAdd + mul.def,
    speed: (1 / t.travelTime) * sc.speedMul * mul.speed,
    wallDmg: rnd(t.wallDmg * sc.wallDmgMul * mul.wallDmg),
    gold: rnd(t.gold * sc.goldMul * mul.gold),
  };
}

// floor.waves의 소환 문자열을 전투가 바로 쓸 수 있는 스탯 객체로 바꾼다(이름/애니메이션 같은
// 표시용 필드도 enemies.json에서 붙인다) - BattleState는 이 결과만 받고 balance/enemies.json을
// 모른다(src/battle은 core를 import하지 않으므로 이 변환은 항상 game 쪽에서 끝내둔다).
export function resolveFloorWaves(B, E, floor) {
  return floor.waves.map((w) => ({
    interval: w.interval,
    spawns: w.spawns.map((s) => {
      const stat = unitStats(B, E, floor, s);
      const m = E.monsters[stat.type];
      return { ...stat, name: m.name, anim: m.anim };
    }),
  }));
}
