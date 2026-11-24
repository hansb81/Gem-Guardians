// 정령 시스템(docs/spirits.md, config/spirits.json): 순수 계산(src/core/spirits), 저장·지급·장착(inventory),
// 전투 역할 5종(BattleState.setSpirits), 보스 보상·재물·랭킹 모드(BattleController). 숫자는 실제 config를 읽는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BattleState } from '../src/battle/battleState.js';
import { Inventory } from '../src/game/inventory.js';
import { migrateSave, SAVE_VERSION } from '../src/core/inventory/inventory.js';
import { createRng } from '../src/core/rng.js';
import { effectMul, everyN, levelUpCost, grantSpirit, rollBossSpirit, battleSpirits, ensureStartSpirit, bossSpiritBundle } from '../src/core/spirits/spirits.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../config/${name}`, import.meta.url), 'utf-8'));
const CFG = load('spirits.json');
const SKILLS = load('skills.json');
const COLORS = ['red', 'blue', 'yellow', 'green', 'purple']; // 수호자 순서(config/balance.json tower.towers)
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// ---------- 순수 계산 ----------
test('config: 30종, 속성마다 일반2·희귀1·영웅1·전설1·보조1, 역할별 필수 키', () => {
  const list = Object.entries(CFG.spirits);
  assert.equal(list.length, 30);
  for (const color of COLORS) {
    const mine = list.filter(([, s]) => s.element === color);
    const count = (f) => mine.filter(([, s]) => f(s)).length;
    assert.equal(count((s) => s.grade === 'common'), 2, color);
    assert.equal(count((s) => s.grade === 'epic'), 1, color);
    assert.equal(count((s) => s.grade === 'legend' && s.role === 'unique' && s.unique), 1, color);
    assert.equal(count((s) => s.grade === 'rare' && s.role === 'support' && s.support && s.value != null), 1, color);
    assert.equal(count((s) => s.grade === 'rare' && s.role !== 'support'), 1, color);
  }
  for (const [id, s] of list) assert.ok(['attack', 'element', 'amplify', 'guard', 'wealth', 'support', 'unique'].includes(s.role), id);
});

test('effectMul: 일반 1레벨 1별 비공명 = 1.0, 전설 30레벨 5별 공명 ≈ 3.10', () => {
  assert.equal(effectMul(CFG, 'fire_wisp', { lv: 1, star: 1 }, 'blue'), 1);
  close(effectMul(CFG, 'fire_wisp', { lv: 1, star: 1 }, 'red'), 1.25);
  close(effectMul(CFG, 'phoenix', { lv: 30, star: 5 }, 'red'), 1.6 * 1.29 * 1.2 * 1.25);
  assert.equal(effectMul(CFG, 'phoenix', { lv: 30, star: 5 }, 'red').toFixed(2), '3.10');
});

test('everyN: 별 3에서 5→4, 별 5에서 5→3, 최소 2', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((star) => everyN(CFG, 5, star)), [5, 5, 4, 4, 3]);
  assert.equal(everyN(CFG, 3, 5), 2);
  assert.equal(everyN(CFG, 2, 5), 2);
});

test('levelUpCost: 골드 = round(층 보상 x 0.25 x 1.06^(lv-1)), 정령석 = ceil(lv / 3)', () => {
  assert.deepEqual(levelUpCost(CFG, 1, 1000), { gold: 250, stones: 1 });
  assert.deepEqual(levelUpCost(CFG, 4, 1000), { gold: Math.round(250 * 1.06 ** 3), stones: 2 });
  assert.equal(levelUpCost(CFG, 29, 1000).stones, 10);
});

test('grantSpirit: 새로 얻음 / 별 +1 / 별 5 뒤에는 등급별 정령석', () => {
  const inv = new Inventory(null).data;
  assert.deepEqual(grantSpirit(CFG, inv, 'flame_fox'), { id: 'flame_fox', kind: 'new', stones: 0 });
  assert.deepEqual(inv.perm.spirits.flame_fox, { lv: 1, star: 1 });
  for (let star = 2; star <= 5; star++) assert.deepEqual(grantSpirit(CFG, inv, 'flame_fox'), { id: 'flame_fox', kind: 'star', stones: 0 });
  assert.equal(inv.perm.spirits.flame_fox.star, 5);
  assert.deepEqual(grantSpirit(CFG, inv, 'flame_fox'), { id: 'flame_fox', kind: 'stones', stones: CFG.dupeStones.rare });
  assert.equal(inv.perm.spirits.flame_fox.star, 5);
  assert.equal(inv.perm.spiritStones, 10);
});

test('rollBossSpirit: 10층 일반, 30층 희귀(보조 포함 풀), 50층 영웅, 같은 seed 같은 결과, 60층 이후는 가중 무작위', () => {
  const grade = (id) => CFG.spirits[id].grade;
  for (let seed = 1; seed <= 30; seed++) {
    assert.equal(grade(rollBossSpirit(CFG, 10, createRng(seed))), 'common');
    assert.equal(grade(rollBossSpirit(CFG, 30, createRng(seed))), 'rare');
    assert.equal(grade(rollBossSpirit(CFG, 50, createRng(seed))), 'epic');
    assert.equal(rollBossSpirit(CFG, 70, createRng(seed)), rollBossSpirit(CFG, 70, createRng(seed)));
  }
  const rares = new Set(Array.from({ length: 300 }, (_, i) => rollBossSpirit(CFG, 30, createRng(i + 1))));
  assert.ok([...rares].some((id) => CFG.spirits[id].role === 'support'), '희귀 풀에 보조 포함');
  const grades = new Set(Array.from({ length: 400 }, (_, i) => grade(rollBossSpirit(CFG, 60, createRng(i + 1)))));
  assert.ok(grades.has('common') && grades.has('rare') && grades.has('epic'));
});

