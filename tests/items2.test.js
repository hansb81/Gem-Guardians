// 2차 아이템 9종(docs/items.md A6·A7·B3·B4·B5·C1·C2·C3, config/items.json) 로직 테스트.
// 보드 아이템은 실제 GameState(+PuzzleBattleBridge 스텁), 전투 아이템은 실제 BattleState,
// 층 시작 전·부활은 BattleController(실제 config)로 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Board, OBSTACLE, COLORLESS } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { SPECIAL_KIND } from '../src/core/specials.js';
import { GEM_TYPES } from '../src/config/gems.js';
import { PuzzleBattleBridge } from '../src/game/puzzleBattleBridge.js';
import { ItemController } from '../src/game/itemController.js';
import { BattleState } from '../src/battle/battleState.js';
import { BattleController } from '../src/game/battleController.js';
import { playerState } from '../src/game/playerState.js';
import { Inventory } from '../src/game/inventory.js';
import { itemPrice } from '../src/core/economy/economy.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../config/${name}`, import.meta.url), 'utf8'));
const OBSTACLES = load('obstacles.json');
const ITEMS = load('items.json');
const BALANCE = load('balance.json');
const DATA = { balance: BALANCE, enemies: load('enemies.json'), obstacles: OBSTACLES, floorsData: load('floors.json') };
const BOMB = () => ({ type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 });

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
}

// 3매치 없는 7x7((r*2+c)%5), (1,2)=0으로 가능한 수 하나.
function noMatchBoard7() {
  const values = [];
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) values.push((r * 2 + c) % 5);
  values[1 * 7 + 2] = 0;
  const board = boardFromGrid(7, 7, values);
  assert.equal(findMatches(board).length, 0);
  return board;
}

function makeFakeBattleState() {
  return {
    status: 'active',
    calls: [],
    applyGemClear(color, count, cascadeIndex, isSpecial, specialType) {
      if (!specialType) this.calls.push({ color, count, cascadeIndex });
    },
    applyObstacleWallDamage() {},
  };
}

function drain(state, bridge = null, { dt = 0.02, maxTicks = 3000 } = {}) {
  let ticks = 0;
  const busy = () => state.resolutions.length > 0 || state.board.cellStates.some((cs) => cs !== null);
  while (busy() && ticks < maxTicks) {
    state.update(dt);
    bridge?.update(state);
    ticks++;
  }
  assert.ok(ticks < maxTicks);
}

// ItemController가 읽는 player = { bestFloor, inventory }. items/preFloor는 테스트 읽기 편의(inv 묶음 그대로).
// barrier는 5번째 칸이었는데 hotbar는 최대 4칸 - canUse 장착 검사를 받지 않는 테스트(전투 직접 호출)에서만 쓴다.
function makePlayer({ bestFloor = 30, items = {} } = {}) {
  const inventory = new Inventory({
    items: { ...Object.fromEntries(Object.keys(ITEMS.items).map((id) => [id, 3])), ...items },
    loadout: { hotbar: ['dye', 'shuffle', 'defuse', 'drum'] },
    perm: { flags: ['slot4'] },
  }, { config: ITEMS });
  return { bestFloor, inventory, get items() { return inventory.data.items; }, get preFloor() { return inventory.data.loadout.preFloor; } };
}

function makeBattle(spawns, wallHp = 100) {
  return new BattleState({
    towersData: [{ id: 'tower_red', color: 'red', stats: { attack: 10 } }],
    resolvedFloor: { wallHp, interval: 0.1, spawns },
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: { enemiesUnfrozen: 1e9, wallShieldOn: 1e9, wallShieldOff: 1e9, atkBuffOn: 1e9, atkBuffOff: 1e9 } },
  });
}
const stat = (rank) => ({ type: 'x', rank, name: 'X', hp: 1000, def: 0, speed: 0.05, wallDmg: 5, gold: 1 });

function makeController() {
  return new BattleController({
    ...DATA,
    towersBaseData: BALANCE.tower.towers,
    itemsConfig: ITEMS,
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: {} },
  });
}

// ---------------- 염료 ----------------

