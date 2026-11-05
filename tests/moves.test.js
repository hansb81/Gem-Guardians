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
