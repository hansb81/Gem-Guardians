// 하단 장착 아이템 1차 7개(docs/items.md, config/items.json) 로직 테스트.
// 보드 아이템은 실제 GameState + PuzzleBattleBridge(applyGemClear 기록 스텁)로, 방해요소는 실제
// config/obstacles.json으로 확인한다(damagedBy에 "item"이 있어야 망치/낫이 피해를 준다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Board, OBSTACLE, COLORLESS } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { SPECIAL_KIND } from '../src/core/specials.js';
import { GEM_TYPES } from '../src/config/gems.js';
import { PuzzleBattleBridge } from '../src/game/puzzleBattleBridge.js';
import { Inventory } from '../src/game/inventory.js';
import { ItemController } from '../src/game/itemController.js';
import { BattleState } from '../src/battle/battleState.js';
import { itemPrice } from '../src/core/economy/economy.js';
import { getFloor, unitStats } from '../src/core/balance/floorGen.js';
import { hasAnyValidMove } from '../src/core/moves.js';
import { BattleController } from '../src/game/battleController.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../config/${name}`, import.meta.url), 'utf8'));
const OBSTACLES = load('obstacles.json');
const ITEMS = load('items.json');
const BALANCE = load('balance.json');
const DATA = { balance: BALANCE, enemies: load('enemies.json'), obstacles: OBSTACLES, floorsData: load('floors.json') };

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
}

// 3매치가 하나도 없는 7x7 격자((r*2+c)%5 - 가로·세로 이웃이 항상 다른 색). (1,2)=0으로 바꿔
// 가능한 수((2,1)<->(1,1))를 하나 남긴다 - 없으면 해소 뒤 자동 재배치가 돌아 검증이 흔들린다.
function noMatchBoard7({ withMove = true } = {}) {
  const values = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) values.push((r * 2 + c) % 5);
  if (withMove) values[1 * 7 + 2] = 0;
  const board = boardFromGrid(7, 7, values);
  assert.equal(findMatches(board).length, 0, '사전 조건: 매치 없음');
  return board;
}

function makeFakeBattleState() {
  return {
    status: 'active',
    calls: [],
    skills: [],
    applyGemClear(color, count, cascadeIndex, isSpecial, specialType) {
      if (specialType) this.skills.push({ color, specialType });
      else this.calls.push({ color, count, cascadeIndex });
    },
  };
}

// 다 끝날 때까지 돌리며 한 번이라도 'clearing'이 된 칸 인덱스를 모은다.
function drain(state, bridge = null, { dt = 0.02, maxTicks = 3000 } = {}) {
  const { board } = state;
  const cleared = new Set();
  let ticks = 0;
  const busy = () => state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null);
  while (busy() && ticks < maxTicks) {
    state.update(dt);
    bridge?.update(state);
    board.cellStates.forEach((cs, i) => cs?.phase === 'clearing' && cleared.add(i));
    ticks++;
  }
  assert.ok(ticks < maxTicks, '상한 안에 끝나야 한다');
  return cleared;
}

// ---------------- 망치 ----------------

test('망치로 잼 1개를 지우면 그 색 탑이 1발분(count 1) applyGemClear를 받는다', () => {
  const board = boardFromGrid(3, 3, [0, 1, 2, 2, 0, 1, 1, 2, 0]);
  const state = new GameState({ board });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);

  assert.equal(state.useHammer(1, 1), true);
  drain(state, bridge);

  const shots = fake.calls.filter((c) => c.color === GEM_TYPES[0].id);
  assert.deepEqual(shots[0], { color: GEM_TYPES[0].id, count: 1, cascadeIndex: 1 });
});

test('망치: 돌덩이는 hp 2 -> 1만 깎이고 칸은 그대로', () => {
  const board = noMatchBoard7();
  const stoneIdx = board.index(3, 3);
  board.grid[stoneIdx] = OBSTACLE;
  board.occupants[stoneIdx] = { type: 'stone', hp: 2 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });

  assert.equal(state.useHammer(3, 3), true);
  drain(state);
  assert.equal(board.occupants[stoneIdx].hp, 1);
  assert.equal(board.grid[stoneIdx], OBSTACLE);
});