test('염료: 일반 잼 색이 바뀌고 매치가 없으면 Resolution 없음', () => {
  const board = noMatchBoard7();
  const state = new GameState({ board });
  assert.equal(state.useDye(0, 0, 3), true);
  assert.equal(board.get(0, 0), 3);
  assert.equal(state.resolutions.length, 0);
  assert.equal(state.validSwapCount, 0);
});

test('염료: 라인 잼은 모양(종류·방향) 그대로 색만 바뀌고, 시한폭탄은 붙은 채', () => {
  const board = noMatchBoard7();
  const idx = board.index(4, 4);
  board.specials[idx] = { kind: SPECIAL_KIND.LINE, direction: 'vertical' };
  board.attachments[idx] = BOMB();
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });
  assert.equal(state.useDye(4, 4, 1), true);
  assert.equal(board.grid[idx], 1);
  assert.deepEqual(board.specials[idx], { kind: SPECIAL_KIND.LINE, direction: 'vertical' });
  assert.equal(board.attachments[idx].type, 'timeBomb');
});

test('염료: 무지개 잼·occupant 칸·이미 그 색이면 invalidTarget(ItemController에서 소모 없음)', () => {
  const board = noMatchBoard7();
  board.grid[board.index(0, 0)] = COLORLESS;
  board.specials[board.index(0, 0)] = { kind: SPECIAL_KIND.COLOR, direction: null };
  board.grid[board.index(3, 3)] = OBSTACLE;
  board.occupants[board.index(3, 3)] = { type: 'crate', hp: 1 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });
  assert.equal(state.useDye(0, 0, 1), 'invalidTarget');
  assert.equal(state.useDye(3, 3, 1), 'invalidTarget');
  assert.equal(state.useDye(6, 6, board.get(6, 6)), 'invalidTarget');

  const player = makePlayer();
  const ctrl = new ItemController({ config: ITEMS, player, gameState: state });
  assert.deepEqual(ctrl.use('dye', { row: 0, col: 0, color: 1 }), { ok: false, reason: 'invalidTarget' });
  assert.deepEqual(ctrl.use('dye', { row: 0, col: 1, color: 9 }), { ok: false, reason: 'invalidTarget' });
  assert.equal(player.items.dye, 3);
  assert.equal(ctrl.cooldownLeft('dye'), 0);
});

test('염료: 바꾼 뒤 매치 -> 평소 Resolution + 탑 사격 + 콤보, 스왑 수는 안 센다', () => {
  // (0,2)를 0으로 물들이면 row0 = [0,0,0](col2는 0,2,0이라 3매치가 아니다 - 특수 잼 생성 없음).
  const board = boardFromGrid(3, 3, [0, 0, 1, 1, 2, 2, 2, 1, 0]);
  const state = new GameState({ board });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);
  const player = makePlayer();
  const ctrl = new ItemController({ config: ITEMS, player, gameState: state });

  assert.deepEqual(ctrl.use('dye', { row: 0, col: 2, color: 0 }), { ok: true, reason: null });
  assert.equal(player.items.dye, 2);
  assert.equal(state.resolutions.length, 1);
  drain(state, bridge);
  assert.ok(fake.calls.some((c) => c.color === GEM_TYPES[0].id && c.count === 3));
  assert.equal(state.comboStreak, 1);
  assert.equal(state.validSwapCount, 0);
  assert.equal(ctrl.canUse('dye').reason, 'cooldown');
});

// ---------------- 섞기 부적 ----------------

test('섞기: 방해요소 칸은 고정, 셔플 이펙트 발생', () => {
  const board = noMatchBoard7();
  const idx = board.index(3, 3);
  board.grid[idx] = OBSTACLE;
  board.occupants[idx] = { type: 'stone', hp: 2 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });
  const before = board.grid.slice();
  assert.equal(state.useShuffle(), true);
  assert.equal(board.grid[idx], OBSTACLE);
  assert.deepEqual(board.occupants[idx], { type: 'stone', hp: 2 });
  assert.notDeepEqual(board.grid, before);
  assert.ok(state.effects.some((e) => e.type === 'shuffle'));
});

