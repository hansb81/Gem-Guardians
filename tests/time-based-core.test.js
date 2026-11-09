// 시간 기반(update(dt)) + 열 단위 동시 진행 아키텍처의 스모크 테스트.
// 기존 tests/gameState.test.js 등은 "trySwap이 이벤트 배열을 반환한다"는 옛 API를
// 전제로 하므로 이 변경으로 깨지는 게 당연하다(일부러 고치지 않는다 - rule-tester가
// 나중에 새 API 기준으로 다시 쓴다). 여기서는 새 API(trySwap의 bool 반환,
// board.cellStates/isColumnLocked, gameState.resolutions/effects, update(dt))만
// 검증하는 최소 스모크 테스트를 둔다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
}

// update(dt)를 충분히 반복해서 돌리는 헬퍼. dt(ms 단위 밀리초 아님, 초 단위 - GameState.update
// 는 dt를 초로 받아 내부에서 *1000 한다)가 모든 전환 duration(최대 360ms)보다 크게 잡아서
// 매 틱 최소 한 단계씩은 전진하도록 한다. 그래도 무한 루프를 막기 위해 maxTicks로 상한을 둔다.
function runUntilIdle(state, { dtSeconds = 1, maxTicks = 100 } = {}) {
  const { board } = state;
  // resolutions.length===0만으로는 "다 끝났다"고 볼 수 없다 - 무효 스왑의 들썩 애니메이션은
  // Resolution 없이 board.cellStates만으로 진행되므로, 그것까지 다 idle로 돌아왔는지 같이 봐야 한다.
  const stillAnimating = () => state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null);
  let ticks = 0;
  while (stillAnimating() && ticks < maxTicks) {
    state.update(dtSeconds);
    ticks++;
  }
  return ticks;
}

test('유효 스왑 후 update(dt)를 반복하면 resolutions가 비고 grid에 EMPTY가 남지 않는다', () => {
  // (0,2)<->(1,2) 스왑하면 row0이 [0,0,0]이 되어 매치가 생긴다.
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  const board = boardFromGrid(3, 3, grid, 7);
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 2, 1, 2);
  assert.equal(accepted, true, '매치가 생기는 스왑은 수락되어야 한다');
  assert.equal(state.resolutions.length, 1, '유효 스왑은 Resolution을 하나 만들어야 한다');

  const ticks = runUntilIdle(state);
  assert.ok(ticks < 100, '상한 안에 해소가 끝나야 한다');
  assert.equal(state.resolutions.length, 0, '다 끝나면 resolutions가 비어야 한다');
  assert.ok(!board.grid.includes(EMPTY), '해소가 끝나면 EMPTY가 남아있으면 안 된다');
  assert.equal(findMatches(board).length, 0, '해소가 끝나면 매치가 남아있으면 안 된다');
  assert.ok(board.cellStates.every((cs) => cs === null), '다 끝나면 모든 칸이 idle(null)이어야 한다');
  assert.ok(state.score > 0, '점수가 올라야 한다');
  assert.ok(state.cascadeCount >= 1, '연쇄 횟수가 기록돼야 한다');
});

test('매치가 생기지 않는 스왑은 Resolution을 만들지 않고, 들썩이다 idle로 돌아간다', () => {
  // 3x3 라틴 사각형: 어떤 두 인접 칸을 바꿔도 3매치가 나오지 않는다.
  const grid = [0, 1, 2, 1, 2, 0, 2, 0, 1];
  const board = boardFromGrid(3, 3, grid);
  const original = board.grid.slice();
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true, '무효 스왑도 "처리는 됐다"는 의미로 true를 반환한다(Resolution은 안 만듦)');
  assert.equal(state.resolutions.length, 0, '무효 스왑은 Resolution을 만들지 않는다');
  assert.deepEqual(board.grid, original, '보드가 즉시 원래 상태로 되돌아가야 한다');
  assert.notEqual(board.cellStates[board.index(0, 0)], null, '들썩 애니메이션이 걸려 있어야 한다');

  // 들썩 애니메이션이 끝날 만큼 충분히 틱을 돌린다.
  state.update(1);
  state.update(1);

  assert.equal(board.cellStates[board.index(0, 0)], null, '들썩이 끝나면 idle로 돌아가야 한다');
  assert.equal(board.cellStates[board.index(0, 1)], null);
  assert.equal(state.score, 0);
});

test('잠긴 열(board.cellStates가 채워진 열)로의 trySwap은 조용히 무시된다', () => {
  const board = new Board({ rows: 6, cols: 6, typeCount: 5, seed: 11 });
  const original = board.grid.slice();
  const state = new GameState({ board });

  // col=2를 인위적으로 잠긴 것처럼 만든다(어떤 칸이든 cellStates!==null이면 그 열 전체가 잠김).
  board.cellStates[board.index(3, 2)] = {
    phase: 'falling',
    elapsedMs: 0,
    durationMs: 999,
    value: board.get(3, 2),
    special: null,
    fromRow: 3,
    fromCol: 2,
  };
  assert.equal(board.isColumnLocked(2), true);

  const accepted = state.trySwap(0, 1, 0, 2); // col 1<->2, col2가 잠겨있다.
  assert.equal(accepted, false, '잠긴 열을 건드리는 스왑은 거부돼야 한다');
  assert.equal(state.resolutions.length, 0);
  assert.deepEqual(board.grid, original, '보드가 전혀 바뀌면 안 된다');

  // 잠긴 칸 자체는 그대로 유지된다(우리가 인위적으로 걸어둔 것이므로 건드려지지 않아야 한다).
  assert.notEqual(board.cellStates[board.index(3, 2)], null);
});