test('망치: 나무상자는 파괴되고 위 잼이 그 자리로 떨어진다', () => {
  const board = noMatchBoard7();
  const crateIdx = board.index(3, 0);
  board.grid[crateIdx] = OBSTACLE;
  board.occupants[crateIdx] = { type: 'crate', hp: 1 };
  const above = board.grid[board.index(2, 0)];
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });

  assert.equal(state.useHammer(3, 0), true);
  drain(state);
  assert.equal(board.occupants[crateIdx], null);
  assert.equal(board.grid[crateIdx], above, '부서진 자리로 위 잼이 떨어진다');
});

test('망치로 시한폭탄이 붙은 잼을 치면 해제된다', () => {
  const board = noMatchBoard7();
  const idx = board.index(4, 4);
  board.attachments[idx] = { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });
  state.useHammer(4, 4);
  drain(state);
  assert.ok(board.attachments.every((a) => a === null));
});

// ---------------- 낫 ----------------

test('가로 낫: 그 줄 7칸이 clearing되고, 줄 안 라인/폭탄 잼이 발동해 줄 밖 칸도 지워진다', () => {
  const board = noMatchBoard7();
  board.specials[board.index(3, 2)] = { kind: SPECIAL_KIND.LINE, direction: 'vertical' };
  board.specials[board.index(3, 5)] = { kind: SPECIAL_KIND.BOMB, direction: null };
  const state = new GameState({ board });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);

  assert.equal(state.useScythe('row', 3), true);
  const cleared = drain(state, bridge);

  for (let c = 0; c < 7; c++) assert.ok(cleared.has(board.index(3, c)), `(3,${c}) clearing`);
  assert.ok(cleared.has(board.index(0, 2)), '세로 라인 잼 -> 2열 위쪽');
  assert.ok(cleared.has(board.index(2, 6)), '폭탄 잼 -> (2,6)');
  assert.ok(fake.skills.some((s) => s.specialType === 'line_v'), '라인 잼 기술 발동');
  assert.ok(fake.skills.some((s) => s.specialType === 'bomb'), '폭탄 잼 기술 발동');
});

test('세로 낫: 위쪽 끝에서부터 거리순으로 지연, 줄 안 돌덩이는 1 피해만', () => {
  const board = noMatchBoard7();
  const stoneIdx = board.index(6, 1);
  board.grid[stoneIdx] = OBSTACLE;
  board.occupants[stoneIdx] = { type: 'stone', hp: 2 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });

  assert.equal(state.useScythe('col', 1), true);
  assert.equal(board.cellStates[board.index(0, 1)].phase, 'clearing', '위쪽 끝은 즉시');
  assert.equal(board.cellStates[board.index(5, 1)].phase, 'armed');
  assert.ok(board.cellStates[board.index(5, 1)].durationMs > board.cellStates[board.index(2, 1)].durationMs);
  assert.equal(board.occupants[stoneIdx].hp, 1);
  drain(state);
});

test('아이템 사용 뒤 시한폭탄 타이머와 validSwapCount는 그대로', () => {
  const board = noMatchBoard7();
  const idx = board.index(6, 6);
  board.attachments[idx] = { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });

  state.useScythe('row', 0);
  drain(state);
  state.useHammer(0, 3);
  drain(state);
  const bomb = board.attachments.find((a) => a);
  assert.equal(bomb.timer, 5);
  assert.equal(state.validSwapCount, 0);
});

test('대상 칸이 바쁘면 실패(false)', () => {
  const board = noMatchBoard7();
  const state = new GameState({ board });
  state.useHammer(5, 5);
  assert.equal(state.useHammer(0, 5), false, '같은 열이 애니메이션 중');
  assert.equal(state.useScythe('row', 2), false, '줄이 잠긴 열을 지난다');
  assert.equal(state.useHammer(0, 0), true, '다른 열은 가능');
});

// ---------------- 무지개 결정 ----------------