// ---------- 저장·지급·장착 ----------
function makeInv(data = null, wallet = { gold: 0, diamonds: 0 }) {
  const inv = new Inventory(data, { wallet, clock: () => 1 });
  inv.initSpirits(CFG);
  return inv;
}

test('처음 시작: 시작 정령 1마리 + 첫 수호자 칸 장착, 두 번 불러도 한 번만', () => {
  const inv = makeInv();
  assert.deepEqual(inv.data.perm.spirits, { fire_wisp: { lv: 1, star: 1 } });
  assert.deepEqual(inv.spiritSlots(), ['fire_wisp', null, null, null, null]);
  assert.equal(inv.data.loadout.pendingSpirits, null);
  assert.equal(inv.spiritStones, 0);
  inv.initSpirits(CFG);
  assert.equal(inv.spirit('fire_wisp').star, 1);
  assert.equal(ensureStartSpirit(CFG, inv.data), null);
});

test('마이그레이션: v3 저장(totems 있음) -> v4, totems 삭제, 시작 정령 지급·장착, 다른 값 보존', () => {
  const v3 = {
    saveVersion: 3, gold: 77, diamonds: 5, floor: 12, bestFloor: 14, towerLevels: [3, 3, 3, 3, 3],
    inv: {
      items: { hammer: 4 },
      loadout: { hotbar: ['hammer', null, null, null], pendingHotbar: null, preFloor: { gold_coin: true }, totems: [] },
      perm: { skills: { red: 2 }, flags: ['slot4'], totems: {} },
      grantedTx: ['start:hammer', 'boss:10'],
      log: [],
    },
  };
  const out = migrateSave(structuredClone(v3), 100);
  assert.equal(out.saveVersion, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 4);
  assert.equal('totems' in out.inv.perm, false);
  assert.equal('totems' in out.inv.loadout, false);
  assert.deepEqual([out.gold, out.diamonds, out.floor, out.bestFloor, out.towerLevels], [77, 5, 12, 14, [3, 3, 3, 3, 3]]);
  assert.deepEqual(out.inv.items, { hammer: 4 });
  assert.deepEqual(out.inv.loadout.hotbar, ['hammer', null, null, null]);
  assert.deepEqual(out.inv.loadout.preFloor, { gold_coin: true });
  assert.deepEqual(out.inv.perm.skills, { red: 2 });
  assert.deepEqual(out.inv.perm.flags, ['slot4']);
  assert.ok(out.inv.grantedTx.includes('boss:10'));
  assert.equal(migrateSave(out, 200), out, '이미 v4면 그대로');
  // 시작 정령은 config를 읽은 뒤(playerState.initSpirits) 지급된다.
  const inv = makeInv(out.inv);
  assert.deepEqual(inv.data.perm.spirits, { fire_wisp: { lv: 1, star: 1 } });
  assert.equal(inv.spiritSlots()[0], 'fire_wisp');
  assert.equal(inv.count('hammer'), 4);
});

test('지급: txId 중복 방지, log 기록, 정령석 번들', () => {
  const inv = makeInv();
  const res = inv.grant({ spirits: ['ember_rat'], spiritStones: 5 }, { src: 'bossSpirit', txId: 'boss-spirit:10' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.delta, { spirits: [{ id: 'ember_rat', kind: 'new', stones: 0 }], spiritStones: 5 });
  assert.equal(inv.grant({ spirits: ['ember_rat'], spiritStones: 5 }, { src: 'bossSpirit', txId: 'boss-spirit:10' }).reason, 'duplicate');
  assert.equal(inv.spirit('ember_rat').star, 1);
  assert.equal(inv.spiritStones, 5);
  const last = inv.data.log[inv.data.log.length - 1];
  assert.deepEqual([last.src, last.tx], ['bossSpirit', 'boss-spirit:10']);
});

test('레벨업: 골드·정령석을 한 번에 차감, 하나라도 모자라면 변화 없음, 최대 레벨에서 실패', () => {
  const wallet = { gold: 1000, diamonds: 0 };
  const inv = makeInv(null, wallet);
  const cost = levelUpCost(CFG, 1, 1000); // 골드 250, 정령석 1
  assert.equal(inv.levelUpSpirit('fire_wisp', 1000).reason, 'noMoney', '정령석 0');
  assert.deepEqual([wallet.gold, inv.spiritStones, inv.spirit('fire_wisp').lv], [1000, 0, 1]);
  inv.grant({ spiritStones: 3 }, { src: 't' });
  wallet.gold = cost.gold - 1;
  assert.equal(inv.levelUpSpirit('fire_wisp', 1000).reason, 'noMoney', '골드 부족');
  assert.deepEqual([wallet.gold, inv.spiritStones, inv.spirit('fire_wisp').lv], [cost.gold - 1, 3, 1]);
  wallet.gold = 1000;
  assert.equal(inv.levelUpSpirit('fire_wisp', 1000).ok, true);
  assert.deepEqual([wallet.gold, inv.spiritStones, inv.spirit('fire_wisp').lv], [1000 - cost.gold, 3 - cost.stones, 2]);
  assert.equal(inv.data.log[inv.data.log.length - 1].src, 'spiritLevelUp');
  assert.equal(inv.levelUpSpirit('phoenix', 1000).reason, 'notOwned');
  inv.spirit('fire_wisp').lv = CFG.levelMax;
  wallet.gold = 1e12;
  inv.grant({ spiritStones: 99 }, { src: 't' });
  assert.equal(inv.levelUpSpirit('fire_wisp', 1000).reason, 'maxLevel');
  assert.equal(inv.spirit('fire_wisp').lv, CFG.levelMax);
});

test('장착: 같은 정령은 한 칸에만(맞바꿈), 없는 정령 불가, 층 중 변경은 다음 층부터', () => {
  const inv = makeInv();
  inv.grant({ spirits: ['ember_rat'] }, { src: 't' });
  assert.equal(inv.equipSpirit(1, 'phoenix').reason, 'notOwned');
  assert.equal(inv.equipSpirit(1, 'ember_rat').ok, true);
  assert.deepEqual(inv.spiritSlots(), ['fire_wisp', 'ember_rat', null, null, null]);
  assert.equal(inv.equipSpirit(1, 'fire_wisp').ok, true);
  assert.deepEqual(inv.spiritSlots(), ['ember_rat', 'fire_wisp', null, null, null], '자리 맞바꿈');
  assert.equal(inv.equipSpirit(3, 'fire_wisp').ok, true);
  assert.deepEqual(inv.spiritSlots(), ['ember_rat', null, null, 'fire_wisp', null], '빈 칸으로 옮기면 원래 칸은 빈다');
  assert.equal(inv.equipSpirit(0, null).ok, true);
  assert.deepEqual(inv.spiritSlots(), [null, null, null, 'fire_wisp', null]);

  inv.beginFloor();
  const res = inv.equipSpirit(0, 'ember_rat');
  assert.equal(res.pending, true);
  assert.deepEqual(inv.spiritSlots(), [null, null, null, 'fire_wisp', null], '층 중에는 그대로');
  assert.deepEqual(inv.pendingSpirits(), ['ember_rat', null, null, 'fire_wisp', null]);
  inv.endFloor();
  assert.deepEqual(inv.spiritSlots(), ['ember_rat', null, null, 'fire_wisp', null]);
  assert.equal(inv.pendingSpirits(), null);
});

// ---------- 전투 ----------
const enemy = (o = {}) => ({ type: 'e', rank: 'normal', name: 'E', hp: 100000, def: 0, speed: 0, wallDmg: 5, gold: 10, ...o });

function makeState({ enemies = [enemy()], attack = 100, skills = SKILLS, wallHp = 1000 } = {}) {
  const state = new BattleState({
    towersData: COLORS.map((c) => ({ id: `tower_${c}`, color: c, stats: { attack } })),
    resolvedFloor: { wallHp, interval: 0, spawns: enemies },
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: { towerAttack: 1e9, enemyHit: 1e9, enemyDie: 1e9, skillCast: 1e9, wallHealed: 1e9, spiritProc: 1e9 }, skills },
  });
  state.update(0);
  return state;
}

