// 특수 잼의 생성 규칙(매치 그룹 -> 종류 + 생성 칸)과 발동 규칙(종류 -> 영향 칸,
// 연쇄 발동)을 다룬다. 브라우저 API 사용 금지, 순수 로직.
export const SPECIAL_KIND = {
  LINE: 'line',
  BOMB: 'bomb',
  COLOR: 'color',
  BOX: 'box',
};

const keyOf = (cell) => `${cell.row},${cell.col}`;

// 매치 그룹 하나에서 생성할 특수 잼 종류를 정한다. 우선순위:
// 5개 일자(컬러) > 가로·세로 겹침(폭탄) > 4개 일자(라인) > 2x2(박스) > 그 외(없음 - 일반 제거).
export function decideSpecialForGroup(group) {
  const runs = group.runs ?? [];
  const squares = group.squares ?? [];
  if (runs.length === 0 && squares.length === 0) return null;

  const maxRunLength = runs.length ? Math.max(...runs.map((r) => r.length)) : 0;
  const hasHorizontal3 = runs.some((r) => r.direction === 'horizontal' && r.length >= 3);
  const hasVertical3 = runs.some((r) => r.direction === 'vertical' && r.length >= 3);

  if (maxRunLength >= 5) {
    return { kind: SPECIAL_KIND.COLOR, direction: null };
  }
  if (hasHorizontal3 && hasVertical3) {
    return { kind: SPECIAL_KIND.BOMB, direction: null };
  }
  if (maxRunLength === 4) {
    const run4 = runs.find((r) => r.length === 4);
    // 가로로 매치되면 세로 줄을 지우는 라인 잼, 세로로 매치되면 가로 줄을 지우는 라인 잼.
    const direction = run4.direction === 'horizontal' ? 'vertical' : 'horizontal';
    return { kind: SPECIAL_KIND.LINE, direction };
  }
  if (squares.length > 0) {
    return { kind: SPECIAL_KIND.BOX, direction: null };
  }
  return null;
}

// 생성 칸: 폭탄은 항상 겹치는 교차 칸. 라인/컬러/박스는 플레이어가 스왑으로 움직인 칸이
// 그룹에 포함돼 있으면 그 칸, 아니면(연쇄 매치) 박스는 2x2 블록의 첫 칸, 그 외는 그룹의
// 가운데 칸.
// isOccupied(cell)이 true인 칸(이미 특수 잼이 있는 칸)은 피한다 - 그 칸에 새 잼을 덮어쓰면
// 기존 특수 잼이 발동하지 못하고 사라진다. 원래 고른 칸에서 가장 가까운 빈 그룹 칸으로 옮긴다.
export function pickSpawnCell(group, kind, swapCells, isOccupied = () => false) {
  const preferred = preferredSpawnCell(group, kind, swapCells);
  if (!isOccupied(preferred)) return preferred;
  let best = null;
  let bestDist = Infinity;
  for (const cell of group.cells) {
    if (isOccupied(cell)) continue;
    const dist = manhattanDistance(cell, preferred);
    if (dist < bestDist) {
      best = cell;
      bestDist = dist;
    }
  }
  return best ?? preferred; // 그룹 전체가 특수 잼인 극단적 경우만 기존처럼 덮어쓴다.
}

function preferredSpawnCell(group, kind, swapCells) {
  if (kind === SPECIAL_KIND.BOMB) {
    return group.crossingCell ?? middleCell(group);
  }
  if (swapCells) {
    for (const cell of swapCells) {
      if (group.cells.some((c) => c.row === cell.row && c.col === cell.col)) return cell;
    }
  }
  if (kind === SPECIAL_KIND.BOX && group.squares?.length) {
    return group.squares[0][0];
  }
  return middleCell(group);
}

function middleCell(group) {
  return group.cells[Math.floor((group.cells.length - 1) / 2)];
}

// 보드 위 특정 색의 모든 칸을 찾는다(특수 잼도 포함). 변환 대상처럼 "일반 잼만" 필요하면
// plainCellsOfColor를 쓸 것.
export function cellsOfColor(board, color) {
  const cells = [];
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      if (board.get(r, c) === color) cells.push({ row: r, col: c });
    }
  }
  return cells;
}

