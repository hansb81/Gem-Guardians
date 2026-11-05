// 퍼즐 방해요소(docs/balance.md 7장, config/obstacles.json) 테스트.
// 상자/돌/시한폭탄 3종 + "데이터만으로 등록되는 가짜 방해요소"(확장 구조 확인용)를 다룬다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, EMPTY, OBSTACLE } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { applyGravity } from '../src/core/gravity.js';
import { SPECIAL_KIND } from '../src/core/specials.js';

// ---- obstacles.json types(7-2)과 같은 모양의 타입 정의(테스트 전용, 실제 파일과 독립) ----
const CRATE = { name: '나무상자', layer: 'occupant', hp: 1, swappable: false, falls: true, matchable: false, damagedBy: ['adjacentMatch', 'specialEffect'] };
const STONE = { name: '돌덩이', layer: 'occupant', hp: 2, swappable: false, falls: true, matchable: false, damagedBy: ['adjacentMatch', 'specialEffect'] };
const TIME_BOMB = { name: '시한폭탄', layer: 'attachment', hp: 1, swappable: true, falls: true, matchable: true, damagedBy: ['gemCleared'] };
// 핸들러 없는 가짜 방해요소 - registry.js를 고치지 않고도 types에 항목만 추가하면 동작해야
// 한다는 "확장 구조" 자체를 확인하는 용도(docs/balance.md 7-1).
const TEST_ROCK = { name: '테스트용', layer: 'occupant', hp: 3, swappable: false, falls: true, matchable: false, damagedBy: ['adjacentMatch', 'specialEffect'] };

function obstaclesConfig(types, boardCap = 9) {
  return { boardCap, types };
}

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
}

// box.test.js/gameState.test.js와 같은 패턴 - resolutions/cellStates/effects가 모두 idle로
// 돌아올 때까지 틱을 돌리며 1회성 이펙트를 전부 누적 기록한다.
function drainAndCollectEffects(state, { dtSeconds = 0.01, maxTicks = 5000 } = {}) {
  const { board } = state;
  const seen = new Set();
  const found = [];
  const stillAnimating = () =>
    state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null) || state.effects.length > 0;
  let ticks = 0;
  while (stillAnimating() && ticks < maxTicks) {
    state.update(dtSeconds);
    for (const e of state.effects) {
      if (!seen.has(e)) {
        seen.add(e);
        found.push(e);
      }
    }
    ticks++;
  }
  assert.ok(ticks < maxTicks, '상한 안에 모든 애니메이션이 끝나야 한다');
  return found;
}

// ------------------------------------------------------------
// occupant(상자/돌): adjacentMatch 피해, 중복 방지, 스왑 불가
// ------------------------------------------------------------

// crate(hp1)가 상하좌우 매치로 파괴되는 공통 격자 - (1,0)이 occupant, (2,0)~(2,2)가
// swap(2,2,2,3)으로 가로 3매치가 된다. 사전에 다른 매치가 전혀 없음을 손으로 확인해 둔 배치.
function makeAdjacentMatchBoard(occupantType, hp) {
  const grid = [
    2, 3, 4, 2, //
    1, 1, 2, 3, // (1,0)은 occupant로 덮어쓸 자리(placeholder 값은 무시됨)
    0, 0, 1, 0, //
    4, 2, 3, 4,
  ];
  const board = boardFromGrid(4, 4, grid);
  const idx = board.index(1, 0);
  board.grid[idx] = OBSTACLE;
  board.occupants[idx] = { type: occupantType, hp };
  return { board, idx };
}

