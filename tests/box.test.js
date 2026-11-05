// 박스 잼(2x2 매치로 생성되는 새 특수 잼) 규칙 테스트. docs/plan.md 12~15 참고.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, COLORLESS, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import {
  SPECIAL_KIND,
  COMBO_KIND,
  decideSpecialForGroup,
  pickSpawnCell,
  resolveActivations,
  resolveSpecialCombo,
} from '../src/core/specials.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  return board;
}

// gameState.effects에 뜨는 모든 1회성 연출을 틱마다 스냅샷해서 누적 기록한다(combos.test.js와 동일 패턴).
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

// ---- 생성: 2x2 감지 ----

test('2x2 블록은 square 모양 그룹이 되고 박스 잼을 만든다', () => {
  const grid = [
    0, 0, 9, 8,
    0, 0, 7, 6,
    5, 4, 3, 2,
  ];
  const matches = findMatches({ grid, rows: 3, cols: 4 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'square');
  assert.equal(matches[0].cells.length, 4);
  assert.deepEqual(matches[0].squares, [
    [
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 0 },
      { row: 1, col: 1 },
    ],
  ]);
  const decision = decideSpecialForGroup(matches[0]);
  assert.deepEqual(decision, { kind: SPECIAL_KIND.BOX, direction: null });
});

test('2x2에 일자 3개가 붙으면(2x3) 한 그룹으로 합쳐지고 squareComplex 모양이지만, 라인4가 없으면 여전히 박스로 판정한다', () => {
  // row0-1, col0-1 2x2 + row0 가로 3런(0,0,0)이 (0,0)-(0,1)을 공유 -> 한 그룹.
  const grid = [
    0, 0, 0,
    0, 0, 9,
    8, 7, 6,
  ];
  const matches = findMatches({ grid, rows: 3, cols: 3 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'squareComplex');
  assert.equal(matches[0].squares.length, 1);
  const decision = decideSpecialForGroup(matches[0]);
  assert.deepEqual(decision, { kind: SPECIAL_KIND.BOX, direction: null }, '라인3은 특수 생성 없음이라 박스가 이긴다');
});

test('2x2와 라인4가 겹치면 라인(4개 일자)이 박스보다 우선한다', () => {
  // col0 세로 4런(0,0,0,0) + (0,0)-(1,1) 2x2가 겹쳐 한 그룹.
  const grid = [
    0, 0, 9,
    0, 0, 8,
    0, 7, 6,
    0, 5, 4,
  ];
  const matches = findMatches({ grid, rows: 4, cols: 3 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].squares.length, 1);
  const decision = decideSpecialForGroup(matches[0]);
  assert.equal(decision.kind, SPECIAL_KIND.LINE, '라인4 우선순위가 박스보다 높아야 한다');
});

test('기존 line3/line4/L/T/plus shape 판정은 2x2 도입 후에도 그대로다', () => {
  assert.equal(findMatches({ grid: [0, 0, 0, 1, 2, 3], rows: 1, cols: 6 })[0].shape, 'line3');
  assert.equal(findMatches({ grid: [0, 0, 0, 0, 1, 2], rows: 1, cols: 6 })[0].shape, 'line4');
  assert.equal(
    findMatches({ grid: [2, 9, 8, 7, 2, 4, 5, 6, 2, 2, 2, 1], rows: 3, cols: 4 })[0].shape,
    'L'
  );
  assert.equal(findMatches({ grid: [3, 9, 8, 3, 3, 3, 3, 7, 6], rows: 3, cols: 3 })[0].shape, 'T');
  assert.equal(findMatches({ grid: [9, 4, 8, 4, 4, 4, 7, 4, 6], rows: 3, cols: 3 })[0].shape, 'plus');
});

test('박스 잼 생성 칸은 연쇄 매치면 2x2 블록의 첫 칸이다', () => {
  const grid = [
    0, 0, 9, 8,
    0, 0, 7, 6,
    5, 4, 3, 2,
  ];
  const matches = findMatches({ grid, rows: 3, cols: 4 });
  const spawnCell = pickSpawnCell(matches[0], SPECIAL_KIND.BOX, null);
  assert.deepEqual(spawnCell, { row: 0, col: 0 });
});

test('초기 보드는 2x2를 만들지 않는다(여러 seed로 확인)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed });
    const matches = findMatches(board);
    const hasSquare = matches.some((m) => m.squares.length > 0);
    assert.equal(hasSquare, false, `seed=${seed}: 초기 보드에 2x2가 있으면 안 된다`);
  }
});

// ---- 발동: 박스 스왑 ----

test('박스 잼을 일반 잼과 스왑하면 상대 잼+박스 잼+랜덤 2개가 지워진다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 101);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.BOX, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 2, 3);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const boxActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOX);
  // 정확히 한 번만 발동해야 한다 - boxCell을 스왑 전 위치로 잘못 기록하면 체인 발동 경로가
  // 같은 박스를 "또 다른 특수 잼"으로 오인해 두 번째 specialActivate가 더 생긴다(회귀 방지).
  assert.equal(boxActivations.length, 1, '같은 박스 잼이 중복 발동하면 안 된다');
  const activate = boxActivations[0];
  // 발동 위치는 스왑 후 실제로 박스 잼이 가 있는 칸(2,3)이어야 한다(스왑 전 칸이면 버그).
  assert.deepEqual(activate.position, { row: 2, col: 3 });
  // 박스 자신 + 상대 칸 + 랜덤 2개 = 4칸(겹치지 않는다는 가정 하에).
  assert.equal(activate.affected.length, 4);
  assert.ok(
    activate.affected.some((c) => c.row === 2 && c.col === 2),
    '스왑한 상대 칸(2,2)이 지워진 칸에 포함돼야 한다'
  );

  assert.equal(state.resolutions.length, 0, 'drain이 끝나 있어야 한다');
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

test('computeEffect(연쇄 경로)에서 박스 잼이 발동하면 자신 포함 최대 3칸을 지운다', () => {
  const board = boardFromGrid(5, 5, new Array(25).fill(1), 102);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.BOX, direction: null });
  const result = resolveActivations(board, [{ row: 2, col: 2 }]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, SPECIAL_KIND.BOX);
  assert.equal(result.affectedCells.size, 3, '자신 + 랜덤 2개 = 3칸');
});