// 보드에서 가장 많이 남은 색을 찾는다(동률이면 색 인덱스가 작은 쪽). 색이 전혀 없으면 null.
export function mostCommonColor(board) {
  const counts = new Map();
  for (const value of board.grid) {
    if (value < 0) continue; // EMPTY, COLORLESS 제외
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [color, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && color < best)) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

export function rowCells(board, row) {
  const cells = [];
  for (let c = 0; c < board.cols; c++) cells.push({ row, col: c });
  return cells;
}

export function columnCells(board, col) {
  const cells = [];
  for (let r = 0; r < board.rows; r++) cells.push({ row: r, col });
  return cells;
}

function squareCells(board, center, radius) {
  return rectCells(board, center.row - radius, center.row + radius, center.col - radius, center.col + radius);
}

// 연쇄로 발동되는(직접 스왑이 아닌) 특수 잼의 영향 칸 + (컬러 잼이면) 지울 색.
// 영향 칸에는 자기 자신의 칸도 포함한다.
export function computeEffect(board, cell, special) {
  if (special.kind === SPECIAL_KIND.LINE) {
    const cells = special.direction === 'vertical' ? columnCells(board, cell.col) : rowCells(board, cell.row);
    return { cells, color: null };
  }
  if (special.kind === SPECIAL_KIND.BOMB) {
    return { cells: squareCells(board, cell, 1), color: null };
  }
  if (special.kind === SPECIAL_KIND.BOX) {
    const extra = pickRandomIdleCells(board, 2, new Set([keyOf(cell)]));
    return { cells: [cell, ...extra], color: null };
  }
  if (special.kind === SPECIAL_KIND.COLOR) {
    const color = mostCommonColor(board);
    const cells = color === null ? [] : cellsOfColor(board, color);
    cells.push(cell); // 컬러 잼 자신도 소모된다.
    return { cells, color };
  }
  return { cells: [cell], color: null };
}

// seedCells(이미 매치/효과 범위에 걸린 특수 잼들)로부터 시작해 연쇄 발동을 BFS로 해소한다.
// activated는 이번 해소 전체에서 "이미 발동한 칸"을 추적하는 Set(문자열 키)이며,
// 호출 전에 비어있는 새 Set을 넘기거나 이전 발동분을 이어 넘겨도 된다(중복 발동 방지).
export function resolveActivations(board, seedCells, activated = new Set()) {
  const queue = [...seedCells];
  const affectedCells = new Map();
  const events = [];

  while (queue.length > 0) {
    const cell = queue.shift();
    const key = keyOf(cell);
    if (activated.has(key)) continue;
    const special = board.getSpecial(cell.row, cell.col);
    if (!special) continue;
    activated.add(key);

    const { cells: effectCells, color } = computeEffect(board, cell, special);
    for (const ec of effectCells) {
      affectedCells.set(keyOf(ec), ec);
      const ecKey = keyOf(ec);
      if (!activated.has(ecKey) && board.getSpecial(ec.row, ec.col)) {
        queue.push(ec);
      }
    }

    events.push({
      type: 'specialActivate',
      kind: special.kind,
      direction: special.direction ?? null,
      position: cell,
      color,
      affected: effectCells,
    });
  }

  return { affectedCells, events, activated };
}

// 특수 잼끼리 스왑했을 때 발동하는 조합 종류.
export const COMBO_KIND = {
  LINE_LINE: 'line_line',
  BOMB_BOMB: 'bomb_bomb',
  LINE_BOMB: 'line_bomb',
  LINE_COLOR: 'line_color',
  BOMB_COLOR: 'bomb_color',
  COLOR_COLOR: 'color_color',
  BOX_LINE: 'box_line',
  BOX_BOMB: 'box_bomb',
  BOX_COLOR: 'box_color',
  BOX_BOX: 'box_box',
};

// 스왑된 두 특수 잼의 종류만으로 조합 종류를 분류한다(보드/위치/색 정보는 필요 없음).
// 조합이 아니면(둘 중 하나라도 특수가 아니면) null.
export function resolveSpecialCombo(specialA, specialB) {
  if (!specialA || !specialB) return null;
  const kindA = specialA.kind;
  const kindB = specialB.kind;
  const has = (k) => kindA === k || kindB === k;

  if (kindA === SPECIAL_KIND.COLOR && kindB === SPECIAL_KIND.COLOR) return COMBO_KIND.COLOR_COLOR;
  if (has(SPECIAL_KIND.COLOR)) {
    if (has(SPECIAL_KIND.BOX)) return COMBO_KIND.BOX_COLOR;
    if (has(SPECIAL_KIND.LINE)) return COMBO_KIND.LINE_COLOR;
    if (has(SPECIAL_KIND.BOMB)) return COMBO_KIND.BOMB_COLOR;
    return null;
  }
  if (kindA === SPECIAL_KIND.BOX && kindB === SPECIAL_KIND.BOX) return COMBO_KIND.BOX_BOX;
  if (has(SPECIAL_KIND.BOX)) {
    if (has(SPECIAL_KIND.LINE)) return COMBO_KIND.BOX_LINE;
    if (has(SPECIAL_KIND.BOMB)) return COMBO_KIND.BOX_BOMB;
    return null;
  }
  if (kindA === SPECIAL_KIND.LINE && kindB === SPECIAL_KIND.LINE) return COMBO_KIND.LINE_LINE;
  if (kindA === SPECIAL_KIND.BOMB && kindB === SPECIAL_KIND.BOMB) return COMBO_KIND.BOMB_BOMB;
  if (has(SPECIAL_KIND.LINE) && has(SPECIAL_KIND.BOMB)) return COMBO_KIND.LINE_BOMB;
  return null;
}

// 두 범위([lo,hi])의 폭을 유지한 채 [0, size-1] 안쪽으로 밀어넣는다.
// 보드보다 큰 범위를 요청하면(엣지 케이스) 보드 전체를 덮는다.
function clampRange(lo, hi, size) {
  const width = hi - lo + 1;
  if (width >= size) return [0, size - 1];
  if (lo < 0) {
    hi += -lo;
    lo = 0;
  } else if (hi > size - 1) {
    const over = hi - (size - 1);
    lo -= over;
    hi -= over;
  }
  return [lo, hi];
}

function rectCells(board, rowLo, rowHi, colLo, colHi) {
  const cells = [];
  for (let r = rowLo; r <= rowHi; r++) {
    for (let c = colLo; c <= colHi; c++) {
      if (board.inBounds(r, c)) cells.push({ row: r, col: c });
    }
  }
  return cells;
}

// 라인+라인: 기준 칸의 가로 한 줄 + 세로 한 줄 전체("+" 모양, 보드 전체 폭/높이).
export function lineLineComboCells(board, ref) {
  const cells = new Map();
  for (const cell of rowCells(board, ref.row)) cells.set(keyOf(cell), cell);
  for (const cell of columnCells(board, ref.col)) cells.set(keyOf(cell), cell);
  return Array.from(cells.values());
}

// 폭탄+폭탄: 4x4 범위. a,b가 가로로 인접하면 col 범위는 a,b 기준, row 범위는 ref 기준
// (반대로 세로로 인접하면 축이 바뀐다). 경계를 벗어나면 폭을 유지한 채 안쪽으로 민다.
export function bombComboCells(board, a, b, ref) {
  const horizontal = a.row === b.row;
  let rowLo;
  let rowHi;
  let colLo;
  let colHi;
  if (horizontal) {
    colLo = Math.min(a.col, b.col) - 1;
    colHi = Math.max(a.col, b.col) + 1;
    rowLo = ref.row - 1;
    rowHi = ref.row + 2;
  } else {
    rowLo = Math.min(a.row, b.row) - 1;
    rowHi = Math.max(a.row, b.row) + 1;
    colLo = ref.col - 1;
    colHi = ref.col + 2;
  }
  [rowLo, rowHi] = clampRange(rowLo, rowHi, board.rows);
  [colLo, colHi] = clampRange(colLo, colHi, board.cols);
  return rectCells(board, rowLo, rowHi, colLo, colHi);
}

// 라인+폭탄: 기준 칸 중심 가로 3줄(전체 폭) + 세로 3줄(전체 높이, "굵은 +"). 경계는 자연스럽게 잘린다.
export function lineBombComboCells(board, ref) {
  const cells = new Map();
  for (let r = ref.row - 1; r <= ref.row + 1; r++) {
    if (r < 0 || r >= board.rows) continue;
    for (const cell of rowCells(board, r)) cells.set(keyOf(cell), cell);
  }
  for (let c = ref.col - 1; c <= ref.col + 1; c++) {
    if (c < 0 || c >= board.cols) continue;
    for (const cell of columnCells(board, c)) cells.set(keyOf(cell), cell);
  }
  return Array.from(cells.values());
}

// 라인+컬러/폭탄+컬러 변환 대상: 주어진 색을 가진 "일반 잼"(특수가 아닌 칸)만.
export function plainCellsOfColor(board, color) {
  const cells = [];
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      if (board.get(r, c) === color && !board.getSpecial(r, c)) cells.push({ row: r, col: c });
    }
  }
  return cells;
}

