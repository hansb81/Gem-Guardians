// 정령 G 단계(docs/spirits.md 3장 보조 5종, 5장 전설 5종): 발동 조건·수치·상한·층당 횟수, "같은 보조는 가장 높은 것만",
// 불사조가 깃털보다 먼저(깃털 횟수는 그대로), 정령이 없을 때 기존 결과와 같은지. 숫자는 실제 config를 읽는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BattleState } from '../src/battle/battleState.js';
import { GameState } from '../src/core/gameState.js';
import { Board } from '../src/core/board.js';
import { createRng } from '../src/core/rng.js';
import { createObstacleRegistry } from '../src/core/obstacles/registry.js';
import { damageOccupantsInCells, maybeSpawnOnMove } from '../src/core/obstacles/obstacles.js';
import { battleSpirits, supportMods } from '../src/core/spirits/spirits.js';
import { ItemController } from '../src/game/itemController.js';
import { Inventory } from '../src/game/inventory.js';
import { GEM_TYPES } from '../src/config/gems.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../config/${name}`, import.meta.url), 'utf-8'));
const CFG = load('spirits.json');
const U = CFG.uniques;
const ITEMS = load('items.json');
const OBSTACLES = load('obstacles.json');
const COLORS = ['red', 'blue', 'yellow', 'green', 'purple']; // 수호자 순서
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const enemy = (o = {}) => ({ type: 'e', rank: 'normal', name: 'E', hp: 100000, def: 0, speed: 0, wallDmg: 5, gold: 10, ...o });
const L1 = (id) => ({ id, lv: 1, star: 1 });
const MAX = (id) => ({ id, lv: CFG.levelMax, star: CFG.starMax });

function makeState({ enemies = [enemy()], attack = 100, wallHp = 1000 } = {}) {
  const state = new BattleState({
    towersData: COLORS.map((c) => ({ id: `tower_${c}`, color: c, stats: { attack } })),
    resolvedFloor: { wallHp, interval: 0, spawns: enemies },
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: { towerAttack: 1e9, enemyHit: 1e9, enemyDie: 1e9, wallHealed: 1e9, wallDamaged: 1e9, spiritProc: 1e9 }, skills: load('skills.json') },
  });
  state.update(0);
  return state;
}
function equip(state, slots) {
  const owned = Object.fromEntries(slots.filter(Boolean).map((s) => [s.id, s]));
  const list = battleSpirits(CFG, slots.map((s) => s?.id ?? null), owned, COLORS);
  state.setSpirits(list, { roles: CFG.roles, rng: createRng(1) });
  return list;
}
// color 수호자의 일반 사격 1발(cascadeIndex 단계) - 명중까지. 반환 = 그 발의 피해.
function fire(state, color, cascadeIndex = 1) {
  const shots = state.applyGemClear(color, 1, cascadeIndex);
  for (const ev of shots) state.resolveTowerAttack(ev);
  return shots[0]?.damage;
}
const procs = (state, key) => state.events.filter((e) => e.type === 'spiritProc' && e.key === key);

// ---------- 전설 ----------
test('phoenix: 성벽 30% 이하가 되는 순간 min(60%, 25% x 배율) 회복, 층당 1회, 0이 되는 피해도 패배보다 먼저', () => {
  const state = makeState();
  const [sp] = equip(state, [L1('phoenix'), null, null, null, null]); // 전설 1.6 x 공명 1.25 = 2.0
  close(sp.mul, 2);
  state.applyObstacleWallDamage(0.5);
  assert.equal(state.wallHealth, 500, '30%보다 위에서는 발동 안 함');
  state.applyObstacleWallDamage(0.2);
  assert.equal(state.wallHealth, 300 + 1000 * Math.min(U.phoenix.healCap, U.phoenix.healPct * 2), '정확히 30% = 발동');
  const heal = state.events.find((e) => e.type === 'wallHealed');
  assert.deepEqual([heal.amount, heal.spiritTower, heal.phoenix], [500, 0, true]);
  state.applyObstacleWallDamage(0.8);
  assert.deepEqual([state.wallHealth, state.status], [0, 'failed'], '층당 1회 - 두 번째는 그대로 패배');

  const lethal = makeState();
  equip(lethal, [null, null, MAX('phoenix'), null, null]); // 비공명 최대 = 1.6 x 1.29 x 1.2 = 2.48 -> 62% -> 상한 60%
  lethal.applyObstacleWallDamage(1);
  assert.deepEqual([lethal.wallHealth, lethal.status], [1000 * U.phoenix.healCap, 'active'], '0이 되는 피해 - 상한 60%로 살아난다');

  const hit = makeState({ enemies: [enemy({ speed: 100, wallDmg: 800 })] });
  equip(hit, [L1('phoenix'), null, null, null, null]);
  hit.update(1.5); // 성벽 도착 + 공격 1번
  assert.deepEqual([hit.wallHealth, hit.status], [700, 'active'], '적 공격으로 깎여도 같은 규칙');
});

