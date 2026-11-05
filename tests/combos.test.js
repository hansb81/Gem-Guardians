// 특수 잼끼리 스왑했을 때의 조합 효과(4단계) 스모크 테스트.
// 자세한 경계값/엣지 케이스 검증은 별도 테스트(combos-edge.test.js)에서 다룬다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, COLORLESS, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { SPECIAL_KIND, COMBO_KIND, resolveSpecialCombo } from '../src/core/specials.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  return board;
}

// gameState.effects에 뜨는 모든 1회성 연출을 틱마다 스냅샷해서 누적 기록한다(객체 참조 기준
// 중복 제거). resolutions와 cellStates가 모두 idle로 돌아올 때까지(= 완전히 드레인될 때까지)
// 반복하므로, 호출이 끝나면 최종 보드 상태 검사도 바로 이어서 할 수 있다.
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
  assert.ok(ticks < maxTicks, '상한 안에 모든 애니메이션이 끝나야 한다');
  return found;
}

// ---- resolveSpecialCombo 분류 ----

test('resolveSpecialCombo는 종류 쌍에 맞는 COMBO_KIND를 반환한다', () => {
  const line = { kind: SPECIAL_KIND.LINE, direction: 'horizontal' };
  const bomb = { kind: SPECIAL_KIND.BOMB, direction: null };
  const color = { kind: SPECIAL_KIND.COLOR, direction: null };

  assert.equal(resolveSpecialCombo(line, line), COMBO_KIND.LINE_LINE);
  assert.equal(resolveSpecialCombo(bomb, bomb), COMBO_KIND.BOMB_BOMB);
  assert.equal(resolveSpecialCombo(line, bomb), COMBO_KIND.LINE_BOMB);
  assert.equal(resolveSpecialCombo(bomb, line), COMBO_KIND.LINE_BOMB);
  assert.equal(resolveSpecialCombo(line, color), COMBO_KIND.LINE_COLOR);
  assert.equal(resolveSpecialCombo(bomb, color), COMBO_KIND.BOMB_COLOR);
  assert.equal(resolveSpecialCombo(color, color), COMBO_KIND.COLOR_COLOR);
  assert.equal(resolveSpecialCombo(line, null), null);
});

// ---- 라인+라인 ----

test('라인+라인 조합: 기준 칸의 가로줄+세로줄 전체를 지운다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 21);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.setSpecial(2, 3, { kind: SPECIAL_KIND.LINE, direction: 'vertical' });
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 2, 3);
  assert.equal(accepted, true);
  assert.equal(state.resolutions.length, 1, '조합도 스왑 애니메이션을 거치는 Resolution을 하나 만든다');

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo, 'comboActivate 이펙트가 있어야 한다');
  assert.equal(combo.comboKind, COMBO_KIND.LINE_LINE);
  assert.deepEqual(combo.position, { row: 2, col: 3 }, '기준 칸은 도착 칸(b)이어야 한다');
  assert.equal(combo.affected.length, rows + cols - 1, '가로줄+세로줄 합집합(겹치는 칸 1개 제외)');

  assert.equal(state.resolutions.length, 0, 'drain이 끝나 있어야 한다');
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ---- 폭탄+폭탄 ----

test('폭탄+폭탄 조합: 4x4 범위를 지운다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 22);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.BOMB, direction: null });
  board.setSpecial(2, 3, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 2, 3);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.BOMB_BOMB);
  assert.equal(combo.affected.length, 16, '4x4 = 16칸');
});

test('폭탄+폭탄 조합: 보드 경계를 벗어나면 안쪽으로 밀어 4칸을 유지한다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 23);
  // 왼쪽 위 모서리: (0,0)<->(0,1) 가로 인접.
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOMB, direction: null });
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.affected.length, 16, '경계에서 밀려도 여전히 4x4 = 16칸이어야 한다');
  for (const cell of combo.affected) {
    assert.ok(cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols);
  }
});

// ---- 라인+폭탄 ----

test('라인+폭탄 조합: 기준 칸 중심 가로 3줄 + 세로 3줄("굵은 +")을 지운다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 24);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.setSpecial(3, 2, { kind: SPECIAL_KIND.BOMB, direction: null }); // 세로 인접
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 3, 2);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.LINE_BOMB);
  assert.deepEqual(combo.position, { row: 3, col: 2 });
  // 3줄(각 6칸) + 3줄(각 6칸) - 3x3 중복 = 18+18-9 = 27
  assert.equal(combo.affected.length, 27);
});

// ---- 라인+컬러 ----

test('라인+컬러 조합: 같은 색 일반 잼을 라인 잼으로 변환하고 순차 발동한다', () => {
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 2; // 라인 잼의 원래 색
  grid[idx(3, 3)] = 2;
  grid[idx(4, 4)] = 2;
  grid[idx(5, 5)] = 2;
  const board = boardFromGrid(rows, cols, grid, 25);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.LINE_COLOR);
  assert.equal(combo.affected.length, 2, '조합 직접 효과는 소모되는 두 칸뿐이어야 한다');

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform, 'specialTransform 이펙트가 있어야 한다');
  assert.equal(transform.kind, SPECIAL_KIND.LINE);
  assert.equal(transform.cells.length, 3, '색2를 가진 일반 잼 3칸이 변환 대상이어야 한다(라인 잼 자신은 제외)');

  // 현재 구현은 개별 specialActivate 이펙트에 'sequential' 불리언 필드를 실제로 싣지 않는다
  // (큐는 GameState 내부의 _sequentialQueue로만 관리된다) - 그래서 "순서대로(한 번에 하나씩)
  // 발동했는지"는 필드 값이 아니라 "서로 다른 3개가 생겼고, 동시에 2개 이상 떠 있던 적이
  // 없다"는 시간적 성질로 검증한다.
  const chainActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.LINE);
  assert.equal(chainActivations.length, 3, '변환된 3칸이 모두 발동해야 한다');
});

// ---- 폭탄+컬러 ----

test('폭탄+컬러 조합: 같은 색 일반 잼을 폭탄 잼으로 변환하고 순차 발동한다', () => {
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 3; // 폭탄 잼의 원래 색
  grid[idx(2, 2)] = 3;
  grid[idx(2, 5)] = 3;
  grid[idx(5, 0)] = 3;
  const board = boardFromGrid(rows, cols, grid, 26);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOMB, direction: null });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.BOMB_COLOR);
  assert.equal(combo.affected.length, 2);

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform);
  assert.equal(transform.kind, SPECIAL_KIND.BOMB);
  assert.equal(transform.cells.length, 3);

  const chainActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOMB);
  assert.equal(chainActivations.length, 3);
});

// ---- 컬러+컬러 ----

test('컬러+컬러 조합: 보드 전체를 지운다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 27);
  board.set(2, 2, COLORLESS);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.COLOR, direction: null });
  board.set(2, 3, COLORLESS);
  board.setSpecial(2, 3, { kind: SPECIAL_KIND.COLOR, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 2, 3);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.COLOR_COLOR);
  assert.equal(combo.affected.length, rows * cols, '보드 전체 칸이 지워져야 한다');

  assert.equal(state.resolutions.length, 0, 'drain이 끝나 있어야 한다(클리어 -> 낙하 -> 리필까지 거쳤다는 뜻)');
  assert.equal(findMatches(board).length, 0, '연쇄 해소 후에는 매치가 남지 않아야 한다');
  assert.ok(!board.grid.includes(EMPTY));
});