test('상자(occupant, hp1) 옆 매치가 생기면 1 피해로 즉시 파괴된다', () => {
  const { board, idx } = makeAdjacentMatchBoard('crate', CRATE.hp);
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ crate: CRATE }) });

  assert.equal(state.trySwap(2, 2, 2, 3), true);
  const effects = drainAndCollectEffects(state);

  assert.equal(board.occupants[idx], null, '파괴되면 occupant가 사라져야 한다');
  assert.ok(board.grid[idx] >= 0, '파괴된 칸은 중력/리필로 새 잼이 채워져야 한다');
  assert.ok(board.grid.every((v) => v !== EMPTY && v !== OBSTACLE), '보드에 빈 칸/방해요소 잔재가 남으면 안 된다');
  assert.ok(
    effects.some((e) => e.type === 'obstacleDestroyed' && e.id === 'crate' && e.cause === 'adjacentMatch'),
    'obstacleDestroyed 이펙트가 떠야 한다'
  );
});

// "돌은 2번 맞아야 파괴된다"를 두 단계로 나눠 확인한다: hp2는 1번 맞아도 살아남고(hp1로),
// hp1(=이미 1번 맞은 상태)은 1번 더 맞으면 파괴된다 - 합쳐서 "정확히 2번"을 증명한다.
test('돌(occupant, hp2)은 1번 맞아도 파괴되지 않고 hp만 줄어든다', () => {
  const { board, idx } = makeAdjacentMatchBoard('stone', 2);
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ stone: STONE }) });

  assert.equal(state.trySwap(2, 2, 2, 3), true);
  const effects = drainAndCollectEffects(state);

  // (2,0)이 매치로 지워져 생긴 빈 칸으로 (1,0)의 돌이 한 칸 떨어진다(falls:true) - 살아있는
  // occupant를 찾을 때는 떨어진 뒤의 위치(2,0)에서 확인해야 한다.
  assert.deepEqual(board.occupants[idx], null, '원래 자리는 떨어졌으니 비어있어야 한다');
  assert.deepEqual(board.occupants[board.index(2, 0)], { type: 'stone', hp: 1 });
  assert.ok(effects.some((e) => e.type === 'obstacleDamaged' && e.id === 'stone' && e.hp === 1));
  assert.ok(!effects.some((e) => e.type === 'obstacleDestroyed'));
});

test('돌(occupant, hp1 - 이미 1번 맞은 상태)이 한 번 더 맞으면 파괴된다', () => {
  const { board, idx } = makeAdjacentMatchBoard('stone', 1);
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ stone: STONE }) });

  assert.equal(state.trySwap(2, 2, 2, 3), true);
  const effects = drainAndCollectEffects(state);

  assert.equal(board.occupants[idx], null);
  assert.ok(effects.some((e) => e.type === 'obstacleDestroyed' && e.id === 'stone'));
});

test('한 해결 단계에서 같은 방해요소는 최대 1 피해만 받는다(두 매치 칸이 동시에 인접해도)', () => {
  // swap(2,0,2,1) 한 번으로 "가로 row0(0,0,0) + 세로 col0(0,0,0)"이 (0,0)을 공유하는 L자
  // 그룹 하나로 합쳐진다 - (1,0)과 (0,1) 둘 다 이 그룹에 속하고 둘 다 stone(1,1)과 인접하다.
  const grid = [
    0, 0, 0, //
    0, 1, 3, // (1,1)은 stone(hp2)로 덮어쓸 자리
    1, 0, 2,
  ];
  const board = boardFromGrid(3, 3, grid);
  const idx = board.index(1, 1);
  board.grid[idx] = OBSTACLE;
  board.occupants[idx] = { type: 'stone', hp: 2 };
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ stone: STONE }) });

  assert.equal(state.trySwap(2, 0, 2, 1), true);
  drainAndCollectEffects(state);

  assert.deepEqual(board.occupants[idx], { type: 'stone', hp: 1 }, '두 인접 칸이 같은 단계에서 매치돼도 1 피해만');
});

