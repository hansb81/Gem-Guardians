import { GEM_TYPES } from '../config/gems.js';
import { BOARD_CONFIG } from '../config/board.js';
import { createRng } from './rng.js';
import { hasAnyValidMove } from './moves.js';
import { findMatches } from './match.js';

export const EMPTY = -1;
// 컬러 잼(무지개)은 색이 없다. 일반 색 인덱스(0..typeCount-1)와 구분되는 자리표시자.
export const COLORLESS = -2;
// occupant 방해요소가 칸을 차지하면 grid에 이 값을 넣는다(잼 없음) - 음수라 findMatches/
// moves의 "value >= 0" 매치 판정에서 자동으로 제외된다. 방해요소 메타데이터(종류/hp)는
// board.occupants에 나란히 들고 있다(src/core/obstacles/).
export const OBSTACLE = -3;

// 보드 상태와 생성 규칙만 다룬다. DOM/Canvas/타이머 등 브라우저 API는 사용하지 않는다.
// grid는 칸마다 색(또는 EMPTY/COLORLESS)을, specials는 같은 인덱스에 특수 잼 메타데이터
// ({ kind, direction? } | null)를 나란히 들고 있다. 두 배열은 항상 같이 이동한다(swap/낙하/리필).
export class Board {
  constructor({ rows = BOARD_CONFIG.rows, cols = BOARD_CONFIG.cols, typeCount = GEM_TYPES.length, rng, seed } = {}) {
    this.rows = rows;
    this.cols = cols;
    this.typeCount = typeCount;
    this.rng = rng ?? createRng(seed ?? Date.now());
    this.grid = this._generateSolvableGrid();
    this.specials = new Array(this.rows * this.cols).fill(null);
    // 방해요소 레이어(src/core/obstacles/) - occupant는 칸을 차지(잼 없음, grid=OBSTACLE),
    // attachment는 잼 위에 붙는다(그 잼과 같이 스왑/매치/낙하). 둘 다 { type, hp, ... } | null.
    // core 자체(board/match/gravity/moves)는 이 배열의 내용을 해석하지 않고 그냥 실어 나른다.
    this.occupants = new Array(this.rows * this.cols).fill(null);
    this.attachments = new Array(this.rows * this.cols).fill(null);
    // 칸마다 "지금 애니메이션 중인가"를 나타내는 flat 배열. idle이면 null, 아니면
    // { phase: 'armed'|'clearing'|'falling'|'spawning', elapsedMs, durationMs, value, special, fromRow, fromCol }.
    // value/special은 전환이 시작된 시점의 스냅샷이라 렌더가 core를 건드리지 않고 이것만 읽으면 된다.
    // 상태는 idle(null) 포함 정확히 5가지뿐이다(기획에서 그렇게 고정) - 'falling'은
    // "중력 낙하"와 "스왑으로 제자리 이동"(유효/무효 스왑 모두)을 둘 다 포괄해서 쓴다.
    // 별도 'swapping' phase를 따로 만들지 않는 이유는 둘 다 "from -> to 위치 보간"이라는
    // 같은 시각 효과이기 때문이다. 'armed'(순차 폭발 대기, docs/plan.md §17)는 falling/clearing/
    // spawning과 달리 resolutionId/cause 등 추가 필드를 싣는다(gameState.js의 _armCell 참고).
    this.cellStates = new Array(this.rows * this.cols).fill(null);
  }

  index(row, col) {
    return row * this.cols + col;
  }

  get(row, col) {
    return this.grid[this.index(row, col)];
  }

  set(row, col, value) {
    this.grid[this.index(row, col)] = value;
  }

  getSpecial(row, col) {
    return this.specials[this.index(row, col)];
  }

  setSpecial(row, col, special) {
    this.specials[this.index(row, col)] = special;
  }

  inBounds(row, col) {
    return row >= 0 && row < this.rows && col >= 0 && col < this.cols;
  }

