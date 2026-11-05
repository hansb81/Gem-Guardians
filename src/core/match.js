// 가로/세로 3개 이상 연속된 같은 색을 찾아 "매치 그룹" 목록을 반환한다.
// { grid, rows, cols } 형태의 평면 배열 보드라면 무엇이든 받는다(Board 인스턴스도 그대로 넘기면 됨).
// 교차하는 가로/세로 런은 하나의 그룹으로 묶여 L/T/+ 같은 모양으로 분류되므로,
// 다음 단계의 특수 잼(4줄, L/T/+, 5줄) 판정에 이 결과를 그대로 재사용할 수 있다.
export function findMatches({ grid, rows, cols }) {
  const at = (r, c) => grid[r * cols + c];
  const runs = [];

  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols) {
      const value = at(r, c);
      let end = c;
      while (end + 1 < cols && at(r, end + 1) === value) end++;
      const length = end - c + 1;
      if (value >= 0 && length >= 3) {
        const cells = [];
        for (let cc = c; cc <= end; cc++) cells.push({ row: r, col: cc });
        runs.push({ direction: 'horizontal', value, cells });
      }
      c = end + 1;
    }
  }

  for (let c = 0; c < cols; c++) {
    let r = 0;
    while (r < rows) {
      const value = at(r, c);
      let end = r;
      while (end + 1 < rows && at(end + 1, c) === value) end++;
      const length = end - r + 1;
      if (value >= 0 && length >= 3) {
        const cells = [];
        for (let rr = r; rr <= end; rr++) cells.push({ row: rr, col: c });
        runs.push({ direction: 'vertical', value, cells });
      }
      r = end + 1;
    }
  }

  // 2x2 블록(박스 잼 생성 조건)도 run과 동일하게 union-find 입력에 섞어 넣는다. 일자 런과
  // 칸을 공유하면 같은 그룹으로 합쳐져 "2x2 + 일자"가 한 그룹(규칙 2 연장)이 된다.
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const v = at(r, c);
      if (v < 0) continue;
      if (at(r, c + 1) === v && at(r + 1, c) === v && at(r + 1, c + 1) === v) {
        runs.push({
          direction: 'square',
          value: v,
          cells: [
            { row: r, col: c },
            { row: r, col: c + 1 },
            { row: r + 1, col: c },
            { row: r + 1, col: c + 1 },
          ],
        });
      }
    }
  }

  if (runs.length === 0) return [];

  // 같은 칸을 공유하는 run들을 union-find로 하나의 그룹으로 합친다 (L/T/+ 모양).
  const parent = runs.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const cellToRuns = new Map();
  runs.forEach((run, i) => {
    for (const cell of run.cells) {
      const key = cell.row * cols + cell.col;
      if (!cellToRuns.has(key)) cellToRuns.set(key, []);
      cellToRuns.get(key).push(i);
    }
  });
  for (const runIndices of cellToRuns.values()) {
    for (let i = 1; i < runIndices.length; i++) union(runIndices[0], runIndices[i]);
  }

  const groupsByRoot = new Map();
  runs.forEach((run, i) => {
    const root = find(i);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root).push(run);
  });

  return Array.from(groupsByRoot.values()).map(buildGroup);
}

function buildGroup(groupRuns) {
  const cellMap = new Map();
  for (const run of groupRuns) {
    for (const cell of run.cells) cellMap.set(`${cell.row},${cell.col}`, cell);
  }
  // square(2x2) run은 라인 판정(라인4/폭탄교차/컬러5)을 오염시키면 안 되므로 분리해서 다룬다.
  const lineRuns = groupRuns.filter((run) => run.direction !== 'square');
  const squareRuns = groupRuns.filter((run) => run.direction === 'square');
  return {
    cells: Array.from(cellMap.values()),
    color: groupRuns[0].value,
    shape: classifyShape(lineRuns, squareRuns),
    // 가로/세로 런별 방향·길이. 특수 잼 종류 판정(라인=4줄, 컬러=5줄+, 폭탄=겹침)에 쓰인다.
    runs: lineRuns.map((run) => ({ direction: run.direction, length: run.cells.length })),
    // 2x2 블록들(박스 잼 생성 조건). 각 원소는 4칸 배열.
    squares: squareRuns.map((run) => run.cells),
    // 가로 런과 세로 런이 겹치는 칸(폭탄 잼이 생성될 위치). 겹침이 없으면 null.
    crossingCell: findCrossingCell(lineRuns),
  };
}

function findCrossingCell(groupRuns) {
  for (let i = 0; i < groupRuns.length; i++) {
    for (let j = i + 1; j < groupRuns.length; j++) {
      if (groupRuns[i].direction === groupRuns[j].direction) continue;
      const shared = findSharedCell(groupRuns[i], groupRuns[j]);
      if (shared) return shared;
    }
  }
  return null;
}

function isEndCell(run, cell) {
  const first = run.cells[0];
  const last = run.cells[run.cells.length - 1];
  return (
    (cell.row === first.row && cell.col === first.col) ||
    (cell.row === last.row && cell.col === last.col)
  );
}

function findSharedCell(a, b) {
  for (const cellA of a.cells) {
    for (const cellB of b.cells) {
      if (cellA.row === cellB.row && cellA.col === cellB.col) return cellA;
    }
  }
  return null;
}

function classifyShape(lineRuns, squareRuns) {
  if (lineRuns.length === 0 && squareRuns.length > 0) return 'square';
  if (lineRuns.length > 0 && squareRuns.length > 0) return 'squareComplex';

  if (lineRuns.length === 1) {
    const length = lineRuns[0].cells.length;
    if (length >= 5) return 'line5';
    if (length === 4) return 'line4';
    return 'line3';
  }

  if (lineRuns.length === 2) {
    const [a, b] = lineRuns;
    const shared = findSharedCell(a, b);
    if (shared) {
      const aEnd = isEndCell(a, shared);
      const bEnd = isEndCell(b, shared);
      if (aEnd && bEnd) return 'L';
      if (aEnd !== bEnd) return 'T';
      return 'plus';
    }
  }

  return 'complex';
}