// slots = 수호자 순서의 { id, lv, star } 또는 null.
function equip(state, slots, seed = 1) {
  const owned = Object.fromEntries(slots.filter(Boolean).map((s) => [s.id, s]));
  const list = battleSpirits(CFG, slots.map((s) => s?.id ?? null), owned, COLORS);
  state.setSpirits(list, { roles: CFG.roles, rng: createRng(seed) });
  return list;
}

function fire(state, color, count = 1) {
  const shots = state.applyGemClear(color, count, 1);
  for (const ev of shots) state.resolveTowerAttack(ev);
  return shots;
}

const L1 = (id) => ({ id, lv: 1, star: 1 });

test('attack: N발째마다 추가 1발, 피해 = 공격력 x mul x 배율 - 방어, 색 효과 없음, 추가 사격은 발사 수에 안 셈', () => {
  const E = CFG.roles.attack.every;
  const skills = structuredClone(SKILLS);
  skills.colorEffects.appliesTo = 'all'; // 기본 사격에도 색 효과가 붙는 설정에서도 정령 사격에는 안 붙는다
  const state = makeState({ enemies: [enemy({ def: 7 })], skills });
  const [sp] = equip(state, [L1('fire_wisp'), null, null, null, null]);
  close(sp.mul, 1.25); // 불 정령 + 빨강 수호자 = 공명
  assert.equal(sp.every, E);
  let spiritShots = 0;
  for (let n = 1; n <= 12; n++) {
    const shots = fire(state, 'red');
    const extra = shots.filter((s) => s.spirit);
    spiritShots += extra.length;
    assert.equal(extra.length, n % E === 0 ? 1 : 0, `${n}발째`);
    if (extra.length) {
      assert.equal(extra[0].damage, Math.round(100 * CFG.roles.attack.mul * 1.25 - 7));
      assert.deepEqual([extra[0].towerIndex, extra[0].towerId, extra[0].isSpecial], [0, 'tower_red', false]);
    }
  }
  assert.equal(spiritShots, Math.floor(12 / E), '12발 동안 N의 배수째만(추가 사격은 발사 수에 안 센다)');
  assert.equal(state._shotCounts[0], 12);
  // 색 효과: 일반 사격 12발은 레드 범위(단일 적이라 없음)만, 정령 사격으로는 아무 효과도 안 걸린다 - 다른 색 수호자로 확인.
  const s2 = makeState({ skills });
  equip(s2, [null, null, null, null, { id: 'bone_crow', lv: 1, star: 1 }]);
  s2._shotCounts[4] = E - 1;
  const shots = s2.applyGemClear('purple', 1, 1);
  assert.equal(shots.length, 2);
  s2.resolveTowerAttack(shots[1]); // 정령 사격만 명중
  assert.equal(s2.enemies[0].effects.poison.stacks, 0, '정령 사격은 독을 걸지 않는다');
  s2.resolveTowerAttack(shots[0]);
  assert.equal(s2.enemies[0].effects.poison.stacks, 1, '일반 사격은 건다(appliesTo all)');
  // 다른 수호자의 사격은 세지 않는다. 특수 잼 몫(isSpecial)도 세지 않는다.
  fire(state, 'blue');
  state.applyGemClear('red', 1, 1, true);
  assert.equal(state._shotCounts[0], 12);
});

