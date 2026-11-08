import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, EMPTY, COLORLESS } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import {
  SPECIAL_KIND,
  decideSpecialForGroup,
  pickSpawnCell,
  resolveActivations,
} from '../src/core/specials.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  return board;
}

// predicate를 만족하는 gameState.effects 항목을 틱마다 스냅샷해서 누적 기록한다(객체 참조
// 기준 중복 제거 - 같은 이펙트가 여러 틱에 걸쳐 떠 있다가 사라지는 걸 한 번만 기록한다).
function collectAllEffects(state, { dtSeconds = 0.01, maxTicks = 5000 } = {}) {
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
  return found;
}

// ---- 생성 규칙: 모양별 종류 ----

test('가로 4개 일자 매치는 세로를 지우는 라인 잼을 만든다', () => {
  const state = { grid: [0, 0, 0, 0, 1, 2].flat ? [0, 0, 0, 0, 1, 2] : [], rows: 1, cols: 6 };
  const matches = findMatches({ grid: [0, 0, 0, 0, 1, 2], rows: 1, cols: 6 });
  assert.equal(matches.length, 1);
  const decision = decideSpecialForGroup(matches[0]);
  assert.deepEqual(decision, { kind: SPECIAL_KIND.LINE, direction: 'vertical' });
});

test('세로 4개 일자 매치는 가로를 지우는 라인 잼을 만든다', () => {
  const grid = [0, 1, 0, 1, 0, 1, 0, 1];
  // col0 세로 4매치가 되도록 재구성
  const g = [0, 9, 0, 9, 0, 9, 0, 9];
  const matches = findMatches({ grid: g, rows: 4, cols: 2 });
  const vertical = matches.find((m) => m.color === 0);
  assert.ok(vertical);
  const decision = decideSpecialForGroup(vertical);
  assert.deepEqual(decision, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
});

test('L자 매치는 폭탄 잼을 만들고 생성 칸은 교차 칸이다', () => {
  const state = {
    grid: [2, 9, 8, 7, 2, 4, 5, 6, 2, 2, 2, 1].flat ? [2, 9, 8, 7, 2, 4, 5, 6, 2, 2, 2, 1] : [],
    rows: 3,
    cols: 4,
  };
  const matches = findMatches({ grid: state.grid, rows: 3, cols: 4 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'L');
  const decision = decideSpecialForGroup(matches[0]);
  assert.deepEqual(decision, { kind: SPECIAL_KIND.BOMB, direction: null });
  const spawnCell = pickSpawnCell(matches[0], SPECIAL_KIND.BOMB, null);
  assert.deepEqual(spawnCell, { row: 2, col: 0 });
});

test('T자 매치는 폭탄 잼을 만든다', () => {
  const grid = [3, 9, 8, 3, 3, 3, 3, 7, 6];
  const matches = findMatches({ grid, rows: 3, cols: 3 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'T');
  const decision = decideSpecialForGroup(matches[0]);
  assert.equal(decision.kind, SPECIAL_KIND.BOMB);
});

test('+ 매치는 폭탄 잼을 만든다', () => {
  const grid = [9, 4, 8, 4, 4, 4, 7, 4, 6];
  const matches = findMatches({ grid, rows: 3, cols: 3 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'plus');
  const decision = decideSpecialForGroup(matches[0]);
  assert.equal(decision.kind, SPECIAL_KIND.BOMB);
});

test('3x4 범위로 겹치는 매치(세로 4 + 가로 3)도 폭탄 잼을 만든다', () => {
  // col0: 세로 4매치(0,0,0,0), row3: 가로 3매치(0,0,0)가 (3,0)에서 겹친다.
  const grid = [
    0, 9, 8, 7,
    0, 1, 2, 3,
    0, 2, 3, 4,
    0, 0, 0, 5,
  ];
  const matches = findMatches({ grid, rows: 4, cols: 4 });
  assert.equal(matches.length, 1);
  const decision = decideSpecialForGroup(matches[0]);
  assert.equal(decision.kind, SPECIAL_KIND.BOMB);
  assert.deepEqual(matches[0].crossingCell, { row: 3, col: 0 });
});

test('가로 5개 일자 매치는 컬러 잼을 만든다', () => {
  const matches = findMatches({ grid: [0, 0, 0, 0, 0, 1], rows: 1, cols: 6 });
  assert.equal(matches.length, 1);
  const decision = decideSpecialForGroup(matches[0]);
  assert.deepEqual(decision, { kind: SPECIAL_KIND.COLOR, direction: null });
});

test('5개 일자와 겹침이 동시에 있으면 컬러가 우선한다', () => {
  // row2: 가로 5매치(0,0,0,0,0), col2: 세로 3매치(0,0,0) - (2,2)에서 겹친다.
  const grid = [
    9, 8, 0, 7, 6,
    5, 4, 0, 3, 2,
    0, 0, 0, 0, 0,
  ];
  const matches = findMatches({ grid, rows: 3, cols: 5 });
  assert.equal(matches.length, 1);
  const decision = decideSpecialForGroup(matches[0]);
  assert.equal(decision.kind, SPECIAL_KIND.COLOR, '겹침이 있어도 5줄이면 컬러가 우선해야 한다');
});

test('평범한 3매치는 특수 잼을 만들지 않는다', () => {
  const matches = findMatches({ grid: [0, 0, 0, 1, 2, 3], rows: 1, cols: 6 });
  assert.equal(matches.length, 1);
  assert.equal(decideSpecialForGroup(matches[0]), null);
});

// ---- 생성 칸 규칙 ----

test('플레이어 스왑으로 생긴 라인/컬러 매치는 플레이어가 움직인 칸에 생성된다', () => {
  // row0 = [0,0,0,9], row1 = [1,2,3,0]. (0,3)<->(1,3) 스왑으로 row0이 [0,0,0,0] 4매치가 된다.
  // 주의: 이 보드는 2행짜리라 해소가 끝난 뒤 "가능한 수"가 없어서 즉시 재배치(reshuffle)가
  // 일어나 specials가 전부 비워진다 - 그래서 "최종 보드 상태"로는 생성 사실을 확인할 수 없고,
  // 생성 과정에서 뜨는 specialCreate 이펙트로 확인해야 한다(기획서의 (a) 방식).
  const grid = [0, 0, 0, 9, 1, 2, 3, 0];
  const board = boardFromGrid(2, 4, grid, 11);
  const gs = new GameState({ board });

  const accepted = gs.trySwap(0, 3, 1, 3);
  assert.equal(accepted, true);
  assert.equal(gs.resolutions.length, 1);

  const effects = collectAllEffects(gs);
  const created = effects.find((e) => e.type === 'specialCreate');
  assert.ok(created, '새 특수 잼 생성 이펙트가 있어야 한다');
  assert.equal(created.kind, 'line');
  assert.deepEqual(created.position, { row: 0, col: 3 }, '플레이어가 움직인 칸에 생성돼야 한다');
});

test('특수 잼을 옮겨 특수 매치를 만들면 기존 특수 잼은 발동하고 새 잼은 옆 칸에 생긴다', () => {
  // 위 테스트와 같은 보드지만 (1,3)이 라인 잼. 스왑 후 (0,3)으로 와서 4매치에 낀다.
  const board = boardFromGrid(2, 4, [0, 0, 0, 9, 1, 2, 3, 0], 11);
  board.setSpecial(1, 3, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const gs = new GameState({ board });
  assert.equal(gs.trySwap(0, 3, 1, 3), true);

  const effects = collectAllEffects(gs);
  const created = effects.find((e) => e.type === 'specialCreate');
  assert.ok(created, '새 특수 잼이 생성돼야 한다');
  assert.deepEqual(created.position, { row: 0, col: 2 }, '기존 특수 잼 칸에서 가장 가까운 그룹 칸');
  const fired = effects.find((e) => e.type === 'specialActivate' && e.position.row === 0 && e.position.col === 3);
  assert.ok(fired, '옮긴 라인 잼이 덮어써지지 않고 발동해야 한다');
});

test('연쇄로 생긴 매치는 그룹의 가운데 칸에 생성된다', () => {
  // 낙하 이후 생기는 매치에 swapCells가 전달되지 않는 경우를 직접 검증.
  const matches = findMatches({ grid: [0, 0, 0, 0, 1, 2], rows: 1, cols: 6 });
  const spawnCell = pickSpawnCell(matches[0], SPECIAL_KIND.LINE, null);
  assert.deepEqual(spawnCell, matches[0].cells[Math.floor((matches[0].cells.length - 1) / 2)]);
});

// ---- 발동 범위 ----

test('라인 잼은 자신의 행/열 전체를 지운다', () => {
  const board = boardFromGrid(4, 4, new Array(16).fill(1), 2);
  board.setSpecial(1, 1, { kind: SPECIAL_KIND.LINE, direction: 'vertical' });
  const result = resolveActivations(board, [{ row: 1, col: 1 }]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, SPECIAL_KIND.LINE);
  assert.equal(result.affectedCells.size, 4, '세로 라인은 열 전체(4칸)를 지워야 한다');
  for (let r = 0; r < 4; r++) assert.ok(result.affectedCells.has(`${r},1`));
});

test('폭탄 잼은 3x3 범위를 지운다(보드 경계는 잘린다)', () => {
  const board = boardFromGrid(5, 5, new Array(25).fill(1), 3);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOMB, direction: null });
  const corner = resolveActivations(board, [{ row: 0, col: 0 }]);
  assert.equal(corner.affectedCells.size, 4, '모서리의 3x3은 보드 안쪽 4칸만 남는다');

  const board2 = boardFromGrid(5, 5, new Array(25).fill(1), 3);
  board2.setSpecial(2, 2, { kind: SPECIAL_KIND.BOMB, direction: null });
  const center = resolveActivations(board2, [{ row: 2, col: 2 }]);
  assert.equal(center.affectedCells.size, 9, '중앙의 3x3은 9칸이어야 한다');
});

test('컬러 잼이 일반 잼과 스왑되면 그 잼과 같은 색을 모두 지운다', () => {
  const grid = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
  const board = boardFromGrid(4, 4, grid, 7);
  board.set(1, 1, COLORLESS);
  board.setSpecial(1, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  const gs = new GameState({ board });

  const accepted = gs.trySwap(1, 1, 1, 2); // (1,2) 색은 3
  assert.equal(accepted, true);
  assert.equal(gs.resolutions.length, 1);

  const effects = collectAllEffects(gs);
  const activate = effects.find((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.COLOR);
  assert.ok(activate);
  assert.equal(activate.color, 3);
  // 원래 보드에 색 3은 4칸 + 컬러 잼 자신 = 5칸
  assert.equal(activate.affected.length, 5);

  assert.equal(gs.resolutions.length, 0, 'drain이 끝나 있어야 한다');
  assert.equal(findMatches(board).length, 0);
});

test('체인 밖(연쇄)에서 발동된 컬러 잼은 가장 많은 색을 지운다', () => {
  // 색 1이 가장 많도록 구성(9칸), 컬러 잼은 (0,0)에 배치해 라인 잼으로 쓸어내본다.
  const rows = 4;
  const cols = 4;
  const grid = new Array(rows * cols).fill(1);
  grid[5] = 2; // 색 1 개수를 15 -> 보드 전체 색1로 둬서 압도적 1위로 만든다(한 칸만 다른 색)
  const board = boardFromGrid(rows, cols, grid, 4);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' }); // (0,0) 행 전체 삭제
  board.set(0, 0, 1);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.COLOR, direction: null });
  board.set(2, 2, COLORLESS);
  // (0,0) 라인 잼은 자기 행(row0)만 지우므로 컬러 잼까지는 안 닿는다 - 대신 직접 연쇄 테스트.
  const result = resolveActivations(board, [{ row: 0, col: 0 }]);
  const colorEvent = result.events.find((e) => e.kind === SPECIAL_KIND.COLOR);
  assert.equal(colorEvent, undefined, '이번 설정에서는 컬러 잼이 범위 밖이라 발동하지 않아야 한다');

  // 이번엔 컬러 잼이 라인 범위 안에 들어오도록 같은 행에 둔다.
  const board2 = boardFromGrid(rows, cols, grid, 4);
  board2.setSpecial(0, 0, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board2.set(0, 0, 1);
  board2.setSpecial(0, 2, { kind: SPECIAL_KIND.COLOR, direction: null });
  board2.set(0, 2, COLORLESS);
  const result2 = resolveActivations(board2, [{ row: 0, col: 0 }]);
  const colorEvent2 = result2.events.find((e) => e.kind === SPECIAL_KIND.COLOR);
  assert.ok(colorEvent2, '라인 범위 안의 컬러 잼은 연쇄 발동해야 한다');
  assert.equal(colorEvent2.color, 1, '가장 많은 색(1)을 지워야 한다');
});

// ---- 연쇄 발동 / 중복 방지 ----

test('효과 범위 안의 다른 특수 잼은 연쇄 발동한다', () => {
  const board = boardFromGrid(5, 5, new Array(25).fill(1), 9);
  board.setSpecial(2, 0, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' }); // row2 전체
  board.setSpecial(2, 3, { kind: SPECIAL_KIND.BOMB, direction: null }); // row2 범위 안

  const result = resolveActivations(board, [{ row: 2, col: 0 }]);
  const kinds = result.events.map((e) => e.kind).sort();
  assert.deepEqual(kinds, [SPECIAL_KIND.BOMB, SPECIAL_KIND.LINE]);
});

test('같은 특수 잼은 중복 발동하지 않는다(서로를 가리키는 범위라도 한 번만)', () => {
  const board = boardFromGrid(5, 5, new Array(25).fill(1), 9);
  // 두 라인 잼이 서로의 행/열을 가로질러 범위 안에 서로를 포함한다.
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' }); // row2
  board.setSpecial(0, 2, { kind: SPECIAL_KIND.LINE, direction: 'vertical' }); // col2, row2도 지나감 -> (2,2) 포함

  const result = resolveActivations(board, [{ row: 2, col: 2 }]);
  const positions = result.events.map((e) => `${e.position.row},${e.position.col}`);
  assert.equal(new Set(positions).size, positions.length, '발동 이벤트에 중복 위치가 없어야 한다');
  assert.equal(result.activated.size, positions.length);
});

test('resolveActivations는 특수 잼이 아닌 시드 칸은 무시한다', () => {
  const board = boardFromGrid(3, 3, new Array(9).fill(0), 1);
  const result = resolveActivations(board, [{ row: 1, col: 1 }]);
  assert.equal(result.events.length, 0);
  assert.equal(result.affectedCells.size, 0);
});