  isAdjacent(r1, c1, r2, c2) {
    const dr = Math.abs(r1 - r2);
    const dc = Math.abs(c1 - c2);
    return dr + dc === 1;
  }

  // 두 칸이 인접할 때만 교환하고(색 + 특수 메타데이터 모두) 성공 여부를 반환한다.
  swap(r1, c1, r2, c2) {
    if (!this.inBounds(r1, c1) || !this.inBounds(r2, c2)) return false;
    if (!this.isAdjacent(r1, c1, r2, c2)) return false;
    const i1 = this.index(r1, c1);
    const i2 = this.index(r2, c2);

    const value = this.grid[i1];
    this.grid[i1] = this.grid[i2];
    this.grid[i2] = value;

    const special = this.specials[i1];
    this.specials[i1] = this.specials[i2];
    this.specials[i2] = special;

    // attachment 방해요소(시한폭탄)는 잼 위에 붙어 있으므로 잼과 같이 스왑된다.
    // occupant는 여기 들어오지 않는다(호출부가 swappable:false를 미리 걸러낸다).
    const attachment = this.attachments[i1];
    this.attachments[i1] = this.attachments[i2];
    this.attachments[i2] = attachment;

    return true;
  }

  randomType() {
    return Math.floor(this.rng() * this.typeCount);
  }

  // 그 열의 어떤 행이든 cellStates가 null이 아니면 잠긴 것으로 본다. 별도 플래그를
  // 저장하지 않고 매번 cellStates에서 유도한다(idle 칸만 있으면 항상 false).
  isColumnLocked(col) {
    for (let r = 0; r < this.rows; r++) {
      if (this.cellStates[this.index(r, col)] !== null) return true;
    }
    return false;
  }

  // 이 칸과 그 아래 칸이 전부 idle이고 빈 칸이 없으면 "안정" - 중력은 빈 칸 위만 끌어내리므로
  // 이 칸은 다른 해소가 진행 중이어도 위치가 바뀌지 않는다(plan.md 4-2). 스왑·매치·아이템 대상 판정용.
  isCellStable(row, col) {
    for (let r = row; r < this.rows; r++) {
      const i = this.index(r, col);
      if (this.cellStates[i] !== null || this.grid[i] === EMPTY) return false;
    }
    return true;
  }

