// 사용자가 명시한 3가지 신규 테스트: (1) 서로 다른 열의 독립 진행, (2) 잠긴 열 무시 + 합류,
// (3) 결정론적 퍼즈. tests/time-based-core.test.js(puzzle-logic이 만든 스모크 테스트)에도
// 비슷한 것이 있지만, 여기서는 사용자가 요구한 세부 조건(중간 상태 관찰, isColumnLocked 직접
// 확인, _beginClear의 "이미 점유된 칸은 건너뛴다" 방어 로직 자체를 노출하는 시나리오)까지
// 정식으로 검증한다. 구현 코드(src/core)는 수정하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { createRng } from '../src/core/rng.js';
import { ANIMATION_DURATIONS_MS } from '../src/config/animation.js';
import { SCORING_CONFIG } from '../src/config/scoring.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
}

// resolutions와 cellStates가 모두 idle로 돌아올 때까지 update(dt)를 반복한다(큐 소진 패턴).
function drainAll(state, { dtSeconds = 0.05, maxTicks = 2000 } = {}) {
  const { board } = state;
  const stillAnimating = () => state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null);
  let ticks = 0;
  while (stillAnimating() && ticks < maxTicks) {
    state.update(dtSeconds);
    ticks++;
  }
  return ticks;
}

// ============================================================
// 1) 독립 진행: 서로 다른 열에서 거의 동시에 일어난 두 유효 스왑은 서로를 기다리지 않고
//    각자 독립적으로 끝까지 해소된다.
// ============================================================

test('독립 진행: 겹치지 않는 열의 두 스왑은 동시에 각자 해소되고, 둘 다 끝나면 두 매치가 모두 보드에 반영된다', () => {
  // SwapA: (0,2)<->(1,2) -> row0 [0,0,1,2,3,4]가 [0,0,0,2,3,4]가 되어 cols 0-2에서 매치.
  // SwapB: (3,5)<->(4,5) -> row3 [4,1,2,3,3,4]가 [4,1,2,3,3,3]이 되어 cols 3-5에서 매치.
  // 두 매치의 열 범위(0-2 vs 3-5)가 겹치지 않으므로 완전히 독립적으로 진행돼야 한다.
  const grid = [
    0, 0, 1, 2, 3, 4,
    1, 2, 0, 3, 4, 2,
    2, 1, 0, 4, 2, 3,
    4, 1, 2, 3, 3, 4,
    1, 2, 4, 4, 0, 3,
    2, 4, 1, 0, 4, 3,
  ];
  const board = boardFromGrid(6, 6, grid, 99);
  assert.equal(findMatches(board).length, 0, '사전 조건: 초기 배치는 매치가 없어야 한다');
  const state = new GameState({ board });

  const acceptedA = state.trySwap(0, 2, 1, 2);
  assert.equal(acceptedA, true);
  assert.equal(state.resolutions.length, 1, 'A가 Resolution을 하나 만들어야 한다');
  // A가 건드리는 열(2)만 잠겨야 한다 - 다른 열은 전혀 영향받지 않는다.
  assert.equal(board.isColumnLocked(2), true);
  for (const col of [0, 1, 3, 4, 5]) {
    assert.equal(board.isColumnLocked(col), false, `col=${col}은 A와 무관하므로 잠기면 안 된다`);
  }

  // A가 아직 스왑 애니메이션 중일 때(끝나지 않은 상태) B를 수락해본다.
  state.update(0.05);
  assert.equal(state.resolutions.length, 1, 'A는 아직 끝나지 않았어야 한다');
  assert.equal(state.resolutions[0].done, false);

  const acceptedB = state.trySwap(3, 5, 4, 5);
  assert.equal(acceptedB, true, 'A가 진행 중이어도 전혀 다른 열의 B는 수락돼야 한다');
  assert.equal(state.resolutions.length, 2, 'A, B가 독립된 Resolution 두 개로 동시에 존재해야 한다');

  const idA = state.resolutions[0].id;
  const idB = state.resolutions[1].id;
  assert.notEqual(idA, idB);

  const ticks = drainAll(state, { maxTicks: 500 });
  assert.ok(ticks < 500, '상한 안에 둘 다 끝나야 한다');
  assert.equal(state.resolutions.length, 0, '둘 다 끝나면 resolutions가 비어야 한다');
  assert.ok(!board.grid.includes(EMPTY), 'EMPTY가 남아있으면 안 된다');
  assert.equal(findMatches(board).length, 0, 'A, B가 만든 매치가 전부 해소돼 남은 매치가 없어야 한다');
  assert.ok(board.cellStates.every((cs) => cs === null), '모든 칸이 idle로 돌아가야 한다');
});

