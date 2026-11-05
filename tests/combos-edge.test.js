// 특수 잼끼리 스왑했을 때의 조합 효과(4단계) 경계값/회귀 방지 테스트.
// tests/combos.test.js의 스모크 테스트를 보완한다: 영향 칸의 "정확한 좌표 집합",
// 보드 모서리에서의 4x4 밀림, 조합 범위 안 다른 특수 잼의 연쇄 발동(및 그 효과 범위까지
// 추가로 지워지는지), 변환 개수/제외 규칙, 중복 발동 방지, 낙하·리필 후 빈 칸 없음(스트레스)을
// 다룬다. 구현 코드(src/core)는 수정하지 않는다.
//
// 옛 API(trySwap이 이벤트 배열을 반환)에서는 결과를 "반환된 이벤트 배열"에서 바로 읽었다.
// 지금은 trySwap이 bool만 반환하고, 같은 정보가 gameState.effects에 잠깐 떴다가 사라지므로
// collectAllEffects(모든 이펙트를 틱마다 스냅샷해서 중복 없이 누적)로 모아서 같은 내용을
// 검증한다. 과거 "spawn 이벤트의 spawns.length"로 확인하던 "이번 캐스케이드 단계에서 지워진
// 칸 총수"는, comboActivate.affected와 연쇄(specialActivate) 이벤트들의 affected를 합집합한
// 크기로 재현한다(둘은 수학적으로 같다 - 지워진 칸 하나당 낙하/리필 후 정확히 한 칸이
// 새로 그 칸을 메우므로, "새로 채워진 칸 수 = 지워진 칸 수"이기 때문이다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, COLORLESS, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { createRng } from '../src/core/rng.js';
import { SPECIAL_KIND, COMBO_KIND } from '../src/core/specials.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  return board;
}

// 매치가 생기지 않는 기본 패턴((row+col) % 5가 가로/세로 모두 연속 3개를 만들지 않음).
function baseGrid(rows, cols) {
  return Array.from({ length: rows * cols }, (_, i) => i % 5);
}

const keyOf = (cell) => `${cell.row},${cell.col}`;
const sortedKeys = (cells) => cells.map(keyOf).sort();

function assertSameCellSet(actual, expected, message) {
  assert.deepEqual(sortedKeys(actual), sortedKeys(expected), message);
}

// gameState.effects에 뜨는 모든 1회성 연출을 틱마다 스냅샷해서 누적 기록한다(객체 참조 기준
// 중복 제거). resolutions/cellStates/effects가 모두 빌 때까지(완전히 드레인될 때까지) 돈다.
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

// 여러 칸 목록을 합집합(중복 제거)해서 "이번 단계에서 실제로 지워진 칸 총수"를 재현한다.
function unionCells(cellLists) {
  const map = new Map();
  for (const cells of cellLists) {
    for (const cell of cells) map.set(keyOf(cell), cell);
  }
  return Array.from(map.values());
}

// 스펙 문서를 그대로 옮긴 "기대값 계산기"(구현 코드를 참조하지 않는 독립 재현).
function expectedLineLineCells(rows, cols, ref) {
  const map = new Map();
  for (let c = 0; c < cols; c++) map.set(`${ref.row},${c}`, { row: ref.row, col: c });
  for (let r = 0; r < rows; r++) map.set(`${r},${ref.col}`, { row: r, col: ref.col });
  return Array.from(map.values());
}

function expectedLineBombCells(rows, cols, ref) {
  const map = new Map();
  for (let r = ref.row - 1; r <= ref.row + 1; r++) {
    if (r < 0 || r >= rows) continue;
    for (let c = 0; c < cols; c++) map.set(`${r},${c}`, { row: r, col: c });
  }
  for (let c = ref.col - 1; c <= ref.col + 1; c++) {
    if (c < 0 || c >= cols) continue;
    for (let r = 0; r < rows; r++) map.set(`${r},${c}`, { row: r, col: c });
  }
  return Array.from(map.values());
}

function expectedRect(rowLo, rowHi, colLo, colHi) {
  const cells = [];
  for (let r = rowLo; r <= rowHi; r++) {
    for (let c = colLo; c <= colHi; c++) cells.push({ row: r, col: c });
  }
  return cells;
}

function chainActivateEffects(effects) {
  return effects.filter((e) => e.type === 'specialActivate');
}

// ============================================================
// 라인+라인
// ============================================================