test('무지개 결정: 그 칸이 COLOR 특수 잼이 되고 매치·사격은 없다. 특수 잼 칸엔 실패', () => {
  const board = noMatchBoard7();
  board.specials[board.index(0, 0)] = { kind: SPECIAL_KIND.LINE, direction: 'horizontal' };
  const state = new GameState({ board });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);

  assert.equal(state.useRainbow(0, 0), false);
  assert.equal(state.useRainbow(2, 2), true);
  const idx = board.index(2, 2);
  assert.equal(board.grid[idx], COLORLESS);
  assert.deepEqual(board.specials[idx], { kind: SPECIAL_KIND.COLOR, direction: null });
  state.update(0.02);
  assert.ok(state.effects.some((e) => e.type === 'specialCreate' && e.kind === SPECIAL_KIND.COLOR));
  const cleared = drain(state, bridge);
  assert.equal(cleared.size, 0);
  assert.equal(fake.calls.length, 0);
});

// ---------------- 교환 장갑 ----------------

test('교환 장갑: 매치 없는 스왑이 그대로 확정된다(force 없으면 원복)', () => {
  const board = noMatchBoard7();
  const a = board.grid[board.index(0, 0)];
  const b = board.grid[board.index(0, 1)];
  const state = new GameState({ board });

  assert.equal(state.trySwap(0, 0, 0, 1, { force: true }), true);
  assert.equal(state.resolutions.length, 0);
  drain(state);
  assert.equal(board.grid[board.index(0, 0)], b);
  assert.equal(board.grid[board.index(0, 1)], a);
  assert.equal(state.validSwapCount, 0);

  state.trySwap(1, 0, 1, 1);
  drain(state);
  assert.equal(board.grid[board.index(1, 0)], (2 + 0) % 5, '일반 스왑은 원복');
});

test('교환 장갑: 매치되는 스왑은 평소처럼 Resolution, 단 스왑 수·시한폭탄은 안 센다', () => {
  // (0,2)<->(1,2) 스왑하면 row0 = [0,0,0].
  const board = boardFromGrid(3, 3, [0, 0, 1, 1, 2, 0, 2, 1, 0]);
  board.attachments[board.index(2, 0)] = { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);

  assert.equal(state.trySwap(0, 2, 1, 2, { force: true }), true);
  assert.equal(state.resolutions.length, 1);
  drain(state, bridge);
  assert.ok(fake.calls.some((c) => c.color === GEM_TYPES[0].id && c.count === 3));
  assert.equal(state.validSwapCount, 0);
  assert.equal(board.attachments.find((x) => x)?.timer, 5);
});

test('일반 유효 스왑은 validSwapCount를 1 올린다', () => {
  const board = boardFromGrid(3, 3, [0, 0, 1, 1, 2, 0, 2, 1, 0]);
  const state = new GameState({ board });
  state.trySwap(0, 2, 1, 2);
  assert.equal(state.validSwapCount, 1);
});

// ---------------- ItemController(쿨다운·층당 횟수·재고) ----------------

// ItemController가 읽는 player = { bestFloor?, inventory }. items는 테스트에서 읽기 편하게 inv.items를 그대로 노출.
function fakePlayer(items, hotbar) {
  const flags = hotbar.length > 3 ? ['slot4'] : [];
  const inventory = new Inventory({ items, loadout: { hotbar }, perm: { flags } }, { config: ITEMS });
  return { inventory, get items() { return inventory.data.items; } };
}

function makeController(items = {}) {
  const player = fakePlayer({ hammer: 5, scythe_h: 5, repair: 1, rainbow: 5, ...items }, ['hammer', 'scythe_h', 'rainbow', 'repair']);
  const gameState = {
    validSwapCount: 0,
    ok: true,
    board: new Board({ rows: 7, cols: 7, seed: 1 }),
    useHammer() { return this.ok; },
    useScythe() { return this.ok; },
    useRainbow() { return this.ok; },
  };
  const ctrl = new ItemController({ config: ITEMS, player, gameState });
  return { ctrl, player, gameState };
}