test('phoenix: 결계로 피해가 0이면 발동 안 함, 깃털(revive)보다 먼저 발동하고 깃털·광고 이어하기 횟수는 그대로', () => {
  const state = makeState();
  equip(state, [L1('phoenix'), null, null, null, null]);
  state.wallHealth = 250; // 이미 30% 아래 - 피해가 들어와야 발동
  state.shieldWall(5);
  state.applyObstacleWallDamage(0.5);
  assert.equal(state.wallHealth, 250);
  assert.equal(state._phoenixUsed, false);

  const inv = new Inventory(null, { wallet: { gold: 0, diamonds: 0 } });
  inv.grant({ items: { revive: 2 } }, { src: 't' });
  const bs = makeState();
  equip(bs, [L1('phoenix'), null, null, null, null]);
  const items = new ItemController({ config: ITEMS, player: { inventory: inv }, battleState: bs });
  bs.applyObstacleWallDamage(1);
  assert.equal(bs.status, 'active', '불사조가 먼저 - 패배가 아니다');
  assert.equal(items.use('revive').ok, false, '깃털은 패배 상태에서만');
  assert.deepEqual([inv.count('revive'), items.perFloorLeft('revive'), items.continueLeft(true), items.continueLeft(false)], [2, 1, 1, 1], '깃털·이어하기 횟수 그대로');
  bs.applyObstacleWallDamage(1);
  assert.equal(bs.status, 'failed');
  assert.equal(items.use('revive').ok, true, '그 다음 패배에는 깃털');
  assert.deepEqual([bs.status, inv.count('revive'), items.perFloorLeft('revive')], ['active', 1, 0]);
});

test('frost_whale: N발마다(별 규칙) 가장 앞 적만 sec x 배율 빙결, 보스는 절반, 둔화보다 우선', () => {
  const state = makeState({ enemies: [enemy({ speed: 0.01 }), enemy({ speed: 0.01 })] });
  const list = equip(state, [null, L1('frost_whale'), null, null, null]); // 2.0
  assert.equal(list[1].every, U.frost_whale.every);
  const [front, back] = state.enemies;
  front.progress = 0.5;
  for (let n = 1; n < U.frost_whale.every; n++) fire(state, 'blue');
  assert.equal(front.spiritFreeze, undefined, 'N-1발까지는 없음');
  fire(state, 'red');
  assert.equal(front.spiritFreeze, undefined, '다른 수호자의 사격은 안 센다');
  fire(state, 'blue');
  close(front.spiritFreeze, U.frost_whale.sec * 2);
  assert.equal(back.spiritFreeze, undefined, '그 적만');
  assert.equal(state.frozen, false, '전체 정지(모래시계)는 쓰지 않는다');
  assert.equal(state.isEnemyFrozen(front), true);
  front.effects.slow.time = 5; // 얼음 색 효과로 느려진 적 - 빙결이 우선
  front.effects.slow.mul = 0.5;
  state.update(1);
  assert.deepEqual([front.progress, back.progress > 0], [0.5, true]);
  state.update(U.frost_whale.sec * 2); // 빙결이 이 틱 안에서 끝난다(틱 단위로 풀린다)
  state.update(0.1);
  assert.ok(front.progress > 0.5, '빙결 시간이 지나면 다시 움직인다');

  const boss = makeState({ enemies: [enemy({ rank: 'boss' })] });
  const bl = equip(boss, [{ id: 'frost_whale', lv: 1, star: 3 }, null, null, null, null]); // 비공명 1.6 x 1.1
  assert.equal(bl[0].every, U.frost_whale.every - 1, '별 3 = 1발 줄어듦');
  for (let n = 1; n <= bl[0].every; n++) fire(boss, 'red');
  close(boss.enemies[0].spiritFreeze, U.frost_whale.sec * 1.6 * 1.1 * U.frost_whale.bossMul);
});

