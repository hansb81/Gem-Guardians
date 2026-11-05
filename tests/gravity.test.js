import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGravity, refill } from '../src/core/gravity.js';
import { EMPTY } from '../src/core/board.js';
import { createRng } from '../src/core/rng.js';

test('applyGravity: 빈 칸 위의 잼들이 바닥 쪽으로 압축된다', () => {
  const rows = 4;
  const cols = 2;
  // col0(위->아래): 0, EMPTY, 1, EMPTY   col1(위->아래): EMPTY, EMPTY, EMPTY, 2
  const grid = [0, EMPTY, EMPTY, EMPTY, 1, EMPTY, EMPTY, 2];
  const specials = new Array(grid.length).fill(null);
  const board = { rows, cols, grid, specials };

  const moves = applyGravity(board);

  const col0 = [0, 1, 2, 3].map((r) => board.grid[r * cols + 0]);
  assert.deepEqual(col0, [EMPTY, EMPTY, 0, 1]);

  const col1 = [0, 1, 2, 3].map((r) => board.grid[r * cols + 1]);
  assert.deepEqual(col1, [EMPTY, EMPTY, EMPTY, 2]);

  assert.ok(moves.length > 0);
  assert.ok(moves.every((m) => m.to.row > m.from.row));
});

test('applyGravity: 이미 바닥에 붙어있는 칸은 이동으로 기록하지 않는다', () => {
  const rows = 2;
  const cols = 1;
  const grid = [EMPTY, 3];
  const specials = new Array(grid.length).fill(null);
  const board = { rows, cols, grid, specials };
  const moves = applyGravity(board);
  assert.deepEqual(moves, []);
  assert.equal(board.grid[1], 3);
});

test('applyGravity: 특수 잼 메타데이터가 색과 함께 이동한다', () => {
  const rows = 3;
  const cols = 1;
  // 위->아래: 라인 잼(색1), EMPTY, 색2
  const grid = [1, EMPTY, 2];
  const specials = [{ kind: 'line', direction: 'horizontal' }, null, null];
  const board = { rows, cols, grid, specials };

  applyGravity(board);

  assert.equal(board.grid[1], 1, '라인 잼이 중간 행으로 떨어져야 한다');
  assert.deepEqual(board.specials[1], { kind: 'line', direction: 'horizontal' });
  assert.equal(board.specials[0], null, '원래 자리는 특수 메타데이터가 비워져야 한다');
});

test('refill: 빈 칸을 위에서부터 새 잼으로 채운다', () => {
  const rows = 2;
  const cols = 2;
  const grid = [EMPTY, 0, EMPTY, EMPTY];
  const specials = new Array(grid.length).fill(null);
  const board = {
    rows,
    cols,
    grid,
    specials,
    typeCount: 5,
    rng: createRng(1),
    randomType() {
      return Math.floor(this.rng() * this.typeCount);
    },
  };

  const spawns = refill(board);

  assert.equal(spawns.length, 3);
  assert.ok(board.grid.every((v) => v !== EMPTY));
  assert.ok(spawns.every((s) => s.value >= 0 && s.value < 5));
  assert.ok(board.specials.every((s) => s === null), '리필된 칸은 특수 잼이 아니어야 한다');
});