// seed RNG로 배열을 제자리 섞는다(Fisher-Yates). 박스 잼의 "랜덤 N개" 선택에 공통으로 쓴다.
function shuffleInPlace(cells, rng) {
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

// 박스 잼의 "랜덤 count개" 대상: idle(애니메이션 없음)이고 열이 잠기지 않았고 excludeKeys에
// 없는 칸만 풀로 써서 seed RNG로 섞어 최대 count개 뽑는다(모자라면 있는 만큼만).
export function pickRandomIdleCells(board, count, excludeKeys = new Set()) {
  const pool = [];
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      if (board.cellStates[board.index(r, c)] !== null) continue;
      if (board.isColumnLocked(c)) continue;
      const cell = { row: r, col: c };
      if (excludeKeys.has(keyOf(cell))) continue;
      pool.push(cell);
    }
  }
  return shuffleInPlace(pool, board.rng).slice(0, count);
}

// 박스+라인/박스+폭탄 변환 대상: 주어진 색의 일반 잼 풀에서 seed RNG로 최대 count개 추출.
export function pickRandomCellsOfColor(board, color, count) {
  return shuffleInPlace(plainCellsOfColor(board, color), board.rng).slice(0, count);
}

// 컬러+컬러: 보드 위 모든 칸.
export function allCells(board) {
  const cells = [];
  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) cells.push({ row: r, col: c });
  }
  return cells;
}