test('elder_treant: 쏠 때마다 다른 수호자 4명 +1% x 배율, 상한 +8% x 배율, 본인 제외, 북과는 곱', () => {
  const state = makeState();
  equip(state, [null, null, null, L1('elder_treant'), null]); // 2.0
  assert.equal(fire(state, 'red'), 100);
  for (let n = 1; n <= 3; n++) assert.equal(fire(state, 'green'), 100, '본인은 안 받는다');
  assert.equal(fire(state, 'red'), Math.round(100 * (1 + U.elder_treant.perShot * 3 * 2)));
  assert.equal(fire(state, 'purple'), 106);
  state.applyGemClear('green', 3, 1, true); // 특수 잼 몫은 안 센다
  assert.equal(fire(state, 'red'), 106);
  for (let n = 0; n < 30; n++) fire(state, 'green');
  const capped = 1 + U.elder_treant.cap * 2;
  assert.equal(fire(state, 'red'), Math.round(100 * capped), '상한 = cap x 배율');
  assert.equal(procs(state, 'elder_treant').length, U.elder_treant.cap / U.elder_treant.perShot, '상한에 닿으면 더는 번쩍이지 않는다');
  state.setAtkBuff(1.5);
  assert.equal(fire(state, 'red'), Math.round(100 * 1.5 * capped), '분노의 북과 곱');
  assert.equal(fire(state, 'green'), 150);
});