test('섞기: 연쇄 중엔 예약, Resolution이 끝나면 실행·소모', () => {
  const state = new GameState({ board: noMatchBoard7() });
  const player = makePlayer();
  const ctrl = new ItemController({ config: ITEMS, player, gameState: state });
  state.useHammer(2, 5);
  assert.equal(state.useShuffle(), false);
  assert.deepEqual(ctrl.use('shuffle'), { ok: true, reason: null, pending: true });
  assert.equal(player.items.shuffle, 3);

  let result = null;
  for (let i = 0; i < 200 && !result; i++) {
    state.update(0.02);
    result = ctrl.update(0.02);
  }
  assert.deepEqual(result, { id: 'shuffle', ok: true, reason: null });
  assert.equal(player.items.shuffle, 2);
  assert.ok(state.effects.some((e) => e.type === 'shuffle'));
});

// ---------------- 결계 두루마리 ----------------

test('결계: 동안 적 성벽 공격·시한폭탄 폭발 피해 0, 끝나면 정상', () => {
  const bs = makeBattle([stat('normal')]);
  for (let i = 0; i < 3; i++) bs.update(0.1);
  bs.enemies[0].progress = 1;
  const { duration } = ITEMS.items.barrier;
  assert.equal(bs.shieldWall(duration), true);
  assert.ok(bs.events.some((e) => e.type === 'wallShieldOn'));
  for (let i = 0; i < 30; i++) bs.update(0.1); // 3초 - 공격 3번
  bs.applyObstacleWallDamage(0.1);
  assert.equal(bs.wallHealth, 100);

  bs.shieldWall(duration); // 갱신(남은 5 + 8이 아니라 8)
  assert.equal(bs.wallShieldSec, duration);
  for (let i = 0; i < 81; i++) bs.update(0.1);
  assert.ok(bs.events.some((e) => e.type === 'wallShieldOff'));
  for (let i = 0; i < 15; i++) bs.update(0.1);
  assert.ok(bs.wallHealth < 100, '끝나면 성벽 공격 재개');
  const hp = bs.wallHealth;
  bs.applyObstacleWallDamage(0.1);
  assert.equal(bs.wallHealth, hp - 10);
});

// ---------------- 해제 부적 ----------------

test('해제: 모든 시한폭탄 타이머 +5, 칸마다 timeBombTimerAdded 이펙트', () => {
  const board = noMatchBoard7();
  board.attachments[board.index(1, 1)] = BOMB();
  board.attachments[board.index(5, 2)] = { ...BOMB(), timer: 2 };
  const state = new GameState({ board, obstaclesConfig: OBSTACLES });
  const player = makePlayer();
  const ctrl = new ItemController({ config: ITEMS, player, gameState: state });
  assert.deepEqual(ctrl.use('defuse'), { ok: true, reason: null });
  assert.equal(board.attachments[board.index(1, 1)].timer, 10);
  assert.equal(board.attachments[board.index(5, 2)].timer, 7);
  state.update(0.02);
  const fx = state.effects.filter((e) => e.type === 'timeBombTimerAdded');
  assert.equal(fx.length, 2);
  assert.ok(fx.every((e) => e.add === 5));
  assert.equal(player.items.defuse, 2);
});

test('해제: 시한폭탄이 없으면 noTarget 실패(소모 없음), 21층 전엔 locked·목록에 없음', () => {
  const state = new GameState({ board: noMatchBoard7(), obstaclesConfig: OBSTACLES });
  const player = makePlayer();
  const ctrl = new ItemController({ config: ITEMS, player, gameState: state });
  assert.deepEqual(ctrl.use('defuse'), { ok: false, reason: 'noTarget' });
  assert.equal(player.items.defuse, 3);
  assert.equal(ctrl.cooldownLeft('defuse'), 0);

  const early = new ItemController({ config: ITEMS, player: makePlayer({ bestFloor: 20 }), gameState: state });
  assert.equal(early.isUnlocked('defuse'), false);
  assert.equal(early.canUse('defuse').reason, 'locked');

  // 지급: 최고 층 21 미만이면 키 자체가 없고, 21에 도달하면 3개.
  const saved = { bestFloor: playerState.bestFloor, inventory: playerState.inventory };
  playerState.inventory = new Inventory(null, { wallet: playerState }); // 새 플레이어
  playerState.bestFloor = 20;
  playerState.initItems(ITEMS);
  assert.deepEqual(playerState.inventory.hotbar(), ITEMS.starter.equipped, '첫 실행 자동 장착');
  assert.equal('defuse' in playerState.inventory.data.items, false);
  assert.equal(playerState.inventory.data.items.booster_line, 2);
  assert.equal(playerState.inventory.data.items.gold_coin, 1);
  assert.equal(playerState.inventory.data.items.revive, 1);
  assert.equal(playerState.inventory.data.items.dye, 3);
  playerState.bestFloor = 21;
  playerState.initItems(ITEMS);
  assert.equal(playerState.inventory.data.items.defuse, 3);
  playerState.initItems(ITEMS);
  assert.equal(playerState.inventory.data.items.defuse, 3, '두 번 안 준다(txId unlock:defuse)');
  assert.ok(playerState.inventory.data.grantedTx.includes('unlock:defuse'));
  Object.assign(playerState, saved);
});