test('특수 잼(라인) 효과 범위에 든 occupant는 1 피해를 받는다', () => {
  // (1,1)에 세로 LINE 잼을 미리 둔다. swap(1,2,2,2)로 row1이 [0,0,0] 매치가 되면서
  // (1,1)이 매치에 낀 기존 특수 잼 -> 체인으로 자기 효과(세로줄 전체 삭제)가 발동한다.
  // crate(3,1)은 같은 열(col1)에 있어 그 효과 범위 안에 든다.
  const grid = [
    1, 2, 3, //
    0, 0, 4, //
    2, 3, 0, //
    3, 1, 1, // (3,1)은 occupant로 덮어쓸 자리
    4, 1, 2,
  ];
  const board = boardFromGrid(5, 3, grid);
  board.setSpecial(1, 1, { kind: SPECIAL_KIND.LINE, direction: 'vertical' });
  const idx = board.index(3, 1);
  board.grid[idx] = OBSTACLE;
  board.occupants[idx] = { type: 'crate', hp: CRATE.hp };
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ crate: CRATE }) });

  assert.equal(state.trySwap(1, 2, 2, 2), true);
  const effects = drainAndCollectEffects(state);

  assert.equal(board.occupants[idx], null, '라인 잼의 세로줄 범위 안에 있었으므로 파괴돼야 한다');
  assert.ok(effects.some((e) => e.type === 'obstacleDestroyed' && e.id === 'crate' && e.cause === 'specialEffect'));
});

test('occupant은 swappable:false라 스왑할 수 없다', () => {
  const grid = [0, 1, 2, 1, 2, 0, 2, 0, 1]; // 라틴 사각형(gameState.test.js와 동일) - 어떤 스왑도 매치 없음
  const board = boardFromGrid(3, 3, grid);
  const idx = board.index(1, 1);
  board.grid[idx] = OBSTACLE;
  board.occupants[idx] = { type: 'crate', hp: CRATE.hp };
  const before = board.grid.slice();
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ crate: CRATE }) });

  assert.equal(state.trySwap(1, 1, 1, 2), false);
  assert.deepEqual(board.grid, before);
  assert.equal(state.resolutions.length, 0);
});

// ------------------------------------------------------------
// attachment(시한폭탄)
// ------------------------------------------------------------

test('방해요소는 중력으로 잼처럼 떨어지고, attachment는 자신이 붙은 잼과 함께 떨어진다', () => {
  // occupant: row0=occupant, row1=EMPTY, row2=잼 -> occupant가 row1로 떨어진다.
  const occBoard = { rows: 3, cols: 1, grid: [OBSTACLE, EMPTY, 5], specials: [null, null, null], occupants: [{ type: 'crate', hp: 1 }, null, null], attachments: [null, null, null] };
  applyGravity(occBoard);
  assert.equal(occBoard.grid[1], OBSTACLE);
  assert.deepEqual(occBoard.occupants[1], { type: 'crate', hp: 1 });
  assert.equal(occBoard.occupants[0], null);
  assert.equal(occBoard.grid[0], EMPTY, '위에서 새 occupant가 생기지는 않는다');

  // attachment: row0=잼(bomb 붙음), row1=EMPTY, row2=잼 -> row0의 잼+bomb이 함께 row1로 떨어진다.
  const attBoard = { rows: 3, cols: 1, grid: [7, EMPTY, 2], specials: [null, null, null], occupants: [null, null, null], attachments: [{ type: 'timeBomb', hp: 1, timer: 5 }, null, null] };
  applyGravity(attBoard);
  assert.equal(attBoard.grid[1], 7);
  assert.deepEqual(attBoard.attachments[1], { type: 'timeBomb', hp: 1, timer: 5 });
  assert.equal(attBoard.attachments[0], null);
});