test('라인+라인: 기준 칸이 보드 중앙이 아닐 때도 가로줄+세로줄의 정확한 좌표 집합을 지운다', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 101);
  board.setSpecial(3, 1, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.setSpecial(3, 2, { kind: SPECIAL_KIND.LINE, direction: 'vertical' });
  const state = new GameState({ board });

  const accepted = state.trySwap(3, 1, 3, 2);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.LINE_LINE);
  assert.deepEqual(combo.position, { row: 3, col: 2 });

  const expected = expectedLineLineCells(rows, cols, { row: 3, col: 2 });
  assertSameCellSet(combo.affected, expected, '가로 한 줄 + 세로 한 줄의 정확한 합집합이어야 한다');
  assert.equal(combo.affected.length, rows + cols - 1);

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

test('라인+라인: 범위 안의 다른 특수 잼이 연쇄 발동하고 그 효과 범위까지 추가로 지워진다', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 102);
  const a = { row: 3, col: 2 };
  const b = { row: 3, col: 3 };
  board.setSpecial(a.row, a.col, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.setSpecial(b.row, b.col, { kind: SPECIAL_KIND.LINE, direction: 'vertical' });
  // 세로줄(col=3) 안에 있는, 스왑과 무관한 폭탄 잼.
  board.setSpecial(0, 3, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(a.row, a.col, b.row, b.col);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.equal(combo.comboKind, COMBO_KIND.LINE_LINE);

  const chain = chainActivateEffects(effects);
  assert.equal(chain.length, 1, '스왑으로 소모된 두 라인 잼 자신은 따로 발동하지 않고, 폭탄 하나만 연쇄 발동해야 한다');
  const bombActivate = chain[0];
  assert.equal(bombActivate.kind, SPECIAL_KIND.BOMB);
  assert.deepEqual(bombActivate.position, { row: 0, col: 3 });
  // 폭탄 3x3(보드 위쪽 경계가 잘림): (0,2),(0,3),(0,4),(1,2),(1,3),(1,4)
  assert.deepEqual(bombActivate.affected, [
    { row: 0, col: 2 },
    { row: 0, col: 3 },
    { row: 0, col: 4 },
    { row: 1, col: 2 },
    { row: 1, col: 3 },
    { row: 1, col: 4 },
  ]);

  // 소모된 두 잼은 "연쇄 발동"으로 취급되지 않아야 한다(중복 발동 방지).
  assert.ok(!chain.some((e) => keyOf(e.position) === keyOf(a) || keyOf(e.position) === keyOf(b)));

  // 조합(11칸) + 폭탄 연쇄로 새로 추가된 칸((0,2),(1,2),(1,3),(1,4) 중 col=3 줄에 없던 4칸) = 15칸.
  const totalCleared = unionCells([combo.affected, ...chain.map((e) => e.affected)]);
  assert.equal(totalCleared.length, 15, '조합 직접 범위(11) + 연쇄로 추가된 범위(4) = 15칸이 지워져야 한다');

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ============================================================
// 폭탄+폭탄: 4x4가 보드 경계에서 항상 16칸으로 밀려나는지
// ============================================================

function bombBombCase(label, rows, cols, swapA, swapB, expectedRange) {
  test(`폭탄+폭탄: ${label}`, () => {
    const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 200);
    board.setSpecial(swapA.row, swapA.col, { kind: SPECIAL_KIND.BOMB, direction: null });
    board.setSpecial(swapB.row, swapB.col, { kind: SPECIAL_KIND.BOMB, direction: null });
    const state = new GameState({ board });

    const accepted = state.trySwap(swapA.row, swapA.col, swapB.row, swapB.col);
    assert.equal(accepted, true);

    const effects = collectAllEffects(state);
    const combo = effects.find((e) => e.type === 'comboActivate');
    assert.ok(combo, 'comboActivate 이펙트가 있어야 한다');
    assert.equal(combo.comboKind, COMBO_KIND.BOMB_BOMB);
    assert.equal(combo.affected.length, 16, '항상 4x4 = 16칸이어야 한다');
    for (const cell of combo.affected) {
      assert.ok(cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols, '모든 칸이 보드 안에 있어야 한다');
    }
    const [[rowLo, rowHi], [colLo, colHi]] = expectedRange;
    const expected = expectedRect(rowLo, rowHi, colLo, colHi);
    assertSameCellSet(combo.affected, expected, '밀려난 뒤의 정확한 4x4 범위와 일치해야 한다');
  });
}

// 좌상단 모서리, 가로 인접.
bombBombCase('좌상단 모서리(가로 인접)', 6, 6, { row: 0, col: 0 }, { row: 0, col: 1 }, [[0, 3], [0, 3]]);

// 좌상단 모서리, 세로 인접.
bombBombCase('좌상단 모서리(세로 인접)', 6, 6, { row: 0, col: 0 }, { row: 1, col: 0 }, [[0, 3], [0, 3]]);

// 우상단 모서리, 가로 인접.
bombBombCase('우상단 모서리(가로 인접)', 6, 6, { row: 0, col: 4 }, { row: 0, col: 5 }, [[0, 3], [2, 5]]);

// 좌하단 모서리, 세로 인접.
bombBombCase('좌하단 모서리(세로 인접)', 6, 6, { row: 4, col: 0 }, { row: 5, col: 0 }, [[2, 5], [0, 3]]);

// 우하단 모서리, 가로 인접.
bombBombCase('우하단 모서리(가로 인접)', 6, 6, { row: 5, col: 4 }, { row: 5, col: 5 }, [[2, 5], [2, 5]]);

// 위쪽 가장자리(모서리 아님), 가로 인접 - 세로만 밀린다.
bombBombCase('위쪽 가장자리(모서리 아님, 가로 인접)', 6, 6, { row: 0, col: 2 }, { row: 0, col: 3 }, [[0, 3], [1, 4]]);

// 오른쪽 가장자리(모서리 아님), 세로 인접 - 가로만 밀린다.
bombBombCase('오른쪽 가장자리(모서리 아님, 세로 인접)', 6, 6, { row: 2, col: 5 }, { row: 3, col: 5 }, [[1, 4], [2, 5]]);

// 내부(경계 밖 밀림 없음), 가로 인접.
bombBombCase('보드 내부(밀림 없음, 가로 인접)', 6, 6, { row: 2, col: 2 }, { row: 2, col: 3 }, [[1, 4], [1, 4]]);

test('폭탄+폭탄: 범위 안의 다른 특수 잼이 연쇄 발동하고 그 효과 범위까지 추가로 지워진다', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 201);
  const a = { row: 2, col: 2 };
  const b = { row: 2, col: 3 };
  board.setSpecial(a.row, a.col, { kind: SPECIAL_KIND.BOMB, direction: null });
  board.setSpecial(b.row, b.col, { kind: SPECIAL_KIND.BOMB, direction: null });
  // 4x4 범위(rows1-4,cols1-4) 안에 있는 라인 잼(가로).
  board.setSpecial(1, 1, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const state = new GameState({ board });

  const accepted = state.trySwap(a.row, a.col, b.row, b.col);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  const chain = chainActivateEffects(effects);
  assert.equal(chain.length, 1);
  const lineActivate = chain[0];
  assert.equal(lineActivate.kind, SPECIAL_KIND.LINE);
  assert.deepEqual(lineActivate.position, { row: 1, col: 1 });
  assert.deepEqual(lineActivate.affected, [
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 1, col: 3 },
    { row: 1, col: 4 },
    { row: 1, col: 5 },
  ]);

  // 4x4(16) + 라인 잼이 범위 밖으로 추가로 지운 (1,0),(1,5) = 18칸.
  const totalCleared = unionCells([combo.affected, ...chain.map((e) => e.affected)]);
  assert.equal(totalCleared.length, 18);

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ============================================================
// 라인+폭탄
// ============================================================

test('라인+폭탄: 보드 내부 기준 칸은 "굵은 +"(27칸) 정확한 좌표 집합을 지운다', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 300);
  board.setSpecial(3, 2, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.setSpecial(3, 3, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(3, 2, 3, 3);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.equal(combo.comboKind, COMBO_KIND.LINE_BOMB);
  const expected = expectedLineBombCells(rows, cols, { row: 3, col: 3 });
  assert.equal(expected.length, 27);
  assertSameCellSet(combo.affected, expected);
  assert.equal(combo.affected.length, 27);
});

test('라인+폭탄: 기준 칸이 모서리면 "굵은 +"가 자연스럽게 잘려 20칸이 된다', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 301);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  // 기준 칸(ref) = 도착 칸이어야 하므로 (0,1)->(0,0)로 스왑한다.
  const accepted = state.trySwap(0, 1, 0, 0);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.deepEqual(combo.position, { row: 0, col: 0 });
  const expected = expectedLineBombCells(rows, cols, { row: 0, col: 0 });
  assert.equal(expected.length, 20, '경계에 걸려 2줄(행)+2줄(열)-중복4 = 20칸이어야 한다');
  assertSameCellSet(combo.affected, expected);
  for (const cell of combo.affected) {
    assert.ok(cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols);
  }
});