test('attack: 별 3이면 N이 1 줄고, 예약 피해로 죽을 적은 건너뛴다', () => {
  const state = makeState({ enemies: [enemy({ hp: 100 }), enemy()] });
  const [sp3] = equip(state, [{ id: 'fire_wisp', lv: 1, star: 3 }, null, null, null, null]);
  assert.equal(sp3.every, Math.max(2, CFG.roles.attack.every - 1));
  state._shotCounts[0] = sp3.every - 1;
  const shots = state.applyGemClear('red', 1, 1); // N발째: 일반 100 피해 -> 앞 적(HP 100)은 죽을 예정
  assert.equal(shots.length, 2);
  assert.equal(shots[0].targetEnemyId, state.enemies[0].id);
  assert.equal(shots[1].targetEnemyId, state.enemies[1].id, '정령 사격은 다음 적으로');
});

test('element: 확률 1이면 정령 속성 효과가 걸리고 spiritProc 이벤트, 같은 seed면 같은 결과', () => {
  const cfg = structuredClone(CFG);
  cfg.roles.element = { chance: 1, chanceCap: 1, procDmg: CFG.roles.element.procDmg };
  const state = makeState({ enemies: [enemy({ def: 10 })] });
  // 빨강 수호자에 얼음 속성 정령(눈송이 요정) -> 빨강 사격이 둔화를 건다.
  state.setSpirits(battleSpirits(cfg, ['snow_fairy', null, null, null, null], { snow_fairy: { lv: 1, star: 1 } }, COLORS), { roles: cfg.roles, rng: createRng(3) });
  const [shot] = fire(state, 'red');
  assert.equal(shot.damage, Math.round(100 * (1 + CFG.roles.element.procDmg) - 10), '발동한 발은 피해 +procDmg(방어 계산 전, 정령 배율 없음)');
  assert.ok(state.enemies[0].effects.slow.time > 0, '둔화');
  const proc = state.events.filter((e) => e.type === 'spiritProc');
  assert.deepEqual(proc.map((e) => [e.towerIndex, e.role, e.enemyId]), [[0, 'element', state.enemies[0].id]]);
  assert.equal(fire(state, 'blue')[0].damage, 90, '정령 없는 수호자는 그대로');
  assert.equal(state.events.filter((e) => e.type === 'spiritProc').length, 1);
  // 그 색 효과가 잠겨 있어도 피해 증가와 번쩍은 그대로, 색 효과만 없다.
  const locked = structuredClone(SKILLS);
  locked.unlocked.colorEffects.blue = false;
  const ls = makeState({ skills: locked });
  ls.setSpirits(battleSpirits(cfg, ['snow_fairy', null, null, null, null], { snow_fairy: { lv: 1, star: 1 } }, COLORS), { roles: cfg.roles, rng: createRng(3) });
  assert.equal(fire(ls, 'red')[0].damage, Math.round(100 * (1 + CFG.roles.element.procDmg)));
  assert.deepEqual([ls.enemies[0].effects.slow.time, ls.events.filter((e) => e.type === 'spiritProc').length], [0, 1]);

  // 기본 확률(chance x 배율)에서 seed가 같으면 발동 위치가 같다.
  const run = (seed) => {
    const s = makeState();
    equip(s, [L1('snow_fairy'), null, null, null, null], seed);
    const hits = [];
    for (let i = 0; i < 200; i++) {
      const before = s.events.filter((e) => e.type === 'spiritProc').length;
      fire(s, 'red');
      if (s.events.filter((e) => e.type === 'spiritProc').length > before) hits.push(i);
    }
    return hits;
  };
  const a = run(11);
  assert.deepEqual(a, run(11));
  assert.notDeepEqual(a, run(12));
  const expected = 200 * Math.min(CFG.roles.element.chanceCap, CFG.roles.element.chance * 1.25);
  assert.ok(a.length > expected * 0.6 && a.length < expected * 1.4, `200발 중 ${a.length}번(기대 약 ${expected})`);
});

test('element: 확률 상한(chanceCap)', () => {
  const cfg = structuredClone(CFG);
  cfg.roles.element = { chance: 0.9, chanceCap: 0 };
  const state = makeState();
  state.setSpirits(battleSpirits(cfg, ['snow_fairy', null, null, null, null], { snow_fairy: { lv: 30, star: 5 } }, COLORS), { roles: cfg.roles, rng: createRng(1) });
  for (let i = 0; i < 50; i++) fire(state, 'red');
  assert.equal(state.events.filter((e) => e.type === 'spiritProc').length, 0);
});

test('amplify: 모든 색 기술 피해 +skillDmg x 배율(방어 계산 전), 여러 마리면 더한다, 대폭발은 그대로', () => {
  const cast = (slots, color) => {
    const state = makeState({ enemies: [enemy({ def: 20 })] });
    if (slots) equip(state, slots);
    state.applyGemClear(color, 0, 1, true, 'line_h');
    return state.events.find((e) => e.type === 'skillCast');
  };
  const base = cast(null, 'blue');
  const amped = cast([null, L1('ice_owl'), null, null, null], 'blue'); // 얼음 부엉이(희귀 1.2) + 파랑 수호자(공명 1.25)
  const mul = 1 + CFG.roles.amplify.skillDmg * 1.2 * 1.25;
  close(amped.damage, base.damage * mul);
  assert.equal(amped.damages[0], Math.round(base.damage * mul - 20));
  assert.equal(base.damages[0], Math.round(base.damage - 20));
  assert.equal(CFG.roles.amplify.allColors, true);
  const other = cast([null, L1('ice_owl'), null, null, null], 'red');
  close(other.damage, cast(null, 'red').damage * mul, 1e-6); // 다른 색 기술에도 같은 배율(공명은 장착한 수호자 기준)
  const two = cast([null, L1('ice_owl'), null, L1('stag'), null], 'purple'); // + 사슴 정령(영웅 1.4 x 공명 1.25)
  close(two.damage, cast(null, 'purple').damage * (1 + CFG.roles.amplify.skillDmg * (1.2 * 1.25 + 1.4 * 1.25)), 1e-6);
  const boom = (slots) => {
    const state = makeState();
    if (slots) equip(state, slots);
    state.applyGemClear(null, 0, 1, true, 'color_color');
    return state.events.find((e) => e.type === 'skillCast')?.damage;
  };
  assert.equal(boom([null, L1('ice_owl'), null, null, null]), boom(null), '색 없는 대폭발에는 안 붙는다');
  // allColors를 끄면 그 색 수호자에 붙은 것만(옛 규칙).
  const cfgOff = structuredClone(CFG);
  cfgOff.roles.amplify.allColors = false;
  const s = makeState({ enemies: [enemy({ def: 20 })] });
  s.setSpirits(battleSpirits(cfgOff, [null, 'ice_owl', null, null, null], { ice_owl: { lv: 1, star: 1 } }, COLORS), { roles: cfgOff.roles, rng: createRng(1) });
  s.applyGemClear('red', 0, 1, true, 'line_h');
  assert.equal(s.events.find((e) => e.type === 'skillCast').damage, cast(null, 'red').damage);
});