// ---------------- 분노의 북 ----------------

test('북: 스왑 3번 동안 피해 x1.5, 3번째 스왑의 연쇄까지 적용, 그 뒤 원래대로, 쿨다운은 종료 후부터', () => {
  const bs = makeBattle([stat('normal')]);
  bs.update(0.1);
  const gs = { validSwapCount: 0, resolutions: [], board: new Board({ rows: 7, cols: 7, seed: 1 }) };
  const player = makePlayer();
  const ctrl = new ItemController({ config: ITEMS, player, gameState: gs, battleState: bs });
  const { mul, moves, cooldownMoves } = ITEMS.items.drum;

  assert.deepEqual(ctrl.use('drum'), { ok: true, reason: null });
  assert.equal(bs.applyGemClear('red', 1, 1).damage, 10 * mul);
  assert.equal(ctrl.buffSwapsLeft, moves);
  assert.equal(ctrl.canUse('drum').reason, 'cooldown', '버프 중엔 다시 못 쓴다');

  gs.validSwapCount = 2;
  ctrl.update(0.02);
  assert.equal(ctrl.buffSwapsLeft, 1);
  gs.validSwapCount = 3;
  gs.resolutions = [{ id: 1 }]; // 3번째 스왑의 연쇄 진행 중
  ctrl.update(0.02);
  assert.equal(ctrl.buffSwapsLeft, 0);
  assert.equal(bs.applyGemClear('red', 1, 1).damage, 10 * mul, '연쇄가 끝날 때까지 적용');

  gs.resolutions = [];
  ctrl.update(0.02);
  assert.equal(ctrl.buffSwapsLeft, null);
  assert.equal(bs.atkMul, 1);
  assert.ok(bs.events.some((e) => e.type === 'atkBuffOff'));
  assert.equal(bs.applyGemClear('red', 1, 1).damage, 10);
  assert.equal(ctrl.cooldownLeft('drum'), cooldownMoves, '쿨다운은 버프가 끝난 스왑 수부터');
  gs.validSwapCount = 3 + cooldownMoves;
  assert.equal(ctrl.canUse('drum').ok, true);
});

// ---------------- 시작 부스터 ----------------