test('wraith_queen: 독 걸린 적이 죽으면 남은 독을 가장 가까운 적에게 중첩 그대로, 이미 독이 있으면 시간만 긴 쪽', () => {
  const setup = (queen) => {
    const state = makeState({ enemies: [enemy(), enemy(), enemy()] });
    if (queen) equip(state, [null, null, null, null, L1('wraith_queen')]);
    const [a, b, c] = state.enemies;
    [a.progress, b.progress, c.progress] = [0.5, 0.2, 0.45];
    Object.assign(a.effects.poison, { stacks: 3, base: 80, time: 1.5, source: 4 });
    return { state, a, b, c };
  };
  const kill = (state, e) => state.resolveTowerAttack({ targetEnemyId: e.id, damage: e.currentHealth, towerId: 'tower_red' });

  const none = setup(false);
  kill(none.state, none.a);
  assert.equal(none.c.effects.poison.stacks, 0, '여왕이 없으면 안 옮긴다');

  const q = setup(true);
  kill(q.state, q.a);
  assert.deepEqual([q.c.effects.poison.stacks, q.c.effects.poison.base, q.c.effects.poison.time, q.c.effects.poison.source], [U.wraith_queen.keepStacks ? 3 : 1, 80, 1.5, 4], '가장 가까운 c에게 중첩 그대로(keepStacks), 남은 시간 그대로');
  assert.equal(q.b.effects.poison.stacks, 0);
  assert.deepEqual(procs(q.state, 'wraith_queen').map((e) => [e.towerIndex, e.enemyId, e.fromEnemyId]), [[4, q.c.id, q.a.id]]);

  const has = setup(true);
  Object.assign(has.c.effects.poison, { stacks: 2, base: 50, time: 0.4 });
  kill(has.state, has.a);
  assert.deepEqual([has.c.effects.poison.stacks, has.c.effects.poison.base, has.c.effects.poison.time], [2, 50, 1.5], '이미 독이 있으면 시간만 더 긴 쪽');
  Object.assign(has.b.effects.poison, { stacks: 1, base: 50, time: 9 });
  kill(has.state, has.c);
  assert.equal(has.b.effects.poison.time, 9, '받는 쪽이 더 길면 그대로');

  // 장착한 수호자의 일반 사격이 명중하면 독 1중첩(독 색 효과가 잠겨 있어도, 독 면역 적 제외). 다른 수호자·특수 잼 몫은 안 건다.
  const skills = load('skills.json');
  skills.unlocked.colorEffects.purple = false;
  const shot = new BattleState({
    towersData: COLORS.map((c) => ({ id: `tower_${c}`, color: c, stats: { attack: 100 } })),
    resolvedFloor: { wallHp: 1000, interval: 0, spawns: [enemy(), enemy({ immune: ['purple'] })] },
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: { towerAttack: 1e9, enemyHit: 1e9, enemyDie: 1e9, spiritProc: 1e9 }, skills },
  });
  shot.update(0);
  equip(shot, [null, null, null, null, L1('wraith_queen')]);
  const [e1, e2] = shot.enemies;
  e1.progress = 0.5;
  fire(shot, 'red');
  assert.equal(e1.effects.poison.stacks, 0, '다른 수호자의 사격');
  for (const ev of shot.applyGemClear('purple', 1, 1, true)) shot.resolveTowerAttack(ev);
  assert.equal(e1.effects.poison.stacks, 0, '특수 잼 몫');
  fire(shot, 'purple');
  const pc = skills.colorEffects.purple;
  // 피해 기준 = 사격 피해 x 정령 배율(전설 1.6 x 공명 1.25 = 2.0) x shotPoisonMul. 시간·중첩 규칙은 독 색 효과 표 그대로, 해금과 무관.
  assert.deepEqual([e1.effects.poison.stacks, e1.effects.poison.time, e1.effects.poison.source], [1, pc.duration, 4]);
  close(e1.effects.poison.base, 100 * 2 * U.wraith_queen.shotPoisonMul);
  for (let i = 0; i < pc.maxStacks + 2; i++) fire(shot, 'purple');
  assert.equal(e1.effects.poison.stacks, pc.maxStacks, '일반 독처럼 최대 중첩까지');
  e2.progress = 0.9;
  fire(shot, 'purple');
  assert.equal(e2.effects.poison.stacks, 0, '독 면역 적 제외');

  const dry = setup(true);
  dry.a.effects.poison.stacks = 0;
  kill(dry.state, dry.a);
  assert.equal(procs(dry.state, 'wraith_queen').length, 0, '독이 없던 적은 아무 일도 없다');
});

test('storm_kirin: 10발마다(별 규칙) 앞에서부터 3마리에 공격력 x 0.4 x 배율 - 방어, 번개 색 효과 없음', () => {
  const state = makeState({ enemies: [enemy({ def: 5 }), enemy({ def: 5 }), enemy({ def: 5 }), enemy({ def: 5 })] });
  const list = equip(state, [null, null, L1('storm_kirin'), null, null]); // 2.0
  assert.equal(list[2].every, U.storm_kirin.every);
  state.enemies.forEach((e, i) => (e.progress = 0.8 - i * 0.1));
  const bolts = () => state.events.filter((e) => e.type === 'enemyHit' && e.source === 'spirit');
  for (let n = 1; n < U.storm_kirin.every; n++) fire(state, 'yellow');
  assert.equal(bolts().length, 0);
  fire(state, 'yellow');
  const dmg = Math.round(100 * U.storm_kirin.mul * 2 - 5);
  assert.deepEqual(bolts().map((e) => [e.enemyId, e.damage, e.spirit]), state.enemies.slice(0, U.storm_kirin.targets).map((e) => [e.id, dmg, true]));
  assert.deepEqual(procs(state, 'storm_kirin')[0].enemyIds, state.enemies.slice(0, 3).map((e) => e.id));
  assert.equal(state.enemies[3].currentHealth, 100000, '4번째 적은 안 맞는다');
  // 번개 색 효과(경직)는 일반 사격에도 안 붙는 설정(기술 전용)이라 번개가 걸었다면 여기서만 생긴다.
  assert.ok(state.enemies.every((e) => e.effects.stun.time === 0 && e.effects.stun.cooldown === 0), '경직 없음');
  const star5 = equip(makeState(), [{ id: 'storm_kirin', lv: 1, star: 5 }, null, null, null, null]);
  assert.equal(star5[0].every, U.storm_kirin.every - 2, '별 5 = 2발 줄어듦(최소 2)');
});