test('무효 스왑(매치 없음)은 시한폭탄을 해제하지도 타이머를 줄이지도 않는다', () => {
  const grid = [0, 1, 2, 1, 2, 0, 2, 0, 1]; // 라틴 사각형 - 어떤 인접 스왑도 매치 없음
  const board = boardFromGrid(3, 3, grid);
  const idx = board.index(0, 0);
  board.attachments[idx] = { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 };
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ timeBomb: TIME_BOMB }) });

  assert.equal(state.trySwap(0, 0, 0, 1), true, '무효 스왑도 처리는 됐다는 뜻으로 true');
  assert.equal(state.resolutions.length, 0, '무효 스왑은 Resolution을 만들지 않는다');
  drainAndCollectEffects(state);

  assert.deepEqual(board.attachments[idx], { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 });
});

test('시한폭탄이 붙은 잼이 매치로 지워지면 해제된다(damagedBy: gemCleared)', () => {
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0]; // puzzleBattleBridge.test.js와 동일한 격자
  const board = boardFromGrid(3, 3, grid);
  // (0,1)은 스왑에 관여하지 않고 그대로 매치에 포함되는 칸 - 여기 붙인 폭탄이 매치와 함께 해제되는지 본다.
  const idx = board.index(0, 1);
  board.attachments[idx] = { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 };
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ timeBomb: TIME_BOMB }) });

  assert.equal(state.trySwap(0, 2, 1, 2), true);
  const effects = drainAndCollectEffects(state);

  assert.ok(board.attachments.every((a) => a === null), '매치로 지워졌으니 해제돼야 한다');
  assert.ok(effects.some((e) => e.type === 'obstacleDestroyed' && e.id === 'timeBomb' && e.cause === 'gemCleared'));
});

test('시한폭탄 타이머가 0이 되면 obstacleExpire 이벤트가 뜨고 그 잼은 제거된다', () => {
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  const board = boardFromGrid(3, 3, grid);
  // (2,0)은 swap(0,2,1,2)과 무관한 열(col0) - 타이머 만료가 매치/낙하와 독립적으로 일어남을 본다.
  const idx = board.index(2, 0);
  board.attachments[idx] = { type: 'timeBomb', hp: 1, timer: 1, wallDamagePct: 0.2 };
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ timeBomb: TIME_BOMB }) });

  assert.equal(state.trySwap(0, 2, 1, 2), true, '유효한 스왑 1번 - 타이머가 1->0으로 만료된다');

  // obstacleExpire는 trySwap() 안에서 바로 push되지 않고 큐(_pendingSwapEffects)에 쌓였다가
  // 다음 update()의 0단계(_advanceEffects) 직후에 밀린다 - trySwap은 update() 루프 밖(포인터
  // 입력)에서 동기로 불리므로, 즉시 push하면 다음 update()가 "이전 틱 효과"로 오인해
  // durationMs:1짜리를 render()가 보기도 전에 지워버린다(실제 게임에서 폭발 연출이 전혀
  // 보이지 않던 버그 - trySwap 직후가 아니라 drain 루프로 확인해야 재현/검증된다).
  const effects = drainAndCollectEffects(state);
  const expireEffect = effects.find((e) => e.type === 'obstacleExpire');
  assert.ok(expireEffect, 'obstacleExpire 이펙트가 있어야 한다');
  assert.equal(expireEffect.id, 'timeBomb');
  assert.equal(expireEffect.wallDamagePct, 0.2);

  assert.ok(board.attachments.every((a) => a === null));
  assert.ok(board.grid.every((v) => v !== EMPTY && v !== OBSTACLE), '만료로 지워진 칸도 중력/리필로 다시 채워져야 한다');
});