test('부스터: 예약한 층 시작 보드에 라인 2 / 폭탄 1, 방해요소·시한폭탄 칸은 안 건드림, 같은 seed면 같은 칸', () => {
  const make = () => {
    const board = new Board({ rows: 7, cols: 7, seed: 42 });
    const o = board.index(2, 2);
    board.grid[o] = OBSTACLE;
    board.occupants[o] = { type: 'crate', hp: 1 };
    board.attachments[board.index(5, 5)] = BOMB();
    return new GameState({ board, obstaclesConfig: OBSTACLES });
  };
  const gs = make();
  const player = makePlayer();
  Object.assign(player.preFloor, { booster_line: true, booster_bomb: true });
  const ctrl = new ItemController({ config: ITEMS, player, gameState: gs });
  assert.deepEqual(ctrl.consumePreFloor(), ['booster_line', 'booster_bomb']);
  assert.equal(player.items.booster_line, 2);
  assert.equal(player.items.booster_bomb, 2);
  assert.deepEqual(player.preFloor, { booster_line: false, booster_bomb: false }, '소모되면 예약이 꺼진다');
  ctrl.applyStarterSpecials();

  const { board } = gs;
  const lines = board.specials.filter((s) => s?.kind === SPECIAL_KIND.LINE);
  const bombs = board.specials.filter((s) => s?.kind === SPECIAL_KIND.BOMB);
  assert.equal(lines.length, 2);
  assert.equal(bombs.length, 1);
  assert.ok(lines.every((s) => s.direction === 'horizontal' || s.direction === 'vertical'));
  assert.equal(board.specials[board.index(2, 2)], null);
  assert.equal(board.specials[board.index(5, 5)], null);

  const gs2 = make();
  gs2.placeStarterSpecials('line', 2);
  gs2.placeStarterSpecials('bomb', 1);
  assert.deepEqual(gs2.board.specials, board.specials);

  assert.deepEqual(ctrl.consumePreFloor(), [], '예약이 없으면 아무 것도 안 쓴다');
  assert.equal(ctrl.canUse('booster_line').ok, false, 'preFloor 아이템은 슬롯 use() 불가');
});

// ---------------- 황금 주화 ----------------

test('황금 주화: 층 골드(처치 + 클리어 보너스) 정확히 2배', () => {
  const controller = makeController();
  controller.devSetFloor(1);
  const run = (coin) => {
    playerState.inventory.data.items.gold_coin = 1;
    playerState.inventory.data.loadout.preFloor.gold_coin = coin;
    controller.retryFloor();
    controller.update(0.016); // 첫 update = 전투 시작 - 여기서 예약이 소모된다.
    assert.equal(controller.goldMul, coin ? ITEMS.items.gold_coin.mul : 1);
    for (const gold of [7, 11]) {
      controller.battleState.events.push({ type: 'enemyDie', enemyId: 99, gold, elapsedMs: 0, durationMs: 1e9 });
      controller.update(0.016);
    }
    controller.battleState.status = 'cleared';
    controller.update(0.016);
    return controller.lastClearReward.total;
  };
  const base = run(false);
  assert.equal(run(true), base * 2);
  assert.equal(playerState.inventory.data.items.gold_coin, 0);
  assert.equal(playerState.inventory.data.loadout.preFloor.gold_coin, false);
});

// ---------------- 부활 ----------------

test('부활: HP 0 -> 부활 -> HP 50%, 적 2초 정지, 이어서 진행. 층당 1회, 두 번째 HP 0은 그대로 실패', () => {
  const controller = makeController();
  controller.devSetFloor(1);
  playerState.inventory.data.items.revive = 1;
  controller.retryFloor();
  const bs = controller.battleState;
  assert.equal(controller.canRevive(), false, '실패 전엔 버튼 없음');
  bs.applyObstacleWallDamage(1);
  assert.equal(bs.status, 'failed');
  assert.equal(controller.canRevive(), true);
  assert.equal(controller.revive(), true);
  assert.equal(bs.status, 'active');
  assert.equal(bs.wallHealth, Math.round(bs.wallMaxHealth * ITEMS.items.revive.pct));
  assert.equal(bs._freeze.normal, ITEMS.items.revive.freezeSec);
  assert.equal(bs._freeze.boss, ITEMS.items.revive.freezeSec * ITEMS.items.revive.bossMul, '보스는 1초');
  assert.ok(bs.events.some((e) => e.type === 'wallRevived'));
  assert.equal(playerState.inventory.data.items.revive, 0);
  for (let i = 0; i < 25; i++) bs.update(0.1);
  assert.equal(bs.frozen, false);

  playerState.inventory.data.items.revive = 1; // 보유해도 층당 1회
  bs.applyObstacleWallDamage(1);
  assert.equal(bs.status, 'failed');
  assert.equal(controller.canRevive(), false);
  assert.equal(controller.revive(), false);
  assert.equal(playerState.inventory.data.items.revive, 1);

  controller.retryFloor();
  playerState.inventory.data.items.revive = 0;
  controller.battleState.applyObstacleWallDamage(1);
  assert.equal(controller.canRevive(), false, '보유 0개면 숨김');
});