// ============================================================
// 2-a) 잠금 무시: 진행 중인 Resolution이 점유한 열의 칸을 건드리는 새 스왑은 조용히 거부되고
//      보드/resolutions가 전혀 바뀌지 않는다.
// ============================================================

test('잠금 무시: 해소가 진행 중인 열에 속한 칸으로의 새 스왑은 거부되고 아무것도 바뀌지 않는다', () => {
  const grid = [
    0, 0, 1, 2, 3, 4,
    1, 2, 0, 3, 4, 2,
    2, 1, 0, 4, 2, 3,
    4, 1, 2, 3, 3, 4,
    1, 2, 4, 4, 0, 3,
    2, 4, 1, 0, 4, 3,
  ];
  const board = boardFromGrid(6, 6, grid, 99);
  const state = new GameState({ board });

  const acceptedA = state.trySwap(0, 2, 1, 2); // col 2를 잠근다.
  assert.equal(acceptedA, true);
  assert.equal(board.isColumnLocked(2), true);

  const gridSnapshot = board.grid.slice();
  const cellStatesSnapshot = board.cellStates.slice();

  // col1<->col2: col2가 이미 A에 의해 점유돼 있으므로 거부돼야 한다(col1 자체는 자유롭다).
  const rejected = state.trySwap(0, 1, 0, 2);
  assert.equal(rejected, false, '점유된 열(2)에 닿는 스왑은 거부돼야 한다');
  assert.equal(state.resolutions.length, 1, 'A 하나만 남아있어야 한다(B가 새로 생기면 안 된다)');
  assert.deepEqual(board.grid, gridSnapshot, '거부된 스왑은 보드를 전혀 바꾸면 안 된다');
  assert.deepEqual(board.cellStates, cellStatesSnapshot, '거부된 스왑은 cellStates도 전혀 바꾸면 안 된다');

  // col2의 다른 행(예: row3,col2)을 건드려도 마찬가지로 거부된다(그 열 전체가 잠겨 있으므로).
  const rejected2 = state.trySwap(3, 1, 3, 2);
  assert.equal(rejected2, false);
  assert.equal(state.resolutions.length, 1);

  drainAll(state, { maxTicks: 500 });
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ============================================================
// 2-b) 합류: 한 해소의 연쇄 발동 효과 범위가 "다른 Resolution이 점유 중인 열"에 닿으면,
//      그 칸은 이번 단계에서 건드리지 않고(스킵) 안전하게 넘어간다 - gameState.js의
//      _beginClear에 있는 "이미 cellStates가 있는 칸은 건너뛴다" 방어 로직을 직접 겨냥한
//      시나리오다. 실제 두 번째 Resolution을 만드는 대신, "다른 Resolution이 그 칸을 점유
//      중"인 상태를 cellStates에 직접 주입해 손으로 만든다(기획서가 명시한 방식).
// ============================================================

test('합류: 다른 열이 점유된 동안 그 열에 닿는 연쇄 효과는 해당 칸을 건너뛰고, 데이터가 깨지지 않는다', () => {
  const rows = 6;
  const cols = 6;
  // 매치가 생기지 않는 기본 패턴((row*cols+col) % 5).
  const base = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, base, 777);

  const row = 2;
  // row2 = [0,0,3,0,1,2] -> (row+1,2)의 0을 끌어올리면 row2가 [0,0,0,0,1,2]가 되어 가로
  // 4매치가 된다. (row,1)에 있는 기존 가로 라인 잼이 이 매치에 끼어 연쇄 발동하는데, 그
  // 효과 범위(자기 행 전체, cols 0-5)가 (row,5)까지 번진다.
  board.set(row, 0, 0);
  board.set(row, 1, 0);
  board.set(row, 2, 3);
  board.set(row, 3, 0);
  board.setSpecial(row, 1, { kind: 'line', direction: 'horizontal' });
  board.set(row + 1, 2, 0);

  // (row,5)는 "다른 Resolution이 지금 한창 점유하고 있는 칸"이라고 가정한다(예: 아주 먼 다른
  // 스왑이 그 열에서 낙하 애니메이션을 재생 중인 상황) - 실제 Resolution 객체를 만들 필요 없이
  // cellStates만 손으로 채워서 "점유 중"을 흉내 낸다. isColumnLocked(5)도 자연히 true가 된다.
  const occupiedIdx = board.index(row, 5);
  const occupiedOriginalValue = board.get(row, 5);
  board.cellStates[occupiedIdx] = {
    phase: 'falling',
    elapsedMs: 0,
    durationMs: 100000, // 우리가 직접 풀어줄 때까지 절대 자연 만료되지 않을 만큼 길게.
    value: occupiedOriginalValue,
    special: null,
    fromRow: row,
    fromCol: 5,
  };
  assert.equal(board.isColumnLocked(5), true);

  const state = new GameState({ board });
  // 스왑 자체는 col=2 하나만 건드리므로(세로 스왑), col=5가 잠겨 있어도 거부되지 않는다.
  const accepted = state.trySwap(row, 2, row + 1, 2);
  assert.equal(accepted, true);

  // 회귀 테스트(portability-reviewer가 발견한 버그): 점수는 "지워지기 전 집계"가 아니라
  // _commitCellClear가 실제로 지운 칸 수를 기준으로 매겨야 한다. 스왑 애니메이션만 끝날
  // 만큼의 dt를 한 번 줘서 1단계 캐스케이드(clearing 시작)까지만 동기로 진행시킨다. 이제는
  // "순차 폭발 타이밍" 때문에 그 한 틱에는 평범한 매치 칸(특수 아님)인 (2,0)(2,3)만 armedMs=0
  // 으로 즉시 커밋되고, 기존 라인 잼 자신(2,1)은 매치에 낀 특수 잼이라 체인(캐치 후
  // chainArmMs(200ms) 뒤에야 자기 효과) 규칙에 걸려 armed(needsGap) 상태로 대기한다 - 아직
  // 점수에 반영되지 않는다. 라인 잼의 효과로 드러나는 (2,4)는 그 체인이 실제로 발동한
  // 뒤에야 계산되므로 더 나중이다. 따라서 이 시점의 점수는 즉시 커밋된 2칸 기준이어야 한다.
  state.update((ANIMATION_DURATIONS_MS.swap + 1) / 1000);
  assert.equal(
    state.score,
    2 * SCORING_CONFIG.pointsPerCell * 1,
    '그 틱에는 특수 아닌 매치 칸((2,0)(2,3))만 즉시 커밋돼 점수에 반영된다'
  );

  // 해소를 끝까지 드레인한다 - col=5는 계속 우리가 점유한 상태로 둔다.
  let guard = 0;
  while (state.resolutions.length > 0 && guard < 10000) {
    state.update(0.02);
    guard++;
    // 불변식: 우리가 주입한 점유 칸은 어떤 틱에서도 덮어써지면 안 된다(절대 null이 되거나
    // 다른 객체로 바뀌면 안 된다 - _beginClear의 방어 로직이 지켜야 하는 것).
    assert.notEqual(board.cellStates[occupiedIdx], null, '점유된 칸의 cellStates가 다른 로직에 의해 지워지면 안 된다');
  }
  assert.ok(guard < 10000, '상한 안에 메인 해소가 끝나야 한다');
  assert.equal(state.resolutions.length, 0, '점유된 칸이 있어도 메인 해소는 끝까지 완료돼야 한다');

  // 원래 의도했던 검증: 점유돼서 건너뛴 칸은 점수에도 포함되면 안 된다 - 매치 자체는
  // (2,0)(2,1)(2,3) 3칸, 기존 라인 잼((2,1)) 연쇄 발동으로 row2 전체(0~5)가 범위에
  // 들어오지만 생성 칸(2,2)과 점유된 (2,5)는 빠지므로 실제로 지워지는 칸은
  // (2,0)(2,1)(2,3)(2,4) 4칸뿐이다 - affected 집계상의 5칸(점유 칸 포함)이 아니다. 완전히
  // 드레인된 뒤의 최종 점수로 확인한다(중간 시점은 타이밍에 따라 달라지므로 위에서 이미
  // 별도로 확인했다).
  assert.equal(
    state.score,
    4 * SCORING_CONFIG.pointsPerCell * 1,
    '점유돼서 건너뛴 칸은 점수에도 포함되면 안 된다(실제로 지워진 4칸 기준)'
  );

  // 점유된 칸 자체는 "건너뛰어졌을" 뿐 손상되지 않았다 - 값/특수 정보가 원래 그대로다.
  assert.equal(board.get(row, 5), occupiedOriginalValue, '점유 중 건너뛴 칸의 값은 바뀌면 안 된다');
  assert.ok(!board.grid.includes(EMPTY), 'EMPTY가 남아있으면 안 된다(점유된 칸도 EMPTY가 아니다)');

  // 이제 "다른 Resolution이 끝났다"고 가정하고 점유를 직접 풀어준다(합류).
  board.cellStates[occupiedIdx] = null;
  assert.equal(board.isColumnLocked(5), false);

  // 풀린 뒤에도 전체 보드는 여전히 매치/빈 칸 없이 일관된 상태여야 한다 - 점유 때문에
  // 건너뛴 칸이 있었다는 사실이 보드를 깨뜨리지 않았다는 뜻이다.
  assert.equal(findMatches(board).length, 0, '점유를 풀어준 뒤에도 매치가 남아있으면 안 된다');
  assert.ok(board.cellStates.every((cs) => cs === null), '모든 칸이 idle이어야 한다');

  // 참고: 이 "건너뛴 칸"은 그 효과가 실제로 적용되지는 않았다(의도된 트레이드오프 -
  // gameState.js의 _beginClear 주석이 명시하듯, 점유된 칸은 "그 칸을 소유한 Resolution이
  // idle이 된 뒤 자기 seedCells 기준으로 알아서 처리"하게 남겨두고 이번 단계에서는 손대지
  // 않는다). 핵심은 데이터가 깨지거나(중복 클리어, 잘못된 값) 보드에 매치/빈 칸이 남는 등의
  // 손상이 전혀 없다는 것이다.
});

// ============================================================
// 3) 결정론적 퍼즈: 무작위 간격의 dt와 무작위 인접 스왑을 반복해도, 매 틱 idle인데 EMPTY인
//    칸이 없고, 끝까지 드레인하면 매치/EMPTY/비-idle 칸이 전혀 남지 않는다.
// ============================================================

for (const seed of [1001, 2002, 3003]) {
  test(`결정론적 퍼즈(seed=${seed}): 무작위 dt + 무작위 인접 스왑을 반복해도 idle-EMPTY 불변식이 깨지지 않는다`, () => {
    const board = new Board({ rows: 6, cols: 6, seed });
    const state = new GameState({ board });
    const pick = createRng(seed * 31 + 7);

    const iterations = 800;
    for (let i = 0; i < iterations; i++) {
      const r1 = Math.floor(pick() * board.rows);
      const c1 = Math.floor(pick() * board.cols);
      const horizontal = pick() < 0.5;
      const r2 = horizontal ? r1 : r1 + 1;
      const c2 = horizontal ? c1 + 1 : c1;
      if (board.inBounds(r2, c2)) {
        state.trySwap(r1, c1, r2, c2);
      }

      // dt를 무작위로 섞는다(일부 틱은 애니메이션 도중에 멈춰있도록 짧게, 가끔은 길게).
      const dt = pick() * 0.08; // 0~80ms
      state.update(dt);

      // 불변식: idle(cellStates===null)인 칸은 절대 EMPTY일 수 없다.
      for (let idx = 0; idx < board.grid.length; idx++) {
        if (board.cellStates[idx] === null) {
          assert.notEqual(board.grid[idx], EMPTY, `seed=${seed}, i=${i}: idle인 칸(idx=${idx})이 EMPTY면 안 된다`);
        }
      }
    }

    const ticks = drainAll(state, { dtSeconds: 1, maxTicks: 5000 });
    assert.ok(ticks < 5000, `seed=${seed}: 상한 안에 모든 해소가 끝나야 한다`);
    assert.equal(state.resolutions.length, 0);
    assert.ok(!board.grid.includes(EMPTY), `seed=${seed}: 모든 해소가 끝나면 EMPTY가 없어야 한다`);
    assert.equal(findMatches(board).length, 0, `seed=${seed}: 모든 해소가 끝나면 매치가 남아있으면 안 된다`);
    assert.ok(board.cellStates.every((cs) => cs === null), `seed=${seed}: 모든 애니메이션이 끝나면 전부 idle이어야 한다`);
  });
}