// ---------- 보조 ----------
test('sup_cascade: 연쇄 2단계부터 단계당 보너스 +3%p x 배율, 1단계는 그대로', () => {
  const state = makeState();
  const [sp] = equip(state, [L1('sup_cascade'), null, null, null, null]); // 희귀 1.2 x 공명 1.25 = 1.5
  close(sp.value, CFG.spirits.sup_cascade.value * 1.5);
  assert.equal(fire(state, 'blue', 1), 100);
  assert.equal(fire(state, 'blue', 3), Math.round(100 * (1 + (0.5 + sp.value) * 2)), '모든 수호자의 사격에');
  assert.equal(fire(makeState(), 'blue', 3), 200, '정령 없음 = 기존 값');
  assert.equal(procs(state, 'cascade').length, 1, '2단계 이상에서만 번쩍');
});

test('sup_clock: 새 시한폭탄 타이머 +1(레벨·별·공명 무시), 이미 있는 폭탄도 맞추고 다시 걸어도 한 번만', () => {
  const [sp] = battleSpirits(CFG, ['sup_clock'], { sup_clock: MAX('sup_clock') }, ['blue']);
  assert.equal(sp.value, 1, '배율 무시, 고정');
  const floorObstacles = { timeBomb: { initial: 2, everyMoves: 1, timer: 5, wallDamagePct: 0.1, maxAlive: 9 } };
  const gs = new GameState({ seed: 3, obstaclesConfig: OBSTACLES, floorObstacles });
  const timers = () => gs.board.attachments.filter(Boolean).map((a) => a.timer);
  assert.deepEqual(timers(), [5, 5]);
  gs.setSpiritMods(supportMods([sp], ['blue']));
  assert.deepEqual(timers(), [6, 6], '층 시작에 이미 놓인 폭탄');
  gs.setSpiritMods(supportMods([sp], ['blue']));
  assert.deepEqual(timers(), [6, 6], '보드를 이어 가는 다음 층에서 다시 걸어도 그대로');
  maybeSpawnOnMove(gs.board, gs.obstaclesRegistry, floorObstacles, gs.board.rng, {});
  assert.deepEqual(timers().sort(), [6, 6, 6], '새로 생긴 폭탄');
  gs.setSpiritMods(null);
  assert.deepEqual(timers(), [5, 5, 5], '정령을 빼면 원래 값');
});

test('sup_breaker: 매치 옆 피해에만 12% x 배율 확률로 1 추가 피해, 자기 RNG만 쓴다', () => {
  const [sp] = battleSpirits(CFG, ['sup_breaker'], { sup_breaker: L1('sup_breaker') }, ['green']);
  close(sp.value, CFG.spirits.sup_breaker.value * 1.2 * 1.25);
  const registry = createObstacleRegistry(OBSTACLES);
  assert.equal(registry.get('stone').hp, 2);
  const hit = (cause, extra) => {
    const board = new Board({ seed: 1 });
    let boardRng = 0;
    const orig = board.rng;
    board.rng = () => (boardRng++, orig());
    board.occupants[0] = { type: 'stone', hp: 2 };
    const effects = damageOccupantsInCells(board, registry, [{ row: 0, col: 0 }], new Set(), cause, extra);
    return { hp: board.occupants[0]?.hp ?? 0, effects, boardRng };
  };
  assert.equal(hit('adjacentMatch', null).hp, 1, '정령 없음');
  const yes = hit('adjacentMatch', { chance: 1, rng: createRng(1) });
  assert.deepEqual([yes.hp, yes.effects[0].type, yes.effects[0].spiritBonus, yes.boardRng], [0, 'obstacleDestroyed', true, 0]);
  assert.equal(hit('adjacentMatch', { chance: 0, rng: createRng(1) }).hp, 1);
  assert.equal(hit('specialEffect', { chance: 1, rng: createRng(1) }).hp, 1, '특수 잼 피해에는 안 붙는다');
  // 확률: 2000번 중 18% 안팎.
  const rng = createRng(7);
  let n = 0;
  for (let i = 0; i < 2000; i++) n += hit('adjacentMatch', { chance: sp.value, rng }).hp === 0 ? 1 : 0;
  assert.ok(Math.abs(n / 2000 - sp.value) < 0.03, `추가 피해 비율 ${n / 2000}`);
  const gs = new GameState({ seed: 3, obstaclesConfig: OBSTACLES });
  gs.setSpiritMods({ clock: 0, breaker: sp.value, paint: null }, 5);
  close(gs._breaker.chance, sp.value);
});