// ---- 조합 분류 ----

test('resolveSpecialCombo는 박스 조합 쌍을 분류한다', () => {
  const line = { kind: SPECIAL_KIND.LINE, direction: 'horizontal' };
  const bomb = { kind: SPECIAL_KIND.BOMB, direction: null };
  const color = { kind: SPECIAL_KIND.COLOR, direction: null };
  const box = { kind: SPECIAL_KIND.BOX, direction: null };

  assert.equal(resolveSpecialCombo(box, line), COMBO_KIND.BOX_LINE);
  assert.equal(resolveSpecialCombo(line, box), COMBO_KIND.BOX_LINE);
  assert.equal(resolveSpecialCombo(box, bomb), COMBO_KIND.BOX_BOMB);
  assert.equal(resolveSpecialCombo(box, color), COMBO_KIND.BOX_COLOR);
  assert.equal(resolveSpecialCombo(box, box), COMBO_KIND.BOX_BOX);
});

// ---- 조합: 박스+박스 ----

test('박스+박스 조합: 랜덤 6개가 삭제된다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 103);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.BOX, direction: null });
  board.setSpecial(2, 3, { kind: SPECIAL_KIND.BOX, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 2, 3);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.BOX_BOX);
  // 스왑된 두 칸(a,b) + 랜덤 6개 = 최대 8칸(겹치지 않는다는 가정 하에).
  assert.equal(combo.affected.length, 8);
});

// ---- 조합: 박스+라인 / 박스+폭탄 ----

test('박스+라인 조합: 같은 색 랜덤 2개가 라인 잼으로 변환된 뒤 발동한다', () => {
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 2; // 박스 잼의 원래 색
  grid[idx(3, 3)] = 2;
  grid[idx(4, 4)] = 2;
  grid[idx(5, 5)] = 2;
  const board = boardFromGrid(rows, cols, grid, 104);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.BOX_LINE);

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform, 'specialTransform 이펙트가 있어야 한다');
  assert.equal(transform.kind, SPECIAL_KIND.LINE);
  assert.equal(transform.cells.length, 2, '색2 일반 잼 중 랜덤 2개만 변환돼야 한다');

  const chainActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.LINE);
  assert.equal(chainActivations.length, 2, '변환된 2칸이 모두 발동해야 한다');
});

test('박스+폭탄 조합: 같은 색 랜덤 2개가 폭탄 잼으로 변환된 뒤 발동한다', () => {
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 3;
  grid[idx(2, 2)] = 3;
  grid[idx(2, 5)] = 3;
  grid[idx(5, 0)] = 3;
  const board = boardFromGrid(rows, cols, grid, 105);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.BOMB, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform);
  assert.equal(transform.kind, SPECIAL_KIND.BOMB);
  assert.equal(transform.cells.length, 2);

  const chainActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOMB);
  assert.equal(chainActivations.length, 2);
});

// ---- 조합: 박스+컬러 ----

test('박스+컬러 조합: 같은 색이 전부 박스로 변환되고(터지지 않음) 변환개수x2 랜덤이 터진다', () => {
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 3; // 박스 잼 원래 색
  grid[idx(2, 2)] = 3;
  grid[idx(2, 5)] = 3;
  grid[idx(5, 0)] = 3;
  const board = boardFromGrid(rows, cols, grid, 106);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  // 스왑 애니메이션(160ms)이 끝나는 순간 _resolveComboStep이 동기로 실행되므로, 그 한 틱 뒤에는
  // 변환이 이미 board.setSpecial로 반영돼 있다 - 이후 cascade에서 그 칸이 다른 매치에 휘말려
  // 사라질 수도 있으므로(정상 동작), "살아남는다"는 이 시점에서 확인해야 한다.
  state.update(0.2);
  const transform = state.effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform, 'specialTransform 이펙트가 있어야 한다');
  assert.equal(transform.kind, SPECIAL_KIND.BOX);
  // 색3을 가진 일반 잼: (2,2),(2,5),(5,0) = 3칸(박스 잼 자신은 이미 특수라 plainCellsOfColor에서 빠진다).
  assert.equal(transform.cells.length, 3);
  for (const cell of transform.cells) {
    const special = board.getSpecial(cell.row, cell.col);
    assert.ok(special, '변환 직후에는 보드에 박스 잼으로 남아있어야 한다(즉시 터지지 않음)');
    assert.equal(special.kind, SPECIAL_KIND.BOX);
  }

  const effects = collectAllEffects(state);
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo);
  assert.equal(combo.comboKind, COMBO_KIND.BOX_COLOR);

  const boxActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOX);
  assert.ok(boxActivations.length >= 1, '변환개수x2 랜덤을 지우는 BOX specialActivate가 있어야 한다');

  assert.equal(state.resolutions.length, 0, 'drain이 끝나 있어야 한다');
  assert.ok(!board.grid.includes(EMPTY));
});