test('처치 판정: 일반 사격·정령 사격 = 그 수호자, 기술 = 그 잼 색 수호자, 독 = 독을 건 수호자', () => {
  const kill = (state) => state.events.filter((e) => e.type === 'enemyDie').map((e) => e.killerTower);
  const a = makeState({ enemies: [enemy({ hp: 50 })] });
  fire(a, 'yellow');
  assert.deepEqual(kill(a), [2]);
  const b = makeState({ enemies: [enemy({ hp: 50 })] });
  b.applyGemClear('green', 0, 1, true, 'line_h');
  assert.deepEqual(kill(b), [3]);
  const c = makeState({ enemies: [enemy({ hp: 150 })] });
  c.applyGemClear('purple', 0, 1, true, 'line_h'); // 독이 걸린다
  if (c.enemies[0].state === 'alive') for (let t = 0; t < 100 && c.enemies[0].state === 'alive'; t++) c.update(0.1);
  assert.deepEqual(kill(c), [4]);
  const d = makeState({ enemies: [enemy({ hp: 50 })] });
  d.resolveTowerAttack({ targetEnemyId: d.enemies[0].id, damage: 999 }); // 출처를 모르는 피해
  assert.deepEqual(kill(d), [null]);
});

test('guard: 그 수호자 처치 때만 회복, 층 상한에서 멈춤, 최대 HP면 합계에 안 넣음', () => {
  const state = makeState({ enemies: Array.from({ length: 60 }, () => enemy({ hp: 1 })), wallHp: 10000 });
  const [sp] = equip(state, [L1('lava_turtle'), null, null, null, null]); // 영웅 1.4 x 공명 1.25
  const pct = CFG.roles.guard.healPct * sp.mul;
  fire(state, 'red');
  assert.equal(state._guardHealPct, 0, '성벽이 가득이면 회복도 합계도 없음');
  state.wallHealth = 1000;
  fire(state, 'blue'); // 다른 수호자의 처치
  assert.equal(state.wallHealth, 1000);
  fire(state, 'red');
  assert.equal(state.wallHealth, 1000 + Math.floor(10000 * pct + 1e-9));
  close(state._guardHealPct, pct);
  for (let i = 0; i < 40; i++) fire(state, 'red');
  close(state._guardHealPct, CFG.roles.guard.floorCapPct);
  const capped = state.wallHealth;
  assert.ok(capped <= 1000 + 10000 * CFG.roles.guard.floorCapPct + 40, `상한 근처에서 멈춤: ${capped}`);
  fire(state, 'red');
  assert.equal(state.wallHealth, capped, '상한 뒤에는 회복 없음');
});

test('정령 없음 = 기존 전투 결과와 완전히 같음(이벤트·HP·성벽)', () => {
  const run = (setup) => {
    const state = makeState({ enemies: [enemy({ hp: 900, def: 3 }), enemy({ hp: 700 }), enemy({ hp: 500000, def: 10 })], wallHp: 500 });
    setup(state);
    const rng = createRng(5);
    for (let i = 0; i < 60; i++) {
      const color = COLORS[Math.floor(rng() * 5)];
      if (i % 7 === 3) state.applyGemClear(color, 0, 1 + (i % 3), true, 'bomb');
      else fire(state, color, 1 + Math.floor(rng() * 3));
      state.update(0.05);
    }
    return JSON.stringify({ events: state.events, enemies: state.enemies, wall: state.wallHealth, status: state.status });
  };
  const plain = run(() => {});
  assert.equal(run((s) => s.setSpirits([null, null, null, null, null], { roles: CFG.roles, rng: createRng(1) })), plain);
  assert.equal(run((s) => s.setSpirits(null)), plain);
  // 전투 쪽 효과가 없는 보조(시계태엽·해체·물감 = 퍼즐 쪽)와 조건이 안 맞은 전설(불사조: 성벽 멀쩡)은 결과가 같다.
  assert.equal(run((s) => equip(s, [L1('phoenix'), L1('sup_clock'), L1('sup_breaker'), null, L1('sup_paint')])), plain);
  assert.notEqual(run((s) => equip(s, [L1('fire_wisp'), null, null, null, null])), plain);
});

// ---------- BattleController ----------
const balance = load('balance.json');
const enemiesCfg = load('enemies.json');
const ctlArgs = () => ({
  balance, enemies: enemiesCfg, obstacles: load('obstacles.json'), floorsData: load('floors.json'), towersBaseData: balance.tower.towers,
  itemsConfig: load('items.json'), spiritsConfig: CFG,
  battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: enemiesCfg.attackInterval, effectDurationsMs: { enemyDie: 100, towerAttack: 100, enemyHit: 100 } },
});