test('부활 정지: 보스는 freezeSec x bossMul(1초)만 멈추고 일반 적은 2초', () => {
  const bs = makeBattle([stat('normal'), stat('boss')]);
  for (let i = 0; i < 3; i++) bs.update(0.1);
  const [normal, boss] = bs.enemies;
  bs.wallHealth = 0;
  bs.status = 'failed';
  const { pct, freezeSec, bossMul } = ITEMS.items.revive;
  assert.equal(bs.revive(pct, freezeSec, bossMul), true);
  const p = [normal.progress, boss.progress];
  for (let i = 0; i < 13; i++) bs.update(0.1); // 1.3초 - 보스(1초)만 풀림(0.1 누적 오차 여유)
  assert.equal(normal.progress, p[0]);
  assert.ok(boss.progress > p[1]);
  for (let i = 0; i < 10; i++) bs.update(0.1); // 2.3초
  assert.ok(normal.progress > p[0]);
});

test('메뉴로 나가기(retryFloor)만 하면 예약 유지, 전투가 시작(첫 update)돼야 소모', () => {
  const controller = makeController();
  controller.devSetFloor(1);
  playerState.inventory.data.items.booster_line = 1;
  playerState.inventory.data.loadout.preFloor.booster_line = true;
  controller.retryFloor(); // startExitToMenu가 거치는 경로
  controller.retryFloor();
  assert.equal(playerState.inventory.data.loadout.preFloor.booster_line, true);
  assert.equal(playerState.inventory.data.items.booster_line, 1);
  assert.deepEqual(controller.items.preFloorUsed, []);

  const gs = new GameState({ board: noMatchBoard7() });
  controller.items.gameState = gs;
  controller.update(0.016);
  assert.equal(playerState.inventory.data.loadout.preFloor.booster_line, false);
  assert.equal(playerState.inventory.data.items.booster_line, 0);
  assert.equal(gs.board.specials.filter((sp) => sp?.kind === SPECIAL_KIND.LINE).length, 2, '시작 보드에 적용');
  controller.update(0.016);
  assert.equal(playerState.inventory.data.items.booster_line, 0, '두 번째 update는 다시 소모하지 않는다');
});

test('결계 중 적 공격은 wallBlocked(같은 적 0.5초에 한 번)만 내고 wallDamaged는 없다', () => {
  const bs = makeBattle([stat('normal')]);
  bs.battleConfig.effectDurationsMs.wallBlocked = 1e9;
  bs.battleConfig.effectDurationsMs.wallDamaged = 1e9;
  for (let i = 0; i < 3; i++) bs.update(0.1);
  bs.enemies[0].progress = 1;
  bs.enemies[0]._attackTimer = 0.9; // 공격 간격 1초를 0.2초 간격으로 여러 번 때리게.
  bs.battleConfig.attackIntervalSec = 0.2;
  const { duration, blockFlashSec } = ITEMS.items.barrier;
  bs.shieldWall(duration, blockFlashSec);
  for (let i = 0; i < 10; i++) bs.update(0.1); // 1초 - 공격 5번
  const blocked = bs.events.filter((e) => e.type === 'wallBlocked');
  assert.equal(blocked.length, 2, '0.5초에 한 번');
  assert.equal(blocked[0].sourceEnemyId, bs.enemies[0].id);
  assert.equal(blocked[0].source, 'enemy');
  bs.applyObstacleWallDamage(0.1);
  const bomb = bs.events.filter((e) => e.type === 'wallBlocked' && e.source === 'timeBomb');
  assert.equal(bomb.length, 1, '시한폭탄 폭발도 wallBlocked');
  assert.equal(bs.events.filter((e) => e.type === 'wallDamaged').length, 0);
  assert.equal(bs.wallHealth, 100);
  bs.wallShieldSec = 0;
  for (let i = 0; i < 3; i++) bs.update(0.1);
  assert.ok(bs.events.some((e) => e.type === 'wallDamaged'), '결계가 끝나면 피해 재개');
  assert.equal(bs.events.filter((e) => e.type === 'wallBlocked').length, 3);
});