test('sup_paint: 그 수호자 색 확률 +3%p x 배율(상한 +8%p), 나머지는 같은 비율로, 난수 순서는 그대로', () => {
  const [sp] = battleSpirits(CFG, ['sup_paint'], { sup_paint: L1('sup_paint') }, ['purple']);
  close(sp.value, CFG.spirits.sup_paint.value * 1.5);
  const capped = { ...CFG, spirits: { ...CFG.spirits, sup_paint: { ...CFG.spirits.sup_paint, value: 0.2 } } };
  assert.equal(battleSpirits(capped, ['sup_paint'], { sup_paint: L1('sup_paint') }, ['purple'])[0].value, CFG.spirits.sup_paint.cap, '상한');
  const mods = supportMods([null, null, sp, null, null], COLORS);
  assert.deepEqual(mods.paint, { color: 'yellow', bonus: sp.value }, '색 = 이 정령을 장착한 수호자의 색');

  const gs = new GameState({ seed: 11 });
  const plain = new Board({ seed: 1 });
  plain.rng = createRng(99);
  const painted = gs.board;
  painted.rng = createRng(99);
  gs.setSpiritMods({ clock: 0, breaker: 0, paint: { color: 'yellow', bonus: 0.08 } });
  const type = GEM_TYPES.findIndex((g) => g.id === 'yellow');
  assert.deepEqual(painted.paint, { type, bonus: 0.08 });
  const N = 40000;
  const counts = Array(painted.typeCount).fill(0);
  for (let i = 0; i < N; i++) {
    counts[painted.randomType()]++;
    plain.randomType();
  }
  const n = painted.typeCount;
  counts.forEach((c, t) => assert.ok(Math.abs(c / N - (t === type ? 1 / n + 0.08 : (1 - 1 / n - 0.08) / (n - 1))) < 0.01, `색 ${t} 비율 ${c / N}`));
  assert.equal(painted.rng(), plain.rng(), '뽑은 난수 수가 같다(순서 불변)');
  gs.setSpiritMods(null);
  assert.equal(painted.paint, null);
  const a = new Board({ seed: 5 });
  const b = new Board({ seed: 5 });
  b.paint = null;
  assert.deepEqual(Array.from({ length: 50 }, () => a.randomType()), Array.from({ length: 50 }, () => b.randomType()), 'paint가 없으면 기존 식 그대로');
});

test('sup_tinker: 12발마다(별 규칙) 신호, 쿨다운 중인 하단 아이템만 -1 스왑', () => {
  const state = makeState();
  const list = equip(state, [null, null, L1('sup_tinker'), null, null]);
  assert.equal(list[2].every, CFG.spirits.sup_tinker.value);
  for (let n = 1; n <= 25; n++) fire(state, 'yellow');
  assert.equal(procs(state, 'tinker').length, 2, '12·24발째');
  assert.equal(battleSpirits(CFG, ['sup_tinker'], { sup_tinker: { id: 'sup_tinker', lv: 30, star: 5 } }, ['yellow'])[0].every, CFG.spirits.sup_tinker.value - 2, '별 5 = 10발마다');

  const gameState = { validSwapCount: 10, resolutions: [] };
  const items = new ItemController({ config: ITEMS, player: { inventory: new Inventory(null, { wallet: { gold: 0, diamonds: 0 } }) }, gameState });
  items._lastUseAt = { scythe_h: 9, hammer: 2 }; // 낫: 방금 씀(4 중 3 남음), 망치: 쿨다운 끝남
  assert.deepEqual([items.cooldownLeft('scythe_h'), items.cooldownLeft('hammer')], [ITEMS.items.scythe_h.cooldownMoves - 1, 0]);
  items.reduceCooldowns(1);
  assert.deepEqual([items.cooldownLeft('scythe_h'), items.cooldownLeft('hammer')], [ITEMS.items.scythe_h.cooldownMoves - 2, 0]);
  assert.equal(items._lastUseAt.hammer, 2, '쿨다운이 없는 아이템은 안 건드린다');
});

