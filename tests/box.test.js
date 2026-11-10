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

test('박스+컬러 조합: 같은 색 일반 잼은 박스로 바뀌어 각자 한 번씩 발동하고, 같은 색 특수 잼은 바뀌지 않고 자기 효과로 터진다', () => {
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 3; // 박스 잼 원래 색
  grid[idx(2, 2)] = 3;
  grid[idx(2, 5)] = 3;
  grid[idx(5, 0)] = 3;
  grid[idx(4, 4)] = 3; // 같은 색 라인 잼
  const board = boardFromGrid(rows, cols, grid, 106);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  board.setSpecial(4, 4, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const state = new GameState({ board });

  assert.equal(state.trySwap(0, 0, 0, 1), true);
  const effects = collectAllEffects(state);

  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.equal(combo.comboKind, COMBO_KIND.BOX_COLOR);
  assert.deepEqual(combo.chainCells, [{ row: 4, col: 4 }]);

  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.equal(transform.kind, SPECIAL_KIND.BOX);
  // 일반 잼 (2,2),(2,5),(5,0)만 바뀐다 - 라인 잼(4,4)은 그대로.
  assert.deepEqual(
    transform.cells.map((c) => `${c.row},${c.col}`).sort(),
    ['2,2', '2,5', '5,0']
  );

  const activations = effects.filter((e) => e.type === 'specialActivate');
  for (const cell of transform.cells) {
    const mine = activations.filter((e) => e.position.row === cell.row && e.position.col === cell.col);
    assert.equal(mine.length, 1, `바뀐 박스 (${cell.row},${cell.col})는 정확히 한 번 발동해야 한다`);
    assert.equal(mine[0].kind, SPECIAL_KIND.BOX);
    assert.equal(mine[0].affected.length, 3, '자기 칸 + 랜덤 2개');
  }
  const line = activations.filter((e) => e.position.row === 4 && e.position.col === 4);
  assert.equal(line.length, 1);
  assert.equal(line[0].kind, SPECIAL_KIND.LINE, '같은 색 특수 잼은 박스로 바뀌지 않고 자기 효과로 터진다');

  assert.equal(state.resolutions.length, 0, 'drain이 끝나 있어야 한다');
  assert.ok(!board.grid.includes(EMPTY));
});

test('박스+컬러: 바뀐 박스가 많아 보드 곳곳이 armed여도 각 박스는 남은 잼 중 2개를 친다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => (i % 3 === 0 ? 3 : 1 + (i % 2)));
  const board = boardFromGrid(rows, cols, grid, 109);
  board.set(0, 0, 3);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  const state = new GameState({ board });

  assert.equal(state.trySwap(0, 0, 0, 1), true);
  const effects = collectAllEffects(state);
  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform.cells.length >= 8, '바뀐 박스가 충분히 많아야 의미 있는 테스트');
  const keys = new Set(transform.cells.map((c) => `${c.row},${c.col}`));
  const boxActs = effects.filter(
    (e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOX && keys.has(`${e.position.row},${e.position.col}`)
  );
  assert.equal(boxActs.length, transform.cells.length);
  for (const act of boxActs) assert.equal(act.affected.length, 3, '자기 칸 + 랜덤 2개(혼자만 터지면 안 된다)');
});

test('자기 차례를 기다리던 변환 특수 잼이 먼저 맞으면 그때 한 번만 발동한다', () => {
  // 박스+라인: 바뀐 라인 2개가 같은 줄에 있으면 앞 라인이 뒤 라인을 먼저 친다.
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 2;
  grid[idx(3, 1)] = 2;
  grid[idx(3, 4)] = 2;
  const board = boardFromGrid(rows, cols, grid, 107);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  const state = new GameState({ board });

  assert.equal(state.trySwap(0, 0, 0, 1), true);
  const effects = collectAllEffects(state);
  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.equal(transform.cells.length, 2);
  for (const cell of transform.cells) {
    const n = effects.filter(
      (e) => e.type === 'specialActivate' && e.position.row === cell.row && e.position.col === cell.col
    ).length;
    assert.equal(n, 1, `(${cell.row},${cell.col})는 한 번만 발동`);
  }
});

test('_armCell: 차례를 기다리는 특수 잼 칸을 다시 치면 대기 시간이 그 시각으로 앞당겨진다', () => {
  const board = boardFromGrid(3, 3, new Array(9).fill(1), 108);
  board.setSpecial(1, 1, { kind: SPECIAL_KIND.BOX, direction: null });
  const state = new GameState({ board });
  const resolution = state._createResolution();
  resolution.chainActivated = new Set();
  resolution.protectedKeys = new Set();
  state._armCell(resolution, { row: 1, col: 1 }, 500, 'transform', 1, { forceSelfEffect: true });
  const cs = board.cellStates[board.index(1, 1)];
  cs.elapsedMs = 100;
  state._armCell(resolution, { row: 1, col: 1 }, 30, 'line', 1);
  assert.equal(cs.durationMs, 130, '맞은 시각(100+30)에 발동');
  assert.equal(board.cellStates[board.index(1, 1)], cs, '새 예약을 따로 만들지 않는다(한 번만 발동)');
});

test('박스 잼 스왑으로 매치도 생기면 매치가 터지고 특수 잼이 생기며 박스 효과도 발동한다', () => {
  // (3,2)의 3이 (2,2)로 올라가면 row2가 3 3 3 3(라인4) -> (2,2)에 라인 잼. 박스는 (3,2)로 간다.
  const grid = [
    0, 1, 2, 3, 4, 0,
    1, 2, 3, 4, 0, 1,
    3, 3, 0, 3, 2, 4,
    2, 4, 3, 1, 0, 2,
    4, 0, 1, 2, 3, 4,
    0, 1, 2, 0, 1, 3,
  ];
  const board = boardFromGrid(6, 6, grid, 7);
  assert.equal(findMatches(board).length, 0);
  board.setSpecial(2, 2, { kind: SPECIAL_KIND.BOX, direction: null });
  const state = new GameState({ board });

  assert.equal(state.trySwap(2, 2, 3, 2), true);
  const effects = collectAllEffects(state);

  const creates = effects.filter((e) => e.type === 'specialCreate');
  assert.ok(
    creates.some((e) => e.kind === SPECIAL_KIND.LINE && e.position.row === 2 && e.position.col === 2),
    '라인4 매치로 상대 잼 칸(2,2)에 라인 잼이 생겨야 한다'
  );
  const boxActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOX);
  assert.equal(boxActivations.length, 1, '박스 효과는 한 번 발동한다');
  assert.deepEqual(boxActivations[0].position, { row: 3, col: 2 });
  assert.ok(
    !boxActivations[0].affected.some((c) => c.row === 2 && c.col === 2),
    '새로 생긴 특수 잼 칸은 박스 효과가 지우지 않는다'
  );
  assert.equal(state.resolutions.length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});