// 층을 끝까지: 살아 있는 적을 towerIndex 수호자의 사격으로 한 방에 잡는다.
function clearFloor(c, towerIndex = 0) {
  for (let guard = 0; guard < 4000 && c.battleState.status === 'active'; guard++) {
    c.update(0.05);
    for (const e of c.battleState.enemies) {
      if (e.state === 'alive') c.battleState.resolveTowerAttack({ targetEnemyId: e.id, damage: e.currentHealth + 1, towerId: c.battleState.towers[towerIndex].id });
    }
  }
  c.update(0.05);
}

test('BattleController: 시작 정령 장착이 층 시작에 전투로 넘어가고, 층 중 변경은 다음 층부터', async () => {
  const { BattleController } = await import('../src/game/battleController.js');
  const { playerState } = await import('../src/game/playerState.js');
  const c = new BattleController(ctlArgs());
  const inv = playerState.inventory;
  assert.deepEqual(inv.spiritSlots(), ['fire_wisp', null, null, null, null]);
  // 최초 튜토리얼이 도는 층(1층 + 미완료)은 정령 없음 - 끝난 뒤(재도전·다음 층)부터 적용.
  assert.equal(playerState.tutorial.done, false);
  c.devSetFloor(1);
  c.update(0.016);
  assert.equal(c.battleState._spirits, null, '튜토리얼 층은 정령 꺼짐');
  assert.equal(c._spirits, null);
  playerState.tutorial = { ...playerState.tutorial, done: true };
  c.update(0.016);
  assert.equal(c.battleState._spirits, null, '튜토리얼이 끝나도 그 층은 그대로');
  c.devSetFloor(1);
  assert.equal(c.battleState._spirits, null, '첫 update 전에는 아직 없음');
  c.update(0.016);
  assert.equal(c.battleState._spirits[0].id, 'fire_wisp');
  close(c.battleState._spirits[0].mul, 1.25);
  inv.grant({ spirits: ['frost_bat'] }, { src: 't' });
  assert.equal(inv.equipSpirit(1, 'frost_bat').pending, true);
  assert.equal(c.battleState._spirits[1], null, '층 중에는 그대로');
  c.retryFloor();
  c.update(0.016);
  assert.equal(c.battleState._spirits[1].id, 'frost_bat');
});

test('wealth: 그 수호자 처치 골드만 +8% x 배율, 클리어 보너스는 원래 값 기준', async () => {
  const { BattleController } = await import('../src/game/battleController.js');
  const { playerState } = await import('../src/game/playerState.js');
  const { clearBonus } = await import('../src/core/economy/economy.js');
  const c = new BattleController(ctlArgs());
  const inv = playerState.inventory;
  inv.grant({ spirits: ['ember_rat'] }, { src: 't' });
  inv.equipSpirit(0, 'ember_rat'); // 불 정령 + 빨강 수호자 = 공명 1.25
  const mul = 1 + CFG.roles.wealth.killGold * 1.25;
  const run = (towerIndex) => {
    c.devSetFloor(3);
    const isFirst = playerState.isFirstClearOf(c.floor);
    clearFloor(c, towerIndex);
    assert.equal(c.battleState.status, 'cleared');
    return { reward: c.lastClearReward, base: c._killGoldBase, isFirst };
  };
  const mine = run(0);
  const golds = c.currentFloor.spawns.length;
  assert.ok(golds > 0);
  assert.ok(mine.reward.killGold > mine.base, '재물 정령이 붙은 수호자의 처치');
  assert.equal(mine.reward.killGold, Math.floor(mine.base * mul + 1e-6), '소수는 층 안에서 이월 - 합계는 내림 1번과 같다');
  assert.equal(mine.reward.bonusGold, clearBonus(balance, mine.base, mine.isFirst), '클리어 보너스는 배율 전 처치 골드 기준');
  const other = run(1);
  assert.equal(other.reward.killGold, other.base, '다른 수호자의 처치는 그대로');
  assert.equal(other.base, mine.base);
});

test('보스 첫 클리어: 정령 1마리 + 정령석, txId boss-spirit:{층}, 결과가 클리어 데이터에 실린다. 일반 층은 없음', async () => {
  const { BattleController } = await import('../src/game/battleController.js');
  const { playerState } = await import('../src/game/playerState.js');
  const c = new BattleController(ctlArgs());
  const inv = playerState.inventory;
  playerState.bestFloor = 10;
  c.devSetFloor(10);
  assert.equal(c.floorTag, 'boss');
  const stonesBefore = inv.spiritStones;
  clearFloor(c);
  const got = c.lastClearReward.spirit;
  assert.equal(CFG.spirits[got.id].grade, 'common');
  assert.ok(['new', 'star'].includes(got.kind));
  assert.equal(got.stoneReward, CFG.bossReward.stones);
  assert.equal(inv.spiritStones, stonesBefore + CFG.bossReward.stones);
  assert.ok(inv.spirit(got.id));
  assert.ok(inv.data.grantedTx.includes('boss-spirit:10'));
  // 같은 보스를 다시 깨도(재방문) 또 주지 않는다.
  const star = inv.spirit(got.id).star;
  c.devSetFloor(10);
  clearFloor(c);
  assert.equal(c.lastClearReward.spirit, null);
  assert.equal(inv.spirit(got.id).star, star);
  // 일반 층 첫 클리어에는 정령이 없다.
  playerState.bestFloor = 11;
  c.devSetFloor(11);
  clearFloor(c);
  assert.equal(c.lastClearReward.spirit, null);
});