test('같은 보조는 겹치지 않고 가장 높은 값만', () => {
  const sup = (key, value) => ({ id: `x_${key}_${value}`, role: 'support', element: 'red', mul: 1, every: null, key, u: null, value });
  const mods = supportMods([sup('breaker', 0.1), sup('breaker', 0.2), sup('paint', 0.03), sup('paint', 0.05), sup('clock', 1)], COLORS);
  assert.deepEqual(mods, { clock: 1, breaker: 0.2, paint: { color: 'green', bonus: 0.05 } });
  const state = makeState();
  state.setSpirits([sup('cascade', 0.03), null, sup('cascade', 0.06), null, null], { roles: CFG.roles, rng: createRng(1) });
  assert.equal(fire(state, 'blue', 2), Math.round(100 * (1 + 0.5 + 0.06)), '더하지 않고 높은 쪽만');
  assert.equal(procs(state, 'cascade')[0].towerIndex, 2);
});

// ---------- 정령 없음 = 기존과 같음 ----------
test('정령 없음: 성벽 피해·독 처치·빙결 경로가 기존 결과와 같고, 보드는 setSpiritMods를 안 부른 것과 같다', () => {
  const run = (setup) => {
    const state = makeState({ enemies: [enemy({ hp: 400, speed: 0.4, wallDmg: 90 }), enemy({ hp: 400, speed: 0.3 }), enemy({ hp: 50000, speed: 0.2, wallDmg: 300 })], wallHp: 1000 });
    setup(state);
    Object.assign(state.enemies[0].effects.poison, { stacks: 2, base: 60, time: 3, source: 4 });
    const rng = createRng(9);
    for (let i = 0; i < 80; i++) {
      fire(state, COLORS[Math.floor(rng() * 5)], 1 + (i % 3));
      if (i === 30) state.applyObstacleWallDamage(0.3);
      state.update(0.1);
    }
    return JSON.stringify({ events: state.events, enemies: state.enemies, wall: state.wallHealth, status: state.status });
  };
  const plain = run(() => {});
  assert.equal(run((s) => s.setSpirits([null, null, null, null, null], { roles: CFG.roles, rng: createRng(1) })), plain);
  assert.notEqual(run((s) => equip(s, [L1('phoenix'), L1('frost_whale'), L1('storm_kirin'), L1('elder_treant'), L1('wraith_queen')])), plain);

  const play = (mods) => {
    const gs = new GameState({ seed: 21, obstaclesConfig: OBSTACLES, floorObstacles: { stone: { initial: 3 }, timeBomb: { initial: 1, everyMoves: 2, timer: 6, wallDamagePct: 0.1, maxAlive: 3 } } });
    if (mods !== undefined) gs.setSpiritMods(mods, 5);
    for (let i = 0; i < 400; i++) gs.board.randomType();
    return JSON.stringify({ grid: gs.board.grid, att: gs.board.attachments, occ: gs.board.occupants, next: gs.board.rng() });
  };
  assert.equal(play(null), play(undefined));
  assert.equal(play({ clock: 0, breaker: 0, paint: null }), play(undefined));
  assert.notEqual(play({ clock: 1, breaker: 0, paint: null }), play(undefined));
});