test('서로 다른 두 열에서 거의 동시에 일어난 유효 스왑 두 개는 독립적으로 각자 끝까지 해소된다', () => {
  // 손으로 검증한 매치 없는(match-free) 6x6 기본 배치 + 서로 겹치지 않는 두 쌍의 스왑.
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
  const acceptedB = state.trySwap(3, 5, 4, 5);
  assert.equal(acceptedA, true);
  assert.equal(acceptedB, true);
  assert.equal(state.resolutions.length, 2, '두 유효 스왑이 각각 독립된 Resolution이어야 한다');

  const idA = state.resolutions[0].id;
  const idB = state.resolutions[1].id;
  assert.notEqual(idA, idB);

  // 한쪤 몇 틱만 돌려서(스왑 애니메이션 정도) 다른 쪽이 아직 안 끝났어도 한쪽만 끝날 수 있는지는
  // 굳이 확인하지 않는다(둘 다 duration이 비슷해 거의 동시에 끝난다) - 핵심은 "결국 둘 다
  // 독립적으로 끝까지 해소된다"는 것이다.
  const ticks = runUntilIdle(state, { maxTicks: 200 });
  assert.ok(ticks < 200, '상한 안에 둘 다 끝나야 한다');
  assert.equal(state.resolutions.length, 0, '둘 다 끝나면 resolutions가 비어야 한다');
  assert.ok(!board.grid.includes(EMPTY), 'EMPTY가 남아있으면 안 된다');
  assert.equal(findMatches(board).length, 0, '매치가 남아있으면 안 된다');
  assert.ok(board.cellStates.every((cs) => cs === null), '모든 칸이 idle로 돌아가야 한다');
});

test('스트레스: 결정론적 무작위 trySwap + 무작위 update(dt)를 반복해도 EMPTY 잔존/중복 매치가 없다', () => {
  const board = new Board({ rows: 6, cols: 6, seed: 321 });
  const state = new GameState({ board });

  // 간단한 선형congruential 스타일 난수(테스트 전용, core의 board.rng와는 별개 - 이 테스트의
  // "무작위 스왑/dt 선택"에만 쓰이므로 Math.random 금지 규칙과 무관하다).
  let seed = 12345;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let i = 0; i < 500; i++) {
    const r1 = Math.floor(nextRandom() * board.rows);
    const c1 = Math.floor(nextRandom() * board.cols);
    const horizontal = nextRandom() < 0.5;
    const r2 = horizontal ? r1 : r1 + 1;
    const c2 = horizontal ? c1 + 1 : c1;
    if (board.inBounds(r2, c2)) {
      state.trySwap(r1, c1, r2, c2);
    }

    // dt는 짧게(일부 틱은 애니메이션 도중에 머물도록) 무작위로 섞는다.
    const dt = nextRandom() * 0.05; // 0~50ms
    state.update(dt);

    // 불변식: 지금 EMPTY인 칸은 전부 cellStates가 falling/spawning 애니메이션 중이어야 한다
    // (clearing 중인 칸은 아직 보드값이 EMPTY로 커밋돼 있을 수 있으므로 EMPTY 허용, 다만
    // cellStates는 반드시 null이 아니어야 한다 - idle인데 EMPTY인 칸은 절대 없어야 한다).
    for (let idx = 0; idx < board.grid.length; idx++) {
      // 예외: 낙하 대기(settleWait) 중인 해소의 열은 빈 칸이 idle로 남는다(plan.md 4-2).
      const waiting = state.resolutions.some((r) => r.phase === 'settleWait' && r.settleCols.has(idx % board.cols));
      if (board.grid[idx] === EMPTY && !waiting) {
        assert.notEqual(board.cellStates[idx], null, `i=${i}: EMPTY인 칸(idx=${idx})은 idle이면 안 된다`);
      }
    }
  }

  // 남은 애니메이션을 전부 끝까지 흘려보낸다(resolutions뿐 아니라 무효 스왑 들썩까지).
  runUntilIdle(state, { dtSeconds: 1, maxTicks: 2000 });
  assert.ok(!board.grid.includes(EMPTY), '모든 해소가 끝나면 EMPTY가 없어야 한다');
  assert.equal(findMatches(board).length, 0, '모든 해소가 끝나면 매치가 남아있으면 안 된다');
  assert.ok(board.cellStates.every((cs) => cs === null), '모든 애니메이션이 끝나면 전부 idle이어야 한다');
  assert.equal(state.resolutions.length, 0);
});
