import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasAnyValidMove, findAnyValidMove } from '../src/core/moves.js';

test('스왑으로 매치가 만들어지는 조합이 있으면 유효한 수가 있다고 판단한다', () => {
  // (0,2)<->(1,2)를 스왑하면 row0이 [0,0,0]이 되어 매치가 생긴다.
  const state = {
    rows: 3,
    cols: 3,
    grid: [0, 0, 1, 1, 2, 0, 2, 1, 2],
  };
  assert.ok(hasAnyValidMove(state));
  const move = findAnyValidMove(state);
  assert.ok(move);
  assert.ok('from' in move && 'to' in move);
});

test('어떤 인접 스왑도 매치를 만들 수 없으면 유효한 수가 없다고 판단한다', () => {
  // 2x2 보드는 아무리 스왑해도 3매치가 나올 수 없다.
  const state = { rows: 2, cols: 2, grid: [0, 1, 1, 0] };
  assert.equal(hasAnyValidMove(state), false);
  assert.equal(findAnyValidMove(state), null);
});

test('빈 칸(EMPTY)과 스왑하는 수가 있어도 findAnyValidMove가 끝난다(판 밖을 EMPTY로 세던 무한 루프 회귀)', () => {
  // reports/sim/v13/1-rainbowdef.md 재현 판.
  // (0,3)의 0이 빈 칸으로 옮겨 가면 0 0 0 - from은 그 젬.
  assert.deepEqual(findAnyValidMove({ grid: [0, 0, -1, 0], rows: 1, cols: 4 }), { from: { row: 0, col: 3 }, to: { row: 0, col: 2 } });
});

test('방해요소(OBSTACLE)·빈 칸이 있는 7x7 판: from은 매치를 만드는 젬 칸이다', () => {
  const rows = 7;
  const cols = 7;
  // 1~4가 가로 1칸씩 건너 반복, 세로로 1씩 바뀐다 - 처음엔 매치·2x2 없음.
  const grid = Array.from({ length: rows * cols }, (_, i) => 1 + ((Math.floor(i / cols) + 2 * (i % cols)) % 4));
  grid.splice(0, 4, 0, 0, -3, 0); // 0행: 0 0 [돌] 0 -> 돌과 오른쪽 0을 바꾸면 0 0 0.
  grid[3 * cols + 3] = -1;
  grid[5 * cols + 1] = -3;
  const move = findAnyValidMove({ grid, rows, cols });
  assert.deepEqual(move, { from: { row: 0, col: 3 }, to: { row: 0, col: 2 } });
  assert.ok(grid[move.from.row * cols + move.from.col] >= 0, 'from은 젬 칸');
});