  // 낙하를 지금 커밋해도 되는 열인지 - 가장 아래 빈 칸과 그 위가 전부 idle이어야 한다(그 위의
  // 잼만 움직이므로). 빈 칸 아래쪽 칸은 애니메이션 중이어도 상관없다.
  canSettleColumn(col) {
    let lowestEmpty = -1;
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.grid[this.index(r, col)] === EMPTY) {
        lowestEmpty = r;
        break;
      }
    }
    for (let r = 0; r <= lowestEmpty; r++) {
      if (this.cellStates[this.index(r, col)] !== null) return false;
    }
    return true;
  }

  // 애니메이션 중인 칸을 EMPTY로 가린 grid 사본 - 매치 탐색용. 떨어지는 중인 잼은 데이터상
  // 이미 도착해 있어서, 가리지 않으면 화면에 닿기 전에 매치로 잡힌다. out 버퍼를 재사용한다.
  idleGrid(out = new Array(this.grid.length)) {
    for (let i = 0; i < this.grid.length; i++) out[i] = this.cellStates[i] === null ? this.grid[i] : EMPTY;
    return out;
  }

  // 매치가 없고 가능한 수가 1개 이상 있는 새 그리드로 통째로 교체한다.
  // 재배치는 특수 잼을 보존하지 않는다(마지막 수단으로만 쓰이는 전체 리셋).
  // cellStates도 전부 idle로 되돌린다(호출 시점에는 보통 이미 전부 idle이지만, 방어적으로 정리한다).
  // fixedIndices(Set<number>, 선택)가 있으면 그 칸은 색을 건드리지 않는다 - 방해요소
  // occupant 칸을 재배치에서 살려두기 위해 쓴다(obstacles.js). attachments도 보존한다
  // (잼 색만 새로 섞을 뿐, 그 위에 붙은 시한폭탄은 떨어지지 않는다).
  reshuffle(fixedIndices) {
    this.grid = this._generateSolvableGrid(fixedIndices);
    this.specials = new Array(this.rows * this.cols).fill(null);
    this.cellStates = new Array(this.rows * this.cols).fill(null);
    return this.grid;
  }

  // 재배치를 "새 그리드"가 아니라 "이동 목록"으로 돌려준다(렌더가 셔플 연출을 보간해 그릴
  // 재료). reshuffle()과 달리 색을 새로 뽑지 않고 지금 있는 젬들을 자리만 맞바꾸며, 특수
  // 잼(종류/방향)도 그 젬과 함께 그대로 옮겨간다. fixedIndices(Set<number>, 선택)는
  // reshuffle()과 같은 의미 - occupant 방해요소 칸은 섞지 않는다(항상 from===to로 실린다).
  // 결과는 매치 없음 + 가능한 수 1개 이상을 만족할 때까지 목적지 순서만 다시 뽑는다(최대 50회,
  // reshuffle()의 재시도 캡과 동일). attachments는 reshuffle()처럼 칸에 그대로 남는다.
  shuffle(fixedIndices) {
    const n = this.rows * this.cols;
    const fixed = fixedIndices ?? new Set();
    const movable = [];
    for (let i = 0; i < n; i++) if (!fixed.has(i)) movable.push(i);

    const canSwap = (r1, c1, r2, c2) =>
      !fixed.has(this.index(r1, c1)) && !fixed.has(this.index(r2, c2));

    // 뽑을 수 있는 값은 "지금 보드에 있는" 값들뿐이다(generateMatchFreeGrid처럼 typeCount에서
    // 자유롭게 뽑지 않음) - 가방에서 하나씩 빼 쓰며, 왼쪽/위 2칸 + 2x2 조건(_wouldMatchAtGrid)에
    // 걸리지 않는 값을 우선한다. 순수 무작위 치환은 보드 전체 크기에선 매치 없이 끝날 확률이
    // 낮아 50번 재시도로도 못 찾는 경우가 있었다(실측) - 이 방식이면 거의 항상 1~2번에 끝난다.
    const bag = movable.map((i) => ({ srcIdx: i, value: this.grid[i], special: this.specials[i] }));

    let newGrid;
    let newSpecials;
    let destOf;
    let attempts = 0;
    do {
      this._shuffleIndices(bag);
      const grid = new Array(n).fill(EMPTY);
      for (const i of fixed) grid[i] = this.grid[i];
      const specials = new Array(n).fill(null);
      const pool = bag.slice();
      destOf = new Map();
      for (let idx = 0; idx < n; idx++) {
        if (fixed.has(idx)) continue;
        const r = Math.floor(idx / this.cols);
        const c = idx % this.cols;
        let pick = pool.findIndex((item) => !this._wouldMatchAtGrid(grid, r, c, item.value));
        if (pick === -1) pick = 0; // 전부 매치면(이론상 드묾) 그냥 첫 항목 - 아래서 다시 통째로 검증한다.
        const item = pool.splice(pick, 1)[0];
        grid[idx] = item.value;
        specials[idx] = item.special;
        destOf.set(item.srcIdx, idx);
      }
      newGrid = grid;
      newSpecials = specials;
      attempts++;
    } while (
      attempts < 50 &&
      (findMatches({ grid: newGrid, rows: this.rows, cols: this.cols }).length > 0 ||
        !hasAnyValidMove({ grid: newGrid, rows: this.rows, cols: this.cols }, canSwap))
    );

    const posOf = (i) => ({ row: Math.floor(i / this.cols), col: i % this.cols });
    const moves = movable.map((srcIdx) => {
      const destIdx = destOf.get(srcIdx);
      return { id: srcIdx, from: posOf(srcIdx), to: posOf(destIdx), value: newGrid[destIdx], special: newSpecials[destIdx] };
    });
    for (const i of fixed) {
      moves.push({ id: i, from: posOf(i), to: posOf(i), value: this.grid[i], special: this.specials[i] });
    }

    this.grid = newGrid;
    this.specials = newSpecials;
    this.cellStates = new Array(n).fill(null);
    return moves;
  }

  // seed RNG로 배열을 제자리 섞는다(Fisher-Yates) - shuffle()의 목적지 순서를 뽑는 전용.
  _shuffleIndices(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  _generateSolvableGrid(fixedIndices) {
    let grid = this._generateMatchFreeGrid(fixedIndices);
    let attempts = 0;
    const canSwap = fixedIndices
      ? (r1, c1, r2, c2) => !fixedIndices.has(this.index(r1, c1)) && !fixedIndices.has(this.index(r2, c2))
      : undefined;
    // 매치 없이 채우는 알고리즘 특성상 가능한 수가 하나도 없는 경우는 극히 드물지만,
    // 혹시 그런 배치가 나오면 가능한 수가 생길 때까지 다시 생성한다. fixedIndices가 있을 때는
    // 그 칸을 거치는 스왑은 "가능한 수"로 치지 않는다(실제로 둘 수 없으므로) - 그래서 재배치가
    // 50번을 다 써도 수가 없을 수 있다(obstacles.js가 그 경우를 "실패"로 센다).
    while (!hasAnyValidMove({ grid, rows: this.rows, cols: this.cols }, canSwap) && attempts < 50) {
      grid = this._generateMatchFreeGrid(fixedIndices);
      attempts++;
    }
    return grid;
  }

  _generateMatchFreeGrid(fixedIndices) {
    const grid = new Array(this.rows * this.cols).fill(EMPTY);
    const idx = (r, c) => r * this.cols + c;
    if (fixedIndices) {
      for (const i of fixedIndices) grid[i] = this.grid[i];
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (fixedIndices?.has(idx(r, c))) continue; // 방해요소 칸 - 그대로 둔다(색이 없으므로
        // 아래 _wouldMatchAtGrid가 항상 false를 돌려줘 자연히 "벽"처럼 매치를 막아준다).
        const candidates = [];
        for (let t = 0; t < this.typeCount; t++) {
          if (!this._wouldMatchAtGrid(grid, r, c, t)) candidates.push(t);
        }
        // 이론상 5종/가로세로 조건에서는 항상 candidates가 존재하지만,
        // 혹시 모든 종류가 막히는 경우를 대비해 전체 종류로 폴백한다.
        const pool = candidates.length
          ? candidates
          : Array.from({ length: this.typeCount }, (_, i) => i);
        grid[idx(r, c)] = pool[Math.floor(this.rng() * pool.length)];
      }
    }
    return grid;
  }

  // 왼쪽 2칸, 위쪽 2칸만 확인하면 된다(그리드를 왼쪽→오른쪽, 위→아래로 채우므로
  // 이미 채워진 칸들 사이의 3매치는 모두 이 두 방향 검사로 걸러진다).
  _wouldMatchAtGrid(grid, row, col, typeId) {
    const c = this.cols;
    if (col >= 2 && grid[row * c + col - 1] === typeId && grid[row * c + col - 2] === typeId) {
      return true;
    }
    if (row >= 2 && grid[(row - 1) * c + col] === typeId && grid[(row - 2) * c + col] === typeId) {
      return true;
    }
    // 좌상/상/좌가 모두 같은 색이면 지금 칸을 채우면 2x2(박스 잼 조건)가 완성된다.
    if (
      row >= 1 &&
      col >= 1 &&
      grid[(row - 1) * c + col - 1] === typeId &&
      grid[(row - 1) * c + col] === typeId &&
      grid[row * c + col - 1] === typeId
    ) {
      return true;
    }
    return false;
  }
}