// ---------- 연결(게임 경로) ----------
test('sup_tinker: BattleController를 거쳐 실제 하단 아이템 쿨다운이 줄어든다', async () => {
  const { BattleController } = await import('../src/game/battleController.js');
  const { playerState } = await import('../src/game/playerState.js');
  const balance = load('balance.json');
  const enemiesCfg = load('enemies.json');
  playerState.tutorial = { ...playerState.tutorial, done: true };
  const c = new BattleController({
    balance, enemies: enemiesCfg, obstacles: OBSTACLES, floorsData: load('floors.json'), towersBaseData: balance.tower.towers, itemsConfig: ITEMS, spiritsConfig: CFG,
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: enemiesCfg.attackInterval, effectDurationsMs: { enemyDie: 100, towerAttack: 100, enemyHit: 100, spiritProc: 100 } },
  });
  const inv = playerState.inventory;
  inv.grant({ spirits: ['sup_tinker'] }, { src: 't' });
  inv.equipSpirit(2, 'sup_tinker'); // 번개 수호자
  c.devSetFloor(2);
  for (let i = 0; i < 100 && !c.battleState.enemies.some((e) => e.state === 'alive'); i++) c.update(0.1);
  assert.equal(c.battleState.spirits[2].key, 'tinker');
  c.items._lastUseAt = { scythe_h: 0, repair: 0 }; // 둘 다 방금 쓴 상태(gameState 없음 = 유효 스왑 0)
  const before = [c.items.cooldownLeft('scythe_h'), c.items.cooldownLeft('repair')];
  assert.ok(before[0] > 1 && before[1] > 1, `쿨다운 중: ${before}`);
  const every = c.battleState.spirits[2].every;
  for (let n = 1; n < every; n++) {
    c.battleState.enemies.forEach((e) => (e.currentHealth = e.maxHealth = 1e9));
    c.battleState.applyGemClear('yellow', 1, 1);
  }
  c.update(0.01);
  assert.deepEqual([c.items.cooldownLeft('scythe_h'), c.items.cooldownLeft('repair')], before, `${every - 1}발까지는 그대로`);
  c.battleState.applyGemClear('yellow', 1, 1);
  c.update(0.01);
  c.update(0.01); // 같은 이벤트를 두 번 세지 않는다
  assert.deepEqual([c.items.cooldownLeft('scythe_h'), c.items.cooldownLeft('repair')], before.map((n) => n - 1), `${every}발째에 전부 -1`);
});

test('sup_breaker: 추가 피해가 난 방해요소 이펙트가 브리지를 거쳐 spiritProc(그 수호자)로 나간다', async () => {
  const { PuzzleBattleBridge } = await import('../src/game/puzzleBattleBridge.js');
  const state = makeState();
  equip(state, [null, null, null, L1('sup_breaker'), null]);
  const bridge = new PuzzleBattleBridge(state);
  const board = { cellStates: [], cols: 6 };
  const fx = (extra) => ({ type: 'obstacleDamaged', id: 'stone', cell: { row: 0, col: 0 }, hp: 1, cause: 'adjacentMatch', elapsedMs: 0, durationMs: 1, ...extra });
  bridge.update({ board, resolutions: [], effects: [fx()] });
  assert.equal(procs(state, 'breaker').length, 0, '보통 피해에는 안 나간다');
  bridge.update({ board, resolutions: [], effects: [fx({ spiritBonus: true }), fx({ spiritBonus: true, elapsedMs: 5 })] });
  assert.deepEqual(procs(state, 'breaker').map((e) => [e.towerIndex, e.role]), [[3, 'support']], '이번 틱에 생긴 것만 한 번');
  // 정령이 없는 전투면 아무 일도 없다.
  const plain = makeState();
  new PuzzleBattleBridge(plain).update({ board, resolutions: [], effects: [fx({ spiritBonus: true })] });
  assert.equal(plain.events.filter((e) => e.type === 'spiritProc').length, 0);
  // 보드에서 실제로: 해체 확률 100%면 돌덩이(HP 2)가 매치 옆 피해 한 번에 부서지고 spiritBonus가 붙는다.
  const gs = new GameState({ seed: 3, obstaclesConfig: OBSTACLES });
  gs.setSpiritMods({ clock: 0, breaker: 1, paint: null }, 5);
  gs.board.occupants[0] = { type: 'stone', hp: 2 };
  gs._damageObstacles({ columns: new Set() }, [{ row: 0, col: 0 }], 1, 'adjacentMatch');
  assert.deepEqual(gs.effects.filter((e) => e.spiritBonus).map((e) => e.type), ['obstacleDestroyed']);
});