test('쿨다운: 망치 사용 후 유효 스왑 2번 전엔 cooldown, 2번 뒤 ok', () => {
  const { ctrl, player, gameState } = makeController();
  assert.deepEqual(ctrl.use('hammer', { row: 0, col: 0 }), { ok: true, reason: null });
  assert.equal(player.items.hammer, 4);
  assert.equal(ctrl.canUse('hammer').reason, 'cooldown');
  assert.equal(ctrl.cooldownLeft('hammer'), 2);
  gameState.validSwapCount = 1;
  assert.equal(ctrl.canUse('hammer').reason, 'cooldown');
  gameState.validSwapCount = 2;
  assert.equal(ctrl.canUse('hammer').ok, true);
  assert.equal(ctrl.perFloorLeft('hammer'), null);
});

test('층당 횟수 초과 시 perFloor, resetFloor(층 전환) 후 다시 가능', () => {
  const { ctrl, gameState } = makeController();
  for (let i = 0; i < 3; i++) {
    assert.equal(ctrl.use('scythe_h', { row: 0 }).ok, true);
    gameState.validSwapCount += 4;
  }
  assert.equal(ctrl.perFloorLeft('scythe_h'), 0);
  assert.equal(ctrl.canUse('scythe_h').reason, 'perFloor');
  ctrl.resetFloor();
  assert.equal(ctrl.canUse('scythe_h').ok, true);
});

test('재고 없음 noStock, 미장착 notEquipped, 무지개가 바빠 실패하면 차감도 쿨다운도 없음', () => {
  const { ctrl, player, gameState } = makeController({ hammer: 0, hourglass: 3 });
  assert.equal(ctrl.canUse('hammer').reason, 'noStock');
  assert.deepEqual(ctrl.use('hourglass'), { ok: false, reason: 'notEquipped' });
  assert.equal(player.items.hourglass, 3);
  gameState.ok = false;
  assert.deepEqual(ctrl.use('rainbow', { row: 0, col: 0 }), { ok: false, reason: 'busy' });
  assert.equal(player.items.rainbow, 5);
  assert.equal(ctrl.cooldownLeft('rainbow'), 0);
  assert.equal(ctrl.pending, null, '무지개는 예약하지 않는다');
});

// 기대값을 floors.json에서 따로 계산: 처치 골드 합 + round(합 x replayClearMul).
function floorReward(f) {
  const floor = getFloor(DATA.balance, DATA.enemies, DATA.obstacles, DATA.floorsData, f);
  const kill = floor.spawns.reduce((sum, sp) => sum + unitStats(DATA.balance, DATA.enemies, floor, sp).gold, 0);
  return kill + Math.round(kill * BALANCE.economy.replayClearMul);
}

test('itemPrice = round(goldBase x 실제 층 보상), 보스층이면 바로 아래 층 기준', () => {
  const gb = (id) => ITEMS.items[id].goldBase;
  assert.equal(itemPrice(DATA, ITEMS, 'hammer', 1), Math.round(gb('hammer') * floorReward(1)));
  assert.equal(itemPrice(DATA, ITEMS, 'rainbow', 21), Math.round(gb('rainbow') * floorReward(21)));
  assert.equal(getFloor(DATA.balance, DATA.enemies, DATA.obstacles, DATA.floorsData, 20).tag, 'boss');
  assert.equal(itemPrice(DATA, ITEMS, 'scythe_h', 20), Math.round(gb('scythe_h') * floorReward(19)));
  const tag = (f) => getFloor(DATA.balance, DATA.enemies, DATA.obstacles, DATA.floorsData, f).tag;
  assert.deepEqual([tag(14), tag(15), tag(16)], ['normal', 'elite', 'normal']);
  assert.equal(itemPrice(DATA, ITEMS, 'hammer', 15), Math.round(gb('hammer') * floorReward(14)), '엘리트층이면 아래 일반층 기준');
  assert.equal(itemPrice(DATA, ITEMS, 'hammer', 16), Math.round(gb('hammer') * floorReward(16)));
  assert.equal(itemPrice(DATA, ITEMS, 'scythe_h', 120), itemPrice(DATA, ITEMS, 'scythe_h', 120), '같은 층은 같은 값');
});

test('보스층 첫 클리어 보상 2개는 서로 다른 아이템', () => {
  const controller = new BattleController({
    ...DATA,
    towersBaseData: BALANCE.tower.towers,
    itemsConfig: ITEMS,
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: {} },
  });
  for (let f = 10; f <= 100; f += 10) {
    controller.devSetFloor(f);
    const granted = controller._grantFirstClearItems();
    assert.equal(granted.length, 2);
    assert.notEqual(granted[0], granted[1], `${f}층 보상 중복`);
  }
});