test('라인+폭탄: 범위 안의 다른 특수 잼이 연쇄 발동하고 그 효과 범위까지 추가로 지워진다', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 302);
  const a = { row: 3, col: 2 };
  const b = { row: 3, col: 3 };
  board.setSpecial(a.row, a.col, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.setSpecial(b.row, b.col, { kind: SPECIAL_KIND.BOMB, direction: null });
  // 세로 3줄(col 2-4) 안에 있지만, 그 효과(3x3)는 "굵은 +" 범위 밖으로도 번진다.
  board.setSpecial(0, 2, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(a.row, a.col, b.row, b.col);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  const chain = chainActivateEffects(effects);
  assert.equal(chain.length, 1);
  assert.deepEqual(chain[0].position, { row: 0, col: 2 });
  assert.deepEqual(chain[0].affected, [
    { row: 0, col: 1 },
    { row: 0, col: 2 },
    { row: 0, col: 3 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 1, col: 3 },
  ]);

  // 27(굵은 +) + 연쇄로 범위 밖에 추가된 (0,1),(1,1) = 29칸.
  const totalCleared = unionCells([combo.affected, ...chain.map((e) => e.affected)]);
  assert.equal(totalCleared.length, 29);

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ============================================================
// 라인+컬러
// ============================================================

test('라인+컬러: 같은 색 일반 잼만 정확히 세어 변환하고, 이미 특수인 같은 색 칸과 스왑 자신은 제외한다', () => {
  const rows = 6;
  const cols = 6;
  const idx = (r, c) => r * cols + c;
  const grid = new Array(rows * cols).fill(1);
  const targetColor = 2;
  grid[idx(0, 0)] = targetColor; // 라인 잼의 원래 색(스왑 전)
  grid[idx(3, 3)] = targetColor; // 일반 잼(변환 대상)
  grid[idx(4, 4)] = targetColor; // 일반 잼(변환 대상)
  grid[idx(2, 2)] = targetColor; // 이미 특수(폭탄)인 같은 색 칸 - 변환 대상에서 제외돼야 함
  const board = boardFromGrid(rows, cols, grid, 400);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.BOMB, direction: null }); // 같은 색(2)이지만 이미 특수
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.equal(combo.comboKind, COMBO_KIND.LINE_COLOR);
  assert.equal(combo.affected.length, 2, '조합 직접 효과는 소모되는 두 칸뿐이다');

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform);
  assert.equal(transform.kind, SPECIAL_KIND.LINE);
  assert.equal(transform.cells.length, 2, '일반 잼 2칸만 변환 대상이어야 한다(이미 특수인 (2,2)는 제외)');

  const transformKeys = transform.cells.map(keyOf).sort();
  assert.deepEqual(transformKeys, ['3,3', '4,4']);
  assert.ok(!transformKeys.includes('0,0'), '스왑된 라인 잼 자신의 칸은 변환 대상이 아니어야 한다');
  assert.ok(!transformKeys.includes('0,1'), '스왑된 컬러 잼 자신의 칸은 변환 대상이 아니어야 한다');
  assert.ok(!transformKeys.includes('2,2'), '이미 특수인 같은 색 칸은 변환 대상이 아니어야 한다');
});