// ---------------- 공통: 보상 풀·가격·장착·예약 토글 ----------------

test('보스 첫 클리어 보상 풀 = hotbar 중 골드 구매 가능·해금된 것만(21층 전 해제 부적 제외)', () => {
  const controller = makeController();
  for (let f = 10; f <= 100; f += 10) {
    controller.devSetFloor(f);
    const granted = controller._grantFirstClearItems();
    assert.equal(granted.length, 2);
    for (const id of granted) {
      const cfg = ITEMS.items[id];
      assert.equal(cfg.group, 'hotbar', `${f}층 ${id}`);
      assert.notEqual(cfg.goldBase, null);
      if (f < 21) assert.notEqual(id, 'defuse');
    }
  }
  // 20층 보상에 defuse가 절대 없는지 seed 전수 대신 풀 자체를 확인한다.
  playerState.bestFloor = 20;
  assert.equal(controller.items.isUnlocked('defuse'), false);
});

test('itemPrice: goldBase null(다이아 전용)이면 null, 다이아 값은 config에서', () => {
  assert.equal(itemPrice(DATA, ITEMS, 'gold_coin', 10), null);
  assert.equal(itemPrice(DATA, ITEMS, 'revive', 10), null);
  assert.equal(ITEMS.items.gold_coin.diamond, 30);
  assert.equal(ITEMS.items.revive.diamond, 50);
  assert.ok(itemPrice(DATA, ITEMS, 'dye', 10) > 0);
});

test('장착은 hotbar 그룹만, 예약 토글은 preFloor 그룹만(재고 필요)', () => {
  playerState.initItems(ITEMS);
  const inv = playerState.inventory;
  inv.endFloor();
  assert.equal(inv.equip(0, 'booster_line').reason, 'notEquipable');
  assert.equal(inv.equip(0, 'revive').reason, 'notEquipable');
  inv.unequip(0);
  assert.equal(inv.equip(0, 'dye').ok, true);
  assert.equal(inv.setReserve('dye', true).reason, 'notEquipable');
  inv.data.items.booster_bomb = 0;
  inv.data.loadout.preFloor.booster_bomb = false;
  assert.equal(inv.setReserve('booster_bomb', true).reason, 'noStock', '재고 0이면 못 켠다');
  inv.data.items.booster_bomb = 1;
  assert.equal(inv.setReserve('booster_bomb', true).ok, true);
  assert.equal(inv.data.loadout.preFloor.booster_bomb, true);
  assert.equal(inv.setReserve('booster_bomb', false).ok, true);
  assert.equal(inv.data.loadout.preFloor.booster_bomb, false);
});

test('광고 이어하기: 깃털 없이 같은 효과, 층당 1회를 깃털과 공유, 다음 층에 리셋', () => {
  const controller = makeController();
  controller.devSetFloor(1);
  playerState.inventory.data.items.revive = 1;
  controller.retryFloor();
  const bs = controller.battleState;
  assert.equal(controller.adContinue(), false, '실패 전엔 안 됨');
  bs.applyObstacleWallDamage(1);
  assert.equal(controller.adContinueLeft(), 1);
  assert.equal(controller.adContinue(), true);
  assert.equal(bs.status, 'active');
  assert.equal(bs.wallHealth, Math.round(bs.wallMaxHealth * ITEMS.items.revive.pct));
  assert.equal(bs._freeze.normal, ITEMS.items.revive.freezeSec);
  assert.equal(playerState.inventory.data.items.revive, 1, '깃털은 차감 안 함');
  bs.applyObstacleWallDamage(1);
  assert.equal(controller.canRevive(), false, '광고로 이어했으면 깃털도 숨김');
  assert.equal(controller.adContinueLeft(), 0);
  assert.equal(controller.adContinue(), false);

  controller.retryFloor();
  controller.battleState.applyObstacleWallDamage(1);
  assert.equal(controller.revive(), true, '깃털 먼저');
  controller.battleState.applyObstacleWallDamage(1);
  assert.equal(controller.adContinueLeft(), 0, '깃털을 썼으면 광고도 숨김');
  controller.retryFloor();
  assert.equal(controller.adContinueLeft(), 1, '층이 바뀌면 리셋');
});