test('연쇄(cascade)는 시한폭탄 타이머를 줄이지 않는다 - 유효한 스왑 1번당 1만 줄어든다', () => {
  // tests/puzzleBattleBridge.test.js의 2단계 연쇄 격자를 그대로 재사용한다. (4,0)은 두
  // 단계 중 어느 쪽 매치/중력 이동에도 전혀 관여하지 않는 칸(바닥, col0은 1단계에서만
  // row2가 지워지고 그 위 칸들이 내려오지만 바닥 행 자체는 움직이지 않는다).
  const grid = [
    2, 3, 4, //
    3, 1, 3, //
    0, 0, 2, //
    4, 1, 0, //
    2, 1, 4,
  ];
  const board = boardFromGrid(5, 3, grid, 7);
  const idx = board.index(4, 0);
  board.attachments[idx] = { type: 'timeBomb', hp: 1, timer: 5, wallDamagePct: 0.1 };
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ timeBomb: TIME_BOMB }) });

  assert.equal(state.trySwap(2, 2, 3, 2), true);
  drainAndCollectEffects(state);

  assert.deepEqual(board.attachments[idx], { type: 'timeBomb', hp: 1, timer: 4, wallDamagePct: 0.1 }, '2단계 연쇄가 났어도 1만 줄어야 한다');
});

// ------------------------------------------------------------
// 등장/재배치: boardCap, 재배치 실패 시 제거
// ------------------------------------------------------------

test('boardCap을 넘는 초기 배치는 cap만큼만 생성된다', () => {
  const board = new Board({ rows: 6, cols: 6, seed: 42 });
  const state = new GameState({
    board,
    obstaclesConfig: obstaclesConfig({ crate: CRATE }, 2),
    floorObstacles: { crate: { initial: 5 } },
  });
  void state;
  const count = board.occupants.filter(Boolean).length;
  assert.equal(count, 2);
});

test('재배치를 3번 연속 해도 가능한 수가 없으면 hp가 가장 낮은 occupant가 제거된다', () => {
  // 가능한 free 잼 칸을 1개만 남기고 나머지 35칸을 모두 occupant로 채운다 - free 칸이
  // 1개뿐이면 어떤 색을 넣어도 "스왑 가능한 두 칸"이 존재할 수 없으므로 재배치가 항상 실패한다.
  const board = new Board({ rows: 6, cols: 6, seed: 1 });
  let lowestIdx = -1;
  for (let i = 0; i < board.grid.length; i++) {
    if (i === 0) continue; // 자유 칸 1개(인덱스 0)만 남긴다.
    board.grid[i] = OBSTACLE;
    board.occupants[i] = { type: 'stone', hp: 2 };
    if (lowestIdx === -1) {
      board.occupants[i] = { type: 'crate', hp: 1 }; // hp가 가장 낮은 1개.
      lowestIdx = i;
    }
  }
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ crate: CRATE, stone: STONE }) });

  state._maybeReshuffle();
  assert.equal(state._obstacleReshuffleFailures, 1);
  assert.ok(board.occupants[lowestIdx], '1~2번째 실패에서는 아직 제거되지 않는다');

  state._maybeReshuffle();
  assert.equal(state._obstacleReshuffleFailures, 2);
  assert.ok(board.occupants[lowestIdx]);

  state._maybeReshuffle();
  assert.equal(state._obstacleReshuffleFailures, 0, '제거 후 실패 카운터가 리셋된다');
  assert.equal(board.occupants[lowestIdx], null, '가장 낮은 hp(crate, hp1)가 제거돼야 한다');
});

// ------------------------------------------------------------
// 확장 구조: 핸들러 없는 가짜 방해요소도 데이터만으로 동작한다
// ------------------------------------------------------------

test('핸들러 없는 가짜 방해요소(testRock, hp3)도 types 데이터만으로 adjacentMatch 피해를 받는다', () => {
  const { board } = makeAdjacentMatchBoard('testRock', TEST_ROCK.hp);
  const state = new GameState({ board, obstaclesConfig: obstaclesConfig({ testRock: TEST_ROCK }) });

  assert.equal(state.trySwap(2, 2, 2, 3), true);
  drainAndCollectEffects(state);

  // (1,0)의 testRock도 stone과 같은 이유로 (2,0)으로 한 칸 떨어진다.
  assert.deepEqual(board.occupants[board.index(2, 0)], { type: 'testRock', hp: 2 }, 'hp3 -> 1피해로 hp2, 아직 파괴되지 않음');
});