test('랭킹(경쟁) 모드·연습 모드에서는 정령 효과 없음', async () => {
  const { BattleController } = await import('../src/game/battleController.js');
  const c = new BattleController(ctlArgs());
  c.devSetFloor(1);
  c.update(0.016);
  assert.ok(c.battleState._spirits, '일반 층에는 적용');
  c.startComp({ runId: 'r', seasonId: '2026-W48', seed: 7, cfg: load('ranking.json').comp });
  c.update(0.016);
  assert.equal(c.battleState._spirits, null);
  assert.equal(c._spirits, null);
  c.startPractice();
  c.update(0.016);
  assert.equal(c.battleState._spirits, null);
  c.retryFloor();
  c.update(0.016);
  assert.ok(c.battleState._spirits, '본편으로 돌아오면 다시 적용');
});

test('guard 이월: 작은 성벽에서도 1 HP 미만 회복이 사라지지 않고 모여서 1씩 회복, 상한은 이월 전 합계', () => {
  const W = 20;
  const state = makeState({ enemies: Array.from({ length: 60 }, () => enemy({ hp: 1 })), wallHp: W });
  const sp = equip(state, [null, null, null, L1('seedling'), null])[3];
  assert.equal(sp.role, 'guard');
  const pct = CFG.roles.guard.healPct * sp.mul;
  assert.ok(W * pct < 1, '처치 1번 회복량이 1 HP 미만인 조건');
  state.wallHealth = 10;
  const kills = Math.floor(CFG.roles.guard.floorCapPct / pct) - 1; // 상한 전까지
  for (let i = 0; i < kills; i++) fire(state, 'green');
  assert.equal(state.wallHealth, 10 + Math.floor(W * pct * kills + 1e-9), '합계 = 내림 1번과 같다');
  close(state._guardHealPct, pct * kills);
  assert.ok(state._guardCarry >= 0 && state._guardCarry < 1);
  for (let i = 0; i < 10; i++) fire(state, 'green');
  close(state._guardHealPct, CFG.roles.guard.floorCapPct);
  assert.ok(state.wallHealth <= 10 + W * CFG.roles.guard.floorCapPct + 1e-9, '이월이 상한을 넘기지 않는다');
});

test('소급 지급: 깬 보스 층 중 boss-spirit txId가 없는 층만, 같은 규칙으로, 한 번만 + pendingSpiritNotice', () => {
  const inv = new Inventory(null, { wallet: { gold: 0, diamonds: 0 }, clock: () => 1 });
  inv.data.grantedTx.push('boss-spirit:20'); // 이미 받은 층
  inv.initSpirits(CFG, [10, 20, 30]);
  const notice = inv.data.pendingSpiritNotice;
  assert.deepEqual(notice.map((n) => n.floor), [10, 30]);
  for (const n of notice) {
    const bundle = bossSpiritBundle(CFG, n.floor);
    assert.equal(n.id, bundle.spirits[0], '층 번호 seed - 그 층을 지금 깼을 때와 같은 정령');
    assert.equal(n.stoneReward, CFG.bossReward.stones);
    assert.ok(inv.spirit(n.id));
  }
  assert.ok(inv.spirit('fire_wisp'), '시작 정령도 그대로 지급');
  const stones = inv.spiritStones;
  assert.ok(stones >= CFG.bossReward.stones * 2);
  const snapshot = JSON.stringify(inv.data.perm);
  inv.initSpirits(CFG, [10, 20, 30]);
  assert.equal(JSON.stringify(inv.data.perm), snapshot, '두 번째는 아무것도 안 준다');
  assert.equal(inv.data.pendingSpiritNotice.length, 2);
  // 저장을 다시 읽어도 알림 목록이 남는다.
  const again = new Inventory(structuredClone(inv.data), { wallet: { gold: 0, diamonds: 0 } });
  assert.deepEqual(again.data.pendingSpiritNotice, notice);
});

test('소급 지급: playerState는 bestFloor 아래 보스 층만 센다(bestFloor 31 -> 10·20·30, 30 -> 10·20)', async () => {
  const { playerState } = await import('../src/game/playerState.js');
  const floorsOf = (bestFloor) => {
    let got = null;
    playerState.initSpirits.call({ bestFloor, inventory: { initSpirits: (_, floors) => (got = floors) } }, CFG, 10);
    return got;
  };
  assert.deepEqual(floorsOf(31), [10, 20, 30]);
  assert.deepEqual(floorsOf(30), [10, 20]);
  assert.deepEqual(floorsOf(1), []);
});

test('effectInfo + 문구: 역할별 틀 하나에 숫자만, 30종 이름이 ko/en에 다 있다', async () => {
  const { effectInfo } = await import('../src/core/spirits/spirits.js');
  const { ko } = await import('../src/config/locales/ko.js');
  const { en } = await import('../src/config/locales/en.js');
  // 영웅 공격 정령(빙하 늑대 1.4): mul x 1.4 x 별 3(1.1), 별 3이면 N이 1 줄어든다(최소 2).
  assert.deepEqual(effectInfo(CFG, 'glacier_wolf', { lv: 1, star: 3 }, 'red'), { role: 'attack', element: 'blue', resonance: false, every: Math.max(2, CFG.roles.attack.every - 1), pct: Math.round(CFG.roles.attack.mul * 1.4 * 1.1 * 1000) / 10 });
  assert.equal(effectInfo(CFG, 'fire_wisp', { lv: 1, star: 1 }, 'red').pct, Math.round(CFG.roles.attack.mul * 1.25 * 1000) / 10, '공명 x1.25');
  assert.equal(effectInfo(CFG, 'seedling', { lv: 1, star: 1 }, null).cap, CFG.roles.guard.floorCapPct * 100);
  assert.equal(effectInfo(CFG, 'phoenix', { lv: 1, star: 1 }, 'red').pct, 50, '불사조: 25% x 전설 1.6 x 공명 1.25');
  assert.equal(effectInfo(CFG, 'phoenix', { lv: 30, star: 5 }, 'red').pct, 60, '상한 60%');
  assert.deepEqual([effectInfo(CFG, 'sup_tinker', { lv: 1, star: 5 }, null).every, effectInfo(CFG, 'sup_clock', { lv: 30, star: 5 }, 'blue').n], [10, 1]);
  assert.equal(effectInfo(CFG, 'wraith_queen', { lv: 1, star: 1 }, 'purple').pct, 70, '여왕 사격 독: 0.35 x 2.0');
  assert.equal(effectInfo(CFG, 'wraith_queen', { lv: 30, star: 5 }, 'purple').pct, 108.4, '최대: 0.35 x 3.096');
  assert.equal(effectInfo(CFG, 'sup_paint', { lv: 30, star: 5 }, 'purple').pct, 7, '물감: 3%p x 희귀 최대 배율 2.32 = 7%p(상한 8%p에는 안 닿는다)');
  for (const dict of [ko, en]) {
    for (const [id, sp] of Object.entries(CFG.spirits)) {
      assert.ok(dict.spirit.name[id], `이름 ${id}`);
      assert.ok(dict.spirit.grade[sp.grade] && dict.spirit.element[sp.element] && dict.spirit.role[sp.role], id);
      assert.ok(dict.spirit.effect[sp.unique ?? sp.support ?? sp.role], `효과 틀 ${id}`);
    }
    assert.equal(Object.keys(dict.spirit.name).length, 30);
  }
});

