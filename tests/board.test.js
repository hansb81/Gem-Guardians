import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, OBSTACLE } from '../src/core/board.js';
import { findMatches } from '../src/core/match.js';
import { hasAnyValidMove } from '../src/core/moves.js';
import { SPECIAL_KIND } from '../src/core/specials.js';

test('같은 seed는 같은 보드를 생성한다', () => {
  const a = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 12345 });
  const b = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 12345 });
  assert.deepEqual(a.grid, b.grid);
});

test('다른 seed는 다른 보드를 생성한다', () => {
  const a = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 1 });
  const b = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 2 });
  assert.notDeepEqual(a.grid, b.grid);
});

test('생성된 보드는 처음부터 3매치가 없다', () => {
  for (let seed = 0; seed < 30; seed++) {
    const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed });
    assert.equal(findMatches(board).length, 0, `seed ${seed}에서 초기 매치가 있음`);
  }
});

test('생성된 보드는 항상 가능한 수가 1개 이상 있다', () => {
  for (let seed = 0; seed < 30; seed++) {
    const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed });
    assert.ok(hasAnyValidMove(board), `seed ${seed}에서 가능한 수가 없음`);
  }
});

test('reshuffle 결과도 매치가 없고 가능한 수가 1개 이상 있다', () => {
  const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 99 });
  board.reshuffle();
  assert.equal(findMatches(board).length, 0);
  assert.ok(hasAnyValidMove(board));
});

test('인접하지 않은 칸은 스왑되지 않는다', () => {
  const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 7 });
  const before = board.grid.slice();
  const result = board.swap(0, 0, 5, 5);
  assert.equal(result, false);
  assert.deepEqual(board.grid, before);
});

test('shuffle 결과도 매치가 없고 가능한 수가 1개 이상 있다', () => {
  for (let seed = 0; seed < 20; seed++) {
    const board = new Board({ rows: 7, cols: 7, typeCount: 5, seed });
    board.shuffle();
    assert.equal(findMatches(board).length, 0, `seed ${seed}에서 셔플 후 매치가 있음`);
    assert.ok(hasAnyValidMove(board), `seed ${seed}에서 셔플 후 가능한 수가 없음`);
  }
});

test('shuffle은 모든 칸을 정확히 한 번씩 옮긴다(id 중복/누락 없음)', () => {
  const board = new Board({ rows: 7, cols: 7, typeCount: 5, seed: 42 });
  const moves = board.shuffle();
  assert.equal(moves.length, 49);
  const ids = new Set(moves.map((m) => m.id));
  assert.equal(ids.size, 49, 'id가 중복되면 안 된다');
  for (let id = 0; id < 49; id++) assert.ok(ids.has(id), `id ${id}가 누락됨`);
  // 각 목적지 칸도 정확히 한 번씩만 채워져야 한다(전체 치환).
  const destKeys = new Set(moves.map((m) => `${m.to.row},${m.to.col}`));
  assert.equal(destKeys.size, 49);
});

test('shuffle에서 장애물 칸은 from===to다', () => {
  const board = new Board({ rows: 7, cols: 7, typeCount: 5, seed: 3 });
  const fixedIdx = board.index(2, 3);
  board.grid[fixedIdx] = OBSTACLE;
  board.occupants[fixedIdx] = { type: 'stone', hp: 1 };
  const fixed = new Set([fixedIdx]);
  const moves = board.shuffle(fixed);
  const own = moves.find((m) => m.id === fixedIdx);
  assert.deepEqual(own.from, own.to, '장애물 칸은 움직이면 안 된다');
  assert.equal(own.from.row, 2);
  assert.equal(own.from.col, 3);
  assert.equal(board.grid[fixedIdx], OBSTACLE, '장애물 칸의 값도 바뀌면 안 된다');
});

test('shuffle은 특수 잼의 종류/방향을 유지한 채 같이 옮긴다', () => {
  const board = new Board({ rows: 7, cols: 7, typeCount: 5, seed: 5 });
  const srcIdx = board.index(0, 0);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const moves = board.shuffle();
  const own = moves.find((m) => m.id === srcIdx);
  assert.deepEqual(own.special, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const destIdx = board.index(own.to.row, own.to.col);
  assert.deepEqual(board.specials[destIdx], { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
});