test('라인+컬러: 변환-연쇄는 한 번에 하나씩(순차) 발동하고, 사슬이 범위 밖까지 2단계로 번진다', () => {
  const rows = 6;
  const cols = 6;
  const idx = (r, c) => r * cols + c;
  const grid = new Array(rows * cols).fill(1);
  const targetColor = 2;
  grid[idx(0, 0)] = targetColor;
  grid[idx(3, 3)] = targetColor; // 유일한 변환 대상
  const board = boardFromGrid(rows, cols, grid, 401);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  // 다른 색(1)의 폭탄 잼 - row 3 위에 있어서, 변환된 라인이 가로로 뽑히면 연쇄된다.
  board.setSpecial(3, 0, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  // 방향 선택에 쓰이는 rng의 "첫 호출"만 가로(horizontal, 0.5 미만)로 고정하고,
  // 이후 호출(리필 등)은 원래 seed 기반 rng로 되돌린다. 전체를 고정하면 리필이 항상
  // 같은 색만 채워 매치가 무한히 반복되는 비현실적인 상태가 된다.
  const originalRng = board.rng;
  let rngCalls = 0;
  board.rng = () => {
    rngCalls += 1;
    return rngCalls === 1 ? 0.2 : originalRng();
  };

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform);
  assert.deepEqual(transform.cells, [{ row: 3, col: 3, direction: 'horizontal' }]);

  const chain = chainActivateEffects(effects);
  assert.equal(chain.length, 2, '변환된 라인 1개 + 그 라인이 연쇄시킨 폭탄 1개');

  assert.equal(chain[0].kind, SPECIAL_KIND.LINE);
  assert.deepEqual(chain[0].position, { row: 3, col: 3 });
  assert.deepEqual(chain[0].affected, [
    { row: 3, col: 0 },
    { row: 3, col: 1 },
    { row: 3, col: 2 },
    { row: 3, col: 3 },
    { row: 3, col: 4 },
    { row: 3, col: 5 },
  ]);

  assert.equal(chain[1].kind, SPECIAL_KIND.BOMB);
  assert.deepEqual(chain[1].position, { row: 3, col: 0 });
  assert.deepEqual(chain[1].affected, [
    { row: 2, col: 0 },
    { row: 2, col: 1 },
    { row: 3, col: 0 },
    { row: 3, col: 1 },
    { row: 4, col: 0 },
    { row: 4, col: 1 },
  ]);

  const combo = effects.find((e) => e.type === 'comboActivate');
  // a,b(2) + 라인 효과(6) + 폭탄이 추가로 번진 (2,0),(2,1),(4,0),(4,1)(4) = 12칸.
  const totalCleared = unionCells([combo.affected, ...chain.map((e) => e.affected)]);
  assert.equal(totalCleared.length, 12);

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ============================================================
// 폭탄+컬러
// ============================================================

test('폭탄+컬러: 같은 색 일반 잼만 정확히 세어 변환하고, 이미 특수인 같은 색 칸과 스왑 자신은 제외한다', () => {
  const rows = 6;
  const cols = 6;
  const idx = (r, c) => r * cols + c;
  const grid = new Array(rows * cols).fill(1);
  const targetColor = 3;
  grid[idx(0, 0)] = targetColor;
  grid[idx(2, 2)] = targetColor;
  grid[idx(5, 0)] = targetColor;
  grid[idx(4, 4)] = targetColor; // 이미 특수(라인)인 같은 색 칸 - 제외돼야 함
  const board = boardFromGrid(rows, cols, grid, 500);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOMB, direction: null });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  board.setSpecial(4, 4, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.equal(combo.comboKind, COMBO_KIND.BOMB_COLOR);
  assert.equal(combo.affected.length, 2);

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform);
  assert.equal(transform.kind, SPECIAL_KIND.BOMB);
  const transformKeys = transform.cells.map(keyOf).sort();
  assert.deepEqual(transformKeys, ['2,2', '5,0']);
  assert.ok(!transformKeys.includes('4,4'), '이미 특수인 같은 색 칸은 변환 대상이 아니어야 한다');
  assert.ok(!transformKeys.includes('0,0') && !transformKeys.includes('0,1'));
});

