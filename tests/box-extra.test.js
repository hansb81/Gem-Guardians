// 박스 잼 테스트 공백 메우기(tests/box.test.js가 이미 다루는 것과 중복되지 않는 부분만).
// docs/plan.md 12~15 참고. 구현 코드(src/core)는 수정하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, COLORLESS, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { hasAnyValidMove, findAnyValidMove } from '../src/core/moves.js';
import { createRng } from '../src/core/rng.js';
import { SPECIAL_KIND, pickRandomIdleCells } from '../src/core/specials.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  return board;
}

// gameState.effects에 뜨는 모든 1회성 연출을 틱마다 스냅샷해서 누적 기록한다(box.test.js와 동일 패턴).
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

// resolutions와 cellStates가 모두 idle로 돌아올 때까지 update(dt)를 반복한다.
function drainAll(state, { dtSeconds = 1, maxTicks = 5000 } = {}) {
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
// 1. 가능한 수 검사에 2x2 포함
// ============================================================

// 2x2를 "완성시키는 단일 스왑"은 수학적으로 항상 같은 모양의 부작용을 동반한다: 완성에 필요한
// 사전 조건(2x2의 세 칸 + 바깥에서 끌어올 네 번째 칸, 총 4칸이 이미 같은 색)이 성립하는 순간,
// 그 네 칸 중 두 쌍을 맞바꾸는 다른 스왑도 "우연히" 3-매치를 만들어버린다(칸을 어떻게 배치해도
// 피할 수 없다 - 안쪽 두 칸을 맞바꿔 봐도 사각형 안의 색 구성 자체는 바뀌지 않으므로 완성되지
//않고, 바깥 네 번째 칸을 기준으로 다른 두 칸을 잇는 줄도 이미 같은 색 세 개를 포함하게 된다).
// 그래서 "2x2를 완성하는 스왑 외에는 어떤 매치도 전혀 없는 보드"는 만들 수 없다. 대신 여기서는
// 1) 2x2를 만드는 스왑이 유일하게 square 모양이고, 2) 스캔 순서(행 우선, 각 칸에서 가로->세로)
// 상 다른 모든 유효한 수보다 앞에 오도록 배치해, hasAnyValidMove/findAnyValidMove가 실제로 그
// 스왑을 찾아내는지를 직접 검증한다(findMatches가 2x2를 인식하면 자동으로 되는 부분이지만
// moves.js 레이어에서 회귀가 생기면 바로 잡아내기 위한 명시적 테스트).
test('2x2를 완성시키는 스왑도 findAnyValidMove/hasAnyValidMove가 찾아내는 유효한 수다', () => {
  // grid(2행 3열): row0=[0,1,0], row1=[0,0,1].
  // (0,0)=(1,0)=(1,1)=0은 이미 2x2의 세 칸이고, (0,2)=0은 네 번째 칸(1,1)을 채워줄 바깥 칸.
  // (0,1)<->(0,2) 스왑 한 번으로 (0,0)(0,1)(1,0)(1,1)이 전부 0이 되어 2x2가 완성된다.
  const rows = 2;
  const cols = 3;
  const board = new Board({ rows, cols, typeCount: 5, seed: 1 });
  board.grid = [0, 1, 0, 0, 0, 1];
  board.specials = new Array(rows * cols).fill(null);

  assert.equal(findMatches(board).length, 0, '사전 조건: 스왑 전에는 매치가 없어야 한다');

  assert.equal(hasAnyValidMove(board), true);

  const move = findAnyValidMove(board);
  assert.deepEqual(move, { from: { row: 0, col: 1 }, to: { row: 0, col: 2 } }, '첫 번째로 발견되는 유효한 수가 2x2를 완성시키는 스왑이어야 한다');

  // 실제로 그 스왑이 2x2(square)를 만드는지 직접 확인한다.
  const swapped = board.grid.slice();
  [swapped[board.index(0, 1)], swapped[board.index(0, 2)]] = [swapped[board.index(0, 2)], swapped[board.index(0, 1)]];
  const matches = findMatches({ grid: swapped, rows, cols });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].shape, 'square');
});

