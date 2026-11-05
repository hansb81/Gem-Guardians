import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { ANIMATION_DURATIONS_MS } from '../src/config/animation.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  return board;
}

// predicate를 만족하는 gameState.effects 항목을 틱마다 스냅샷해서 누적 기록한다. 같은 이펙트
// 객체는 여러 틱에 걸쳐 effects 배열에 남아있다가 사라지므로, 객체 참조 기준으로 중복 없이
// 한 번만 기록한다(sequential 체인의 다음 항목은 새 객체이므로 자연스럽게 또 기록된다).
function collectEffects(state, predicate, { dtSeconds = 0.01, maxTicks = 5000 } = {}) {
  const { board } = state;
  const seen = new Set();
  const found = [];
  const stillAnimating = () =>
    state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null) || state.effects.length > 0;
  let ticks = 0;
  while (stillAnimating() && ticks < maxTicks) {
    state.update(dtSeconds);
    for (const e of state.effects) {
      if (!seen.has(e) && predicate(e)) {
        seen.add(e);
        found.push(e);
      }
    }
    ticks++;
  }
  assert.ok(ticks < maxTicks, '상한 안에 모든 애니메이션이 끝나야 한다');
  return found;
}

function collectAllEffects(state, opts) {
  return collectEffects(state, () => true, opts);
}

test('매치가 생기지 않는 스왑은 값이 즉시 원복되고, 들썩 애니메이션이 끝나면 idle로 돌아간다', () => {
  // 3x3 라틴 사각형: 어떤 두 인접 칸을 바꿔도 3매치가 나오지 않는다.
  const grid = [0, 1, 2, 1, 2, 0, 2, 0, 1];
  const board = boardFromGrid(3, 3, grid);
  const original = board.grid.slice();
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true, '무효 스왑도 "처리는 됐다"는 의미로 true를 반환해야 한다');
  assert.equal(state.resolutions.length, 0, '무효 스왑은 Resolution을 만들지 않는다');
  assert.deepEqual(board.grid, original, '값은 스왑 즉시(되돌림까지 포함) 원복되어 있어야 한다');

  const i1 = board.index(0, 0);
  const i2 = board.index(0, 1);
  assert.notEqual(board.cellStates[i1], null, '들썩 애니메이션 동안 cellStates가 채워져 있어야 한다');
  assert.notEqual(board.cellStates[i2], null);

  // 큐 소진 패턴: invalidSwap 지속시간만큼 지날 때까지 반복한다.
  let guard = 0;
  while ((board.cellStates[i1] !== null || board.cellStates[i2] !== null) && guard < 1000) {
    state.update(0.02);
    guard++;
  }
  assert.ok(guard < 1000, '상한 안에 들썩 애니메이션이 끝나야 한다');

  assert.equal(board.cellStates[i1], null, '들썩이 끝나면 idle로 돌아가야 한다');
  assert.equal(board.cellStates[i2], null);
  assert.deepEqual(board.grid, original, '다 끝나도 보드가 원래 상태로 유지돼야 한다');
  assert.equal(state.score, 0);
});

test('매치가 생기는 스왑은 Resolution을 만들고, resolutions를 다 드레인하면 매치가 남지 않는다', () => {
  // (0,2)<->(1,2) 스왑하면 row0이 [0,0,0]이 되어 매치가 생긴다.
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  const board = boardFromGrid(3, 3, grid, 7);
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 2, 1, 2);
  assert.equal(accepted, true);
  assert.equal(state.resolutions.length, 1, '매치가 생기는 스왑은 Resolution을 하나 만들어야 한다');

  let guard = 0;
  while (state.resolutions.length > 0 && guard < 10000) {
    state.update(0.016);
    guard++;
  }
  assert.ok(guard < 10000, '상한 안에 해소가 끝나야 한다');

  assert.equal(findMatches(board).length, 0, '해소 후에는 매치가 남지 않아야 한다');
  assert.ok(!board.grid.includes(EMPTY), '해소가 끝나면 EMPTY가 남아있으면 안 된다');
  assert.ok(board.cellStates.every((cs) => cs === null), '다 끝나면 모든 칸이 idle이어야 한다');
  assert.ok(state.score > 0, '점수가 올라야 한다');
  assert.ok(state.cascadeCount >= 1, '연쇄 횟수가 기록돼야 한다');
});

test('인접하지 않은 스왑 요청은 거부되고 보드/상태가 전혀 바뀌지 않는다', () => {
  const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 3 });
  const original = board.grid.slice();
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 5, 5);

  assert.equal(accepted, false);
  assert.deepEqual(board.grid, original);
  assert.equal(state.resolutions.length, 0);
  assert.ok(board.cellStates.every((cs) => cs === null));
});