// ---------------- 예약 사용(낫·망치) ----------------

function realController(gameState) {
  const player = fakePlayer(Object.fromEntries(Object.keys(ITEMS.items).map((id) => [id, 3])), ['scythe_h', 'hammer', 'repair']);
  return { ctrl: new ItemController({ config: ITEMS, player, gameState }), player };
}

test('바쁜 줄에 낫 -> 예약, 줄이 정리되면 그때 실행·소모·쿨다운, 대기 중엔 다른 아이템 불가', () => {
  const gs = new GameState({ board: noMatchBoard7() });
  const { ctrl, player } = realController(gs);
  gs.useHammer(2, 5); // 5열 잠김

  assert.deepEqual(ctrl.use('scythe_h', { row: 2 }), { ok: true, reason: null, pending: true });
  assert.equal(player.items.scythe_h, 3);
  assert.equal(ctrl.canUse('hammer').reason, 'busy');

  let result = null;
  for (let i = 0; i < 100 && !result; i++) {
    gs.update(0.02);
    result = ctrl.update(0.02);
  }
  assert.deepEqual(result, { id: 'scythe_h', ok: true, reason: null });
  assert.equal(player.items.scythe_h, 2);
  assert.equal(ctrl.canUse('scythe_h').reason, 'cooldown');
  assert.ok(gs.board.cellStates.some((cs) => cs?.phase === 'armed'), '낫이 실제로 실행됐다');
});

test('예약이 1.5초 안에 안 되면 취소, 소모 없음', () => {
  const gs = new GameState({ board: noMatchBoard7() });
  const { ctrl, player } = realController(gs);
  gs.settleHold = true; // 중력을 막아 5열을 계속 잠가 둔다.
  gs.useHammer(2, 5);
  ctrl.use('hammer', { row: 0, col: 5 });

  let result = null;
  let t = 0;
  while (!result && t < 3) {
    gs.update(0.1);
    result = ctrl.update(0.1);
    t += 0.1;
  }
  assert.deepEqual(result, { id: 'hammer', ok: false, reason: 'busy' });
  assert.ok(t >= ITEMS.reserveSec - 1e-9 && t < ITEMS.reserveSec + 0.2);
  assert.equal(player.items.hammer, 3);
  assert.equal(ctrl.pending, null);
  assert.equal(ctrl.canUse('hammer').ok, true);
});

test('보드 밖 대상은 대기 없이 즉시 invalidTarget, 소모 없음', () => {
  const gs = new GameState({ board: noMatchBoard7() });
  const { ctrl, player } = realController(gs);
  player.inventory.data.loadout.hotbar = ['scythe_h', 'hammer', 'glove', null];
  assert.deepEqual(ctrl.use('scythe_h', { row: 7 }), { ok: false, reason: 'invalidTarget' });
  assert.deepEqual(ctrl.use('hammer', { row: 0, col: -1 }), { ok: false, reason: 'invalidTarget' });
  assert.deepEqual(ctrl.use('hammer'), { ok: false, reason: 'invalidTarget' });
  assert.deepEqual(ctrl.use('glove', { a: { row: 6, col: 6 }, b: { row: 6, col: 7 } }), { ok: false, reason: 'invalidTarget' });
  assert.equal(ctrl.pending, null);
  assert.equal(player.items.scythe_h, 3);
  assert.equal(player.items.hammer, 3);
  assert.equal(player.items.glove, 3);
});

// ---------------- 무지개 + 시한폭탄 / 장갑 후 재배치 ----------------

test('무지개 결정은 시한폭탄 잼에도 성공하고, 그 잼이 터지면 시한폭탄 해제', () => {
  const board = noMatchBoard7();
  const idx = board.index(4, 4);
  board.attachments[idx] = { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });

  assert.equal(state.useRainbow(4, 4), true);
  assert.equal(board.specials[idx].kind, SPECIAL_KIND.COLOR);
  assert.equal(board.attachments[idx].type, 'timeBomb', '붙은 채 유지');
  state.useHammer(4, 4);
  drain(state);
  assert.ok(board.attachments.every((a) => a === null));
});