test('획득 팝업 이름: 칸 폭을 넘으면 띄어쓰기에서 두 줄, 안 넘거나 띄어쓰기가 없으면 한 줄', async () => {
  const { splitName } = await import('../src/render/rewardPopup.js');
  const measure = (s) => s.length * 10;
  assert.deepEqual(splitName('망치 정령', 60, measure), ['망치 정령']);
  assert.deepEqual(splitName('결계 두루마리', 60, measure), ['결계', '두루마리']);
  assert.equal(splitName('Copper Squirrel Spirit', 60, measure).length, 2);
  assert.deepEqual(splitName('Clockwork', 60, measure), ['Clockwork']);
});

test('dexEntries: 30종 전부(config 순서), 필터는 목록에만, 보유 수는 전체 기준', async () => {
  const { dexEntries } = await import('../src/core/spirits/spirits.js');
  const owned = { fire_wisp: { lv: 1, star: 1 }, phoenix: { lv: 3, star: 2 }, ice_owl: { lv: 1, star: 1 } };
  const all = dexEntries(CFG, owned);
  assert.deepEqual([all.ids.length, all.total, all.ownedCount], [30, 30, 3]);
  assert.deepEqual(all.ids.map((e) => e.id), Object.keys(CFG.spirits));
  assert.equal(all.ids.find((e) => e.id === 'phoenix').owned, true);
  assert.equal(all.ids.find((e) => e.id === 'flame_fox').owned, false);
  const red = dexEntries(CFG, owned, { element: 'red' });
  assert.deepEqual([red.ids.length, red.ownedCount], [6, 3], '속성 필터 - 보유 수는 그대로 전체 기준');
  assert.deepEqual(dexEntries(CFG, owned, { element: 'red', grade: 'legend' }).ids, [{ id: 'phoenix', owned: true }]);
});

test('정령 탭 필터: 탭 = 다음 값(속성 불→얼음→숲→독→번개, 등급 일반→전설, 보유만↔전체), 길게 = 전체, 목록은 config 순서', async () => {
  const { newSpiritSel, cycleFilter, resetFilter, spiritList, FILTER_ALL } = await import('../src/render/ui/spiritTab.js');
  const sel = newSpiritSel();
  assert.deepEqual([sel.element, sel.grade, sel.ownedOnly], [null, null, true], '기본 = 속성·등급 전체, 보유만');
  const seen = [];
  for (let i = 0; i < 6; i++) {
    cycleFilter(sel, 'element');
    seen.push(sel.element);
  }
  assert.deepEqual(seen, ['red', 'blue', 'green', 'purple', 'yellow', null]);
  const grades = [];
  for (let i = 0; i < 5; i++) {
    cycleFilter(sel, 'grade');
    grades.push(sel.grade);
  }
  assert.deepEqual(grades, ['common', 'rare', 'epic', 'legend', null]);
  cycleFilter(sel, 'ownedOnly');
  assert.equal(sel.ownedOnly, false);
  cycleFilter(sel, 'ownedOnly');
  assert.equal(sel.ownedOnly, true);
  sel.detail = 'phoenix';
  cycleFilter(sel, 'grade');
  assert.equal(sel.detail, null, '필터를 바꾸면 열어 둔 상세는 닫는다');
  resetFilter(sel, 'grade');
  resetFilter(sel, 'ownedOnly');
  assert.deepEqual([sel.grade, sel.ownedOnly], [FILTER_ALL.grade, false], '길게 = 전체(보유는 "전체" = 안 가진 것도)');

  const owned = { phoenix: { lv: 1, star: 1 }, ember_rat: { lv: 1, star: 1 }, snow_fairy: { lv: 1, star: 1 } };
  const ids = Object.keys(CFG.spirits);
  assert.deepEqual(spiritList(CFG, owned, { ...newSpiritSel() }), ids.filter((id) => owned[id]), '보유만 - config 순서');
  assert.deepEqual(spiritList(CFG, owned, { ...newSpiritSel(), ownedOnly: false }), ids, '보유 전체 = 30종, 정렬 그대로');
  assert.deepEqual(spiritList(CFG, owned, { ...newSpiritSel(), ownedOnly: false, element: 'red', grade: 'legend' }), ['phoenix']);
  assert.deepEqual(spiritList(CFG, owned, { ...newSpiritSel(), element: 'yellow' }), [], '조건에 맞는 정령이 없으면 빈 목록');
});