// ============================================================
// 2. 랜덤 대상의 결정론
// ============================================================

test('같은 seed로 같은 보드 상태에서 박스 스왑을 트리거하면 랜덤 대상(affected)이 완전히 같다', () => {
  function runOnce() {
    const grid = Array.from({ length: 36 }, (_, i) => i % 5);
    const board = boardFromGrid(6, 6, grid, 909);
    board.setSpecial(2, 2, { kind: SPECIAL_KIND.BOX, direction: null });
    const state = new GameState({ board });

    const accepted = state.trySwap(2, 2, 2, 3);
    assert.equal(accepted, true);

    const effects = collectAllEffects(state);
    const activate = effects.find((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOX);
    assert.ok(activate, 'BOX specialActivate 이펙트가 있어야 한다');
    return activate.affected.map((c) => ({ row: c.row, col: c.col }));
  }

  const first = runOnce();
  const second = runOnce();
  assert.equal(first.length, 4, '박스 자신 + 상대 칸 + 랜덤 2개 = 4칸');
  assert.deepEqual(first, second, 'board.rng는 seed 기반이므로 같은 seed + 같은 보드 상태 + 같은 동작 순서면 같은 결과가 나와야 한다');
});

// ============================================================
// 3. 잠긴 칸이 랜덤 대상에서 제외되는지
// ============================================================

test('pickRandomIdleCells는 잠긴 열의 칸을 절대 고르지 않는다(count가 전체 idle 칸 수보다 커도)', () => {
  const rows = 6;
  const cols = 6;
  const board = boardFromGrid(rows, cols, Array.from({ length: 36 }, (_, i) => i % 5), 301);
  board.cellStates = new Array(rows * cols).fill(null);

  // col=4 전체를 "점유 중"으로 손으로 채워 잠근다(concurrent-resolution.test.js와 동일 패턴).
  for (let r = 0; r < rows; r++) {
    board.cellStates[board.index(r, 4)] = {
      phase: 'falling',
      elapsedMs: 0,
      durationMs: 999,
      value: board.get(r, 4),
      special: null,
      fromRow: r,
      fromCol: 4,
    };
  }
  assert.equal(board.isColumnLocked(4), true);
  for (const col of [0, 1, 2, 3, 5]) {
    assert.equal(board.isColumnLocked(col), false, `col=${col}은 잠기지 않아야 한다`);
  }

  // 보드 전체 칸 수(36)보다 큰 count를 요청해도 idle 칸(30칸, col=4의 6칸 제외)만큼만 나와야 한다.
  const picked = pickRandomIdleCells(board, 1000, new Set());
  assert.equal(picked.length, rows * cols - rows, '잠긴 열(6칸)을 제외한 idle 칸 전부가 나와야 한다');
  for (const cell of picked) {
    assert.notEqual(cell.col, 4, `잠긴 열(4)의 칸이 선택되면 안 된다: ${JSON.stringify(cell)}`);
  }
});

// ============================================================
// 4. 조합 대상이 부족할 때
// ============================================================

// 보드 전체를 한 색으로 채우면(균일 보드) 그 자체로 보드 전역에 매치가 깔려있는 비정상 상태라
// 조합 해소 후 "매치/EMPTY가 안 남는다"는 걸 의미 있게 검증할 수 없다(실제로 균일 보드로
// 시도해보면 조합과 무관한 영역이 남아 findMatches가 0이 되지 않는다 - 구현 버그가 아니라
// 테스트 픽스처 자체의 결함). 대신 Board가 스스로 생성하는(매치 없는) 보드를 그대로 쓰고,
// typeCount(5)로는 절대 나오지 않는 sentinel 색(5)만 손으로 심어서 "그 색의 일반 잼이 0개 또는
// 1개"인 상황을 만든다 - 나머지 보드는 자연히 매치 없는 상태를 유지한다.
function freshMatchFreeBoard(seed) {
  const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed });
  board.specials = new Array(36).fill(null);
  return board;
}