test('폭탄+컬러: 변환-연쇄는 한 번에 하나씩(순차) 발동하고, 사슬이 범위 밖까지 2단계로 번진다', () => {
  const rows = 6;
  const cols = 6;
  const idx = (r, c) => r * cols + c;
  const grid = new Array(rows * cols).fill(1);
  const targetColor = 3;
  grid[idx(0, 0)] = targetColor;
  grid[idx(3, 3)] = targetColor; // 유일한 변환 대상
  const board = boardFromGrid(rows, cols, grid, 501);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOMB, direction: null });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  // 다른 색(1)의 라인(가로) 잼 - 변환될 폭탄(3,3)의 3x3 범위(rows2-4,cols2-4) 안.
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform);
  // 폭탄 변환은 direction이 항상 null이다(rng 불필요, 완전히 결정론적).
  assert.deepEqual(transform.cells, [{ row: 3, col: 3, direction: null }]);

  const chain = chainActivateEffects(effects);
  assert.equal(chain.length, 2);

  assert.equal(chain[0].kind, SPECIAL_KIND.BOMB);
  assert.deepEqual(chain[0].position, { row: 3, col: 3 });
  assert.deepEqual(chain[0].affected, [
    { row: 2, col: 2 },
    { row: 2, col: 3 },
    { row: 2, col: 4 },
    { row: 3, col: 2 },
    { row: 3, col: 3 },
    { row: 3, col: 4 },
    { row: 4, col: 2 },
    { row: 4, col: 3 },
    { row: 4, col: 4 },
  ]);

  assert.equal(chain[1].kind, SPECIAL_KIND.LINE);
  assert.deepEqual(chain[1].position, { row: 2, col: 2 });
  assert.deepEqual(chain[1].affected, [
    { row: 2, col: 0 },
    { row: 2, col: 1 },
    { row: 2, col: 2 },
    { row: 2, col: 3 },
    { row: 2, col: 4 },
    { row: 2, col: 5 },
  ]);

  const combo = effects.find((e) => e.type === 'comboActivate');
  // a,b(2) + 폭탄 3x3(9) + 라인이 범위 밖으로 추가한 (2,0),(2,1)(2) = 14칸.
  const totalCleared = unionCells([combo.affected, ...chain.map((e) => e.affected)]);
  assert.equal(totalCleared.length, 14);

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ============================================================
// 컬러+컬러
// ============================================================