// ------------------------------------------------------------
// 순차 발동 타이밍(§A) 공용 헬퍼 - gameState.js와 공유한다.
// ------------------------------------------------------------

// 라인 발동 거리 계산용(가로/세로 한 줄 위에서는 두 차이 중 하나가 항상 0이라 일반
// 맨해튼 거리와 동일하게 쓸 수 있다).
export function manhattanDistance(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

// 폭탄 발동 거리 계산용(정사각형 범위의 "링" 단위 거리).
export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

// raw delay 배열을, "한 발동" 단위로 가장 큰 값이 capMs를 넘지 않게 선형으로 축소한다.
function scaleDelays(raw, capMs) {
  const max = raw.length ? Math.max(...raw) : 0;
  const scale = max > capMs ? capMs / max : 1;
  return raw.map((v) => v * scale);
}

// cells 각각을 origin으로부터의 거리 * stepMs로 늦추고, capMs(한 발동 단위)에 맞춰 스케일한
// 배열을 cells와 같은 순서/길이로 반환한다.
export function computeDistanceDelays(cells, origin, stepMs, capMs, distanceFn) {
  const raw = cells.map((cell) => distanceFn(cell, origin) * stepMs);
  return scaleDelays(raw, capMs);
}

// count개 항목에 등장 순서대로 0, stepMs, 2*stepMs...를 배정하고 capMs에 맞춰 스케일한다.
export function computeSequentialDelays(count, stepMs, capMs) {
  const raw = Array.from({ length: count }, (_, i) => i * stepMs);
  return scaleDelays(raw, capMs);
}