test('무지개 결정은 occupant 칸엔 실패', () => {
  const board = noMatchBoard7();
  const idx = board.index(3, 3);
  board.grid[idx] = OBSTACLE;
  board.occupants[idx] = { type: 'crate', hp: 1 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });
  assert.equal(state.useRainbow(3, 3), false);
});

test('교환 장갑(매치 없음) 뒤 둘 수 있는 수가 없으면 즉시 재배치', () => {
  const board = noMatchBoard7({ withMove: false });
  assert.equal(hasAnyValidMove(board), false, '사전 조건: 원래 수가 없다');
  const state = new GameState({ board });
  assert.equal(state.trySwap(0, 0, 0, 1, { force: true }), true);
  assert.ok(state.effects.some((e) => e.type === 'shuffle'), '즉시 shuffle');
  assert.ok(hasAnyValidMove(board), '재배치 뒤엔 수가 있다');
});

test('교환 장갑(매치 없음) 뒤 수가 남아 있으면 재배치 안 함', () => {
  const state = new GameState({ board: noMatchBoard7() });
  assert.equal(state.trySwap(6, 5, 6, 6, { force: true }), true);
  assert.ok(!state.effects.some((e) => e.type === 'shuffle'));
});

// ---------------- 수리 망치 / 모래시계 ----------------

function makeBattle(spawns, wallHp = 100) {
  return new BattleState({
    towersData: [{ id: 'tower_red', color: 'red', stats: { attack: 10 } }],
    resolvedFloor: { wallHp, interval: 0.1, spawns },
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: { enemiesUnfrozen: 1e9 } },
  });
}

const stat = (rank) => ({ type: 'x', rank, name: 'X', hp: 1000, def: 0, speed: 0.05, wallDmg: 5, gold: 1 });

test('수리 망치: 최대 HP x 0.40 회복, 최대치를 넘지 않는다', () => {
  const bs = makeBattle([stat('normal')]);
  bs.wallHealth = 50;
  assert.equal(bs.healWall(ITEMS.items.repair.pct), true);
  assert.equal(bs.wallHealth, 90);
  bs.healWall(ITEMS.items.repair.pct);
  assert.equal(bs.wallHealth, 100);
  assert.ok(bs.events.some((e) => e.type === 'wallHealed'));
});

test('모래시계: 동안 적 progress·성벽 피해 그대로, 보스는 절반 시간, 다시 쓰면 갱신', () => {
  const bs = makeBattle([stat('normal'), stat('boss'), stat('normal')]);
  for (let i = 0; i < 3; i++) bs.update(0.1);
  const [normal, boss, atWall] = bs.enemies;
  atWall.progress = 1;
  const p = [normal.progress, boss.progress];
  const { duration } = ITEMS.items.hourglass;
  const bossMul = 0.5; // 보스 배율 동작 확인용(config는 1.0)

  bs.freezeEnemies(duration, bossMul);
  assert.ok(bs.events.some((e) => e.type === 'enemiesFrozen'));
  for (let i = 0; i < 20; i++) bs.update(0.1); // 2초
  assert.deepEqual([normal.progress, boss.progress], p);
  assert.equal(bs.wallHealth, 100);

  for (let i = 0; i < 10; i++) bs.update(0.1); // 3초 - 보스(2.5초)만 풀림
  assert.equal(normal.progress, p[0]);
  assert.ok(boss.progress > p[1]);
  assert.equal(bs.wallHealth, 100);

  bs.freezeEnemies(duration, bossMul); // 남은 2초 + 5초가 아니라 5초로 갱신
  assert.equal(bs._freeze.normal, duration);
  for (let i = 0; i < 70; i++) bs.update(0.1); // 5초 정지 + 성벽 공격 간격 1초 이상
  assert.ok(bs.events.some((e) => e.type === 'enemiesUnfrozen'));
  assert.ok(normal.progress > p[0]);
  assert.ok(bs.wallHealth < 100, '풀리면 성벽 공격 재개');
});