test('컬러+컬러: 보드 전체를 지우므로 범위 안 다른 특수 잼은 별도의 specialActivate 없이 함께 지워진다', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, baseGrid(rows, cols), 600);
  board.set(2, 2, COLORLESS);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.COLOR, direction: null });
  board.set(2, 3, COLORLESS);
  board.setSpecial(2, 3, { kind: SPECIAL_KIND.COLOR, direction: null });
  // 보드 전체가 지워지는 범위이므로, 이 폭탄은 "따로" 연쇄 발동할 필요가 없다(이미 포함됨).
  board.setSpecial(5, 5, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 2, 3);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.equal(combo.comboKind, COMBO_KIND.COLOR_COLOR);
  assert.equal(combo.affected.length, rows * cols);

  const comboStepActivations = effects.filter((e) => e.type === 'specialActivate' && e.cascadeIndex === 1);
  assert.equal(
    comboStepActivations.length,
    0,
    '컬러+컬러는 이미 보드 전체가 범위이므로 조합 단계(cascadeIndex=1)에서 별도의 specialActivate가 없어야 한다'
  );

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY), '낙하/리필 후 빈 칸이 남아있으면 안 된다');
});

// ============================================================
// 조합 후 낙하/리필 불변식 - 결정론적 스트레스 테스트
// ============================================================

test('스트레스: 결정론적 무작위 스왑을 반복해도 낙하/리필 후 빈 칸이 없고 매치가 남지 않는다', () => {
  const boardSeeds = [11, 22, 33, 44, 55];
  const swapsPerBoard = 400;

  for (const boardSeed of boardSeeds) {
    const board = new Board({ seed: boardSeed });
    const state = new GameState({ board });
    const pick = createRng(boardSeed * 7919 + 13);

    for (let i = 0; i < swapsPerBoard; i++) {
      const r1 = Math.floor(pick() * board.rows);
      const c1 = Math.floor(pick() * board.cols);
      const horizontal = pick() < 0.5;
      const r2 = horizontal ? r1 : r1 + 1;
      const c2 = horizontal ? c1 + 1 : c1;
      if (!board.inBounds(r2, c2)) continue;

      state.trySwap(r1, c1, r2, c2);

      // 한 번의 스왑이 완전히 해소될 때까지 드레인한다(옛 동기 모델과 동등한 지점에서 불변식을
      // 확인하기 위함 - 지금은 다른 열이 독립적으로 계속 진행될 수 있지만, 이 테스트 자체는
      // "스왑 하나 = 해소 하나"라는 옛 불변식을 그대로 재현하는 데 집중한다).
      let guard = 0;
      while ((state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null)) && guard < 10000) {
        state.update(0.05);
        guard++;
      }
      assert.ok(guard < 10000, `seed=${boardSeed}, i=${i}: 상한 안에 해소가 끝나야 한다`);

      assert.ok(!board.grid.includes(EMPTY), `seed=${boardSeed}, i=${i}: 빈 칸(EMPTY)이 남아있으면 안 된다`);
      assert.equal(findMatches(board).length, 0, `seed=${boardSeed}, i=${i}: 해소 후에는 매치가 남지 않아야 한다`);
    }
  }
});