// 회귀 테스트: 매치에 낀 기존 특수 잼이 연쇄 발동할 때, 그 효과 범위가 같은 매치에서
// 새로 생기는 특수 잼의 생성 칸과 겹치면 보드(board.grid/specials)가 생성 칸을 보호해야 한다.
// 과거엔(옛 Animator 재생 모델에서) 이 보호가 빠져서 화면에서만 생성 칸이 사라지는 버그가 있었다.
// 지금은 Animator가 상태 없는 뷰 모델 빌더가 되어 "화면 재생"을 따로 검증할 구조가 없으므로,
// core(board + 그 과정에서 뜨는 specialActivate 이펙트의 affected 목록)만 검증한다.
test('매치에 낀 기존 특수 잼의 연쇄 범위가 새로 생긴 특수 잼의 생성 칸과 겹쳐도, 보드가 그 칸을 보존한다', () => {
  const board = new Board({ rows: 8, cols: 8, typeCount: 5, seed: 42 });
  const row = 2;
  // row2 = [0, LINE(가로, 자기 행 삭제), 3, 0] -> (row+1,2)의 0을 끌어올리면 row2가
  // [0,0,0,0] 가로 4매치가 되어 새 라인 잼(세로 삭제)이 생기고, 기존 라인 잼(가로 삭제)은
  // 같은 매치에 끼어 연쇄 발동한다. 기존 라인의 "자기 행 전체 삭제" 효과 범위가 새로 생기는
  // 라인 잼의 생성 칸(row2, col2)과 같은 행이라 정확히 겹친다.
  board.set(row, 0, 0);
  board.set(row, 1, 0);
  board.set(row, 2, 3);
  board.set(row, 3, 0);
  board.setSpecial(row, 1, { kind: 'line', direction: 'horizontal' });
  board.set(row + 1, 2, 0);

  const state = new GameState({ board });

  const accepted = state.trySwap(row, 2, row + 1, 2);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);

  const created = effects.find((e) => e.type === 'specialCreate');
  assert.ok(created, '새 특수 잼 생성 이펙트가 있어야 한다');
  assert.equal(created.kind, 'line');
  assert.deepEqual(created.position, { row, col: 2 }, '생성 칸은 (row,2)여야 한다');

  const chainActivate = effects.find(
    (e) => e.type === 'specialActivate' && e.position.row === row && e.position.col === 1
  );
  assert.ok(chainActivate, '기존 라인 잼이 연쇄 발동해야 한다');
  const overlapsSpawnCell = chainActivate.affected.some(
    (cell) => cell.row === created.position.row && cell.col === created.position.col
  );
  assert.equal(overlapsSpawnCell, false, 'specialActivate의 affected에 새 생성 칸이 포함되면 안 된다');

  // drain이 끝난 뒤(collectAllEffects가 끝까지 돌렸다) 보드 쪽도 생성 칸을 올바르게 보존했는지 확인한다.
  assert.equal(state.resolutions.length, 0);
  assert.equal(board.get(created.position.row, created.position.col), created.color);
  assert.deepEqual(board.getSpecial(created.position.row, created.position.col), {
    kind: created.kind,
    direction: created.direction,
  });
  assert.equal(findMatches(board).length, 0, '해소 후에는 매치가 남지 않아야 한다');
  assert.ok(!board.grid.includes(EMPTY));
});

test('shuffleBoard()는 moves가 실린 shuffle 이펙트를 즉시 push하고, 보드 데이터는 바로 확정된다', () => {
  const board = new Board({ rows: 7, cols: 7, typeCount: 5, seed: 11 });
  const state = new GameState({ board });

  const before = board.grid.slice();
  state.shuffleBoard();

  assert.equal(board.grid.length, before.length);
  const shuffleFx = state.effects.find((e) => e.type === 'shuffle');
  assert.ok(shuffleFx, 'shuffle 이펙트가 있어야 한다');
  assert.equal(shuffleFx.moves.length, 49);
  assert.equal(shuffleFx.durationMs, ANIMATION_DURATIONS_MS.shuffle);
  assert.equal(findMatches(board).length, 0, '셔플 직후 보드엔 매치가 없어야 한다');
});

test('setReduceEffects(true)면 shuffle 이펙트 길이가 줄어든다', () => {
  const board = new Board({ rows: 7, cols: 7, typeCount: 5, seed: 12 });
  const state = new GameState({ board });
  state.setReduceEffects(true);
  state.shuffleBoard();
  const shuffleFx = state.effects.find((e) => e.type === 'shuffle');
  assert.equal(shuffleFx.durationMs, ANIMATION_DURATIONS_MS.shuffleReduced);
});

test('shuffle 연출이 재생 중엔 trySwap이 아무 것도 하지 않고 false를 돌려준다', () => {
  const board = new Board({ rows: 7, cols: 7, typeCount: 5, seed: 13 });
  const state = new GameState({ board });
  state.shuffleBoard();

  const before = board.grid.slice();
  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, false, '셔플 중엔 입력을 받으면 안 된다');
  assert.deepEqual(board.grid, before, '셔플 중엔 보드도 바뀌면 안 된다');

  // 연출이 끝날 때까지 틱을 돌리면 다시 입력을 받는다.
  let ticks = 0;
  while (state.effects.some((e) => e.type === 'shuffle') && ticks < 2000) {
    state.update(0.01);
    ticks++;
  }
  assert.ok(ticks < 2000, '셔플 이펙트가 상한 안에 끝나야 한다');
  // 셔플이 끝나는 틱까지는 유휴 타이머가 계속 0으로 묶여 있었어야 한다 - 끝난 바로 그 틱부터
  // 다시 쌓이므로 10ms(한 틱치) 정도만 쌓여 있으면 "리셋됐다"고 볼 수 있다.
  assert.ok(state._inputIdleMs <= 10, `셔플 동안 쌓인 유휴 시간이 새면 안 된다 (actual=${state._inputIdleMs})`);

  const accepted2 = state.trySwap(0, 0, 0, 1);
  assert.notEqual(accepted2, undefined, '셔플이 끝나면 다시 입력을 받아야 한다');
});