test('박스+라인 조합: 변환 대상 색의 일반 잼이 0개면 specialTransform 없이 에러 없이 끝난다', () => {
  const board = freshMatchFreeBoard(401);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.set(0, 1, 5); // typeCount=5 보드에는 절대 자연 발생하지 않는 색 - 보드에서 이 칸 하나뿐.
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.LINE, direction: 'horizontal' });
  assert.equal(findMatches(board).length, 0, '사전 조건: 손으로 심은 뒤에도 매치가 없어야 한다');
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.equal(transform, undefined, '변환 대상이 0개면 specialTransform 이펙트 자체가 없어야 한다');
  const lineActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.LINE);
  assert.equal(lineActivations.length, 0, '변환된 잼이 없으니 라인 발동도 없어야 한다');

  assert.equal(state.resolutions.length, 0, 'drain이 끝나 있어야 한다');
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

test('박스+폭탄 조합: 변환 대상 색의 일반 잼이 1개뿐이면 그 1개만 변환되고 발동한다', () => {
  const board = freshMatchFreeBoard(402);
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.set(0, 1, 5); // 폭탄 잼이 될 칸의 색(sentinel).
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.BOMB, direction: null });
  board.set(5, 5, 5); // 같은 sentinel 색의 유일한 다른 일반 잼.
  assert.equal(findMatches(board).length, 0, '사전 조건: 손으로 심은 뒤에도 매치가 없어야 한다');
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.ok(transform, '대상이 1개라도 있으면 specialTransform 이펙트가 있어야 한다');
  assert.equal(transform.kind, SPECIAL_KIND.BOMB);
  assert.equal(transform.cells.length, 1, '있는 만큼(1개)만 변환돼야 한다');
  assert.deepEqual(
    transform.cells.map((c) => ({ row: c.row, col: c.col })),
    [{ row: 5, col: 5 }]
  );

  const bombActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOMB);
  assert.equal(bombActivations.length, 1, '변환된 1개가 발동해야 한다');

  assert.equal(state.resolutions.length, 0);
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

