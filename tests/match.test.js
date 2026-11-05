import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMatches } from '../src/core/match.js';

function makeState(rows2d) {
  return { grid: rows2d.flat(), rows: rows2d.length, cols: rows2d[0].length };
}

test('가로 3매치를 찾는다', () => {
  const state = makeState([
    [0, 0, 0, 1],
    [1, 2, 3, 0],
    [2, 3, 0, 1],
  ]);
  const matches = findMatches(state);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'line3');
  assert.equal(matches[0].color, 0);
  assert.equal(matches[0].cells.length, 3);
});

test('세로 4매치를 찾는다', () => {
  const state = makeState([
    [1, 0, 2, 3],
    [1, 2, 0, 3],
    [1, 3, 2, 0],
    [1, 0, 3, 2],
  ]);
  const matches = findMatches(state);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'line4');
  assert.equal(matches[0].color, 1);
  assert.equal(matches[0].cells.length, 4);
});

test('가로/세로 런이 끝에서 교차하면 L자 모양으로 묶인다', () => {
  const state = makeState([
    [2, 9, 8, 7],
    [2, 4, 5, 6],
    [2, 2, 2, 1],
  ]);
  const matches = findMatches(state);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'L');
  assert.equal(matches[0].cells.length, 5);
});

test('세로 런의 중간에 가로 런이 끝나며 만나면 T자 모양으로 묶인다', () => {
  const state = makeState([
    [3, 9, 8],
    [3, 3, 3],
    [3, 7, 6],
  ]);
  const matches = findMatches(state);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'T');
  assert.equal(matches[0].cells.length, 5);
});

test('두 런의 중간이 겹치면 + 모양으로 묶인다', () => {
  const state = makeState([
    [9, 4, 8],
    [4, 4, 4],
    [7, 4, 6],
  ]);
  const matches = findMatches(state);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'plus');
  assert.equal(matches[0].cells.length, 5);
});

test('매치가 없으면 빈 배열을 반환한다', () => {
  const state = makeState([
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ]);
  assert.deepEqual(findMatches(state), []);
});