test('박스+컬러 조합: 선택한 색의 일반 잼이 0개면 변환도 0개, 추가 랜덤 삭제도 0개로 깔끔하게 끝난다', () => {
  const board = freshMatchFreeBoard(403);
  board.set(0, 0, 5); // 박스 잼 자신의 색(sentinel) - 보드에서 이 칸 하나뿐(그마저 특수라 "일반 잼"이 아니다).
  board.setSpecial(0, 0, { kind: SPECIAL_KIND.BOX, direction: null });
  board.set(0, 1, COLORLESS);
  board.setSpecial(0, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  assert.equal(findMatches(board).length, 0, '사전 조건: 손으로 심은 뒤에도 매치가 없어야 한다');
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const effects = collectAllEffects(state);
  const transform = effects.find((e) => e.type === 'specialTransform');
  assert.equal(transform, undefined, '변환 대상이 0개면 specialTransform 이펙트가 없어야 한다');
  const boxActivations = effects.filter((e) => e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOX);
  assert.equal(boxActivations.length, 0, '변환 개수(0) x 2 = 0이므로 추가 랜덤 발동도 없어야 한다');
  const combo = effects.find((e) => e.type === 'comboActivate');
  assert.ok(combo, 'comboActivate 자체는 여전히 발생해야 한다');

  assert.equal(state.resolutions.length, 0, 'drain이 끝나 있어야 한다');
  assert.equal(findMatches(board).length, 0);
  assert.ok(!board.grid.includes(EMPTY));
});

// ============================================================
// 5. 무작위 반복 스트레스(박스 잼 포함)
// ============================================================

// seed마다 박스 경로(생성/발동/조합)를 탔는지 모아서, 전체 중 적어도 하나는 실제로 박스를
// 거쳤는지 마지막에 한 번 더 확인한다(그렇지 않으면 "박스가 한 번도 안 생겨서 아무것도 검증
// 못 하는 거짓 통과" 가능성이 생긴다).
const boxPathHits = [];

for (const seed of [11, 22, 33, 44, 55]) {
  test(`스트레스(seed=${seed}, 박스 포함): 무작위 dt + 무작위 인접 스왑을 반복해도 EMPTY 잔존/미해결 매치가 없다`, () => {
    // typeCount를 줄여 2x2(박스)가 더 자주 우연히 생기도록 한다(초기 보드는 2x2를 만들지 않지만,
    // 이후 스왑/낙하 과정에서는 생길 수 있다).
    const board = new Board({ rows: 6, cols: 6, typeCount: 3, seed });
    const state = new GameState({ board });
    const pick = createRng(seed * 17 + 3);

    const seenEffects = new Set();
    let boxCreated = 0;
    let boxActivatedOrCombo = 0;

    const iterations = 400;
    for (let i = 0; i < iterations; i++) {
      const r1 = Math.floor(pick() * board.rows);
      const c1 = Math.floor(pick() * board.cols);
      const horizontal = pick() < 0.5;
      const r2 = horizontal ? r1 : r1 + 1;
      const c2 = horizontal ? c1 + 1 : c1;
      if (board.inBounds(r2, c2)) {
        state.trySwap(r1, c1, r2, c2);
      }

      const dt = pick() * 0.05; // 0~50ms
      state.update(dt);

      for (const e of state.effects) {
        if (seenEffects.has(e)) continue;
        seenEffects.add(e);
        if (e.type === 'specialCreate' && e.kind === SPECIAL_KIND.BOX) boxCreated++;
        if (e.type === 'specialActivate' && e.kind === SPECIAL_KIND.BOX) boxActivatedOrCombo++;
        if (e.type === 'comboActivate' && typeof e.comboKind === 'string' && e.comboKind.startsWith('box_')) {
          boxActivatedOrCombo++;
        }
      }

      // 불변식: idle인 칸은 절대 EMPTY일 수 없다(기존 스트레스 테스트와 동일한 패턴).
      for (let idx = 0; idx < board.grid.length; idx++) {
        if (board.cellStates[idx] === null) {
          // 예외: 낙하 대기(settleWait) 중인 해소의 열은 빈 칸이 idle로 남는다(plan.md 4-2).
          if (!state.resolutions.some((r) => r.phase === 'settleWait' && r.settleCols.has(idx % board.cols))) {
            assert.notEqual(board.grid[idx], EMPTY, `seed=${seed}, i=${i}: idle인 칸(idx=${idx})이 EMPTY면 안 된다`);
          }
        }
      }
    }

    const ticks = drainAll(state, { dtSeconds: 1, maxTicks: 5000 });
    assert.ok(ticks < 5000, `seed=${seed}: 상한 안에 모든 해소가 끝나야 한다`);
    assert.equal(state.resolutions.length, 0);
    assert.ok(!board.grid.includes(EMPTY), `seed=${seed}: 모든 해소가 끝나면 EMPTY가 없어야 한다`);
    assert.equal(findMatches(board).length, 0, `seed=${seed}: 모든 해소가 끝나면 매치가 남아있으면 안 된다`);
    assert.ok(board.cellStates.every((cs) => cs === null), `seed=${seed}: 모든 애니메이션이 끝나면 전부 idle이어야 한다`);

    boxPathHits.push(boxCreated > 0 || boxActivatedOrCombo > 0);
  });
}

test('스트레스에 사용한 seed들 중 적어도 하나는 실제로 박스 잼 경로(생성/발동/조합)를 탔다', () => {
  assert.equal(boxPathHits.length, 5, '위 5개 seed 테스트가 먼저 실행되어 있어야 한다');
  assert.ok(boxPathHits.some(Boolean), '박스 잼이 한 번도 생성/발동되지 않아 이 스트레스 테스트가 박스 경로를 전혀 검증하지 못했다');
});
