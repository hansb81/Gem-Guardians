// "순차 폭발 타이밍"(armed cellState phase) 검증. docs/plan.md 자체에는 타이밍 수치가 없지만,
// src/config/detonation.js(DETONATION_CONFIG)와 src/core/gameState.js의 _armCell/_advanceArmedCells/
// _runSelfEffect/_delaysForKind가 구현한 규칙(거리·등장순서 기반 armedMs, 체인 캐치 +chainArmMs,
// 변환은 체인 없이 transformStepMs, 2초 상한 스케일)을 기준으로 삼는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, EMPTY } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { createRng } from '../src/core/rng.js';
import {
  manhattanDistance,
  chebyshevDistance,
  computeDistanceDelays,
  computeSequentialDelays,
  bombComboCells,
} from '../src/core/specials.js';
import { DETONATION_CONFIG } from '../src/config/detonation.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
}

// board.cellStates는 전환마다(armed -> chain gap -> clearing 등) 새 객체로 교체되므로, 객체
// 참조 기준으로 "처음 본 순간"을 기록하면 각 칸의 전체 전환 이력을 시간순으로 모을 수 있다.
// (주의: GameState.effects에 쌓이는 cellArmed/cellDetonate/comboChange/comboBreak/hint류는
// durationMs:1(ms)짜리 "1틱 알림"이라, update(dt)가 이들을 push하는 _advanceArmedCells/
// _armCell 호출 "같은 tick" 안에서 _advanceEffects(dtMs)가 곧바로 같은 dtMs만큼 늙혀서
// 지워버린다(_advanceEffects가 _advanceArmedCells/resolutions 처리 뒤에 호출되므로) - 즉 dt가
// 1ms 이상이면(현실적인 모든 프레임 dt) update() 호출이 끝난 뒤 바깥에서는 그 틱에 막 생긴
// cellArmed/cellDetonate를 effects 배열에서 볼 수 없다. 그래서 이 파일의 타이밍 검증은
// board.cellStates(진짜 지속되는 상태)를 직접 폴링하는 방식을 쓴다.)
function collectCellStateTransitions(state, { dtSeconds = 0.005, maxTicks = 20000 } = {}) {
  const { board } = state;
  const seen = new Set();
  const found = [];
  let elapsedMs = 0;
  const stillAnimating = () => state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null);
  let ticks = 0;
  while (stillAnimating() && ticks < maxTicks) {
    state.update(dtSeconds);
    elapsedMs += dtSeconds * 1000;
    for (let idx = 0; idx < board.cellStates.length; idx++) {
      const cs = board.cellStates[idx];
      if (!cs || seen.has(cs)) continue;
      seen.add(cs);
      found.push({
        cell: { row: Math.floor(idx / board.cols), col: idx % board.cols },
        phase: cs.phase,
        cause: cs.cause,
        durationMs: cs.durationMs,
        atMs: elapsedMs,
      });
    }
    ticks++;
  }
  assert.ok(ticks < maxTicks, '상한 안에 모든 애니메이션이 끝나야 한다');
  return found;
}

// 수명이 긴 1회성 연출(specialActivate/specialTransform/comboActivate 등, durationMs가 수백ms
// 단위라 pruning 문제가 없다)을 위한 범용 effects 수집기. cellArmed/cellDetonate 같은
// durationMs:1(ms)짜리 "1틱 알림"에는 쓰면 안 된다(위 설명 참고 - collectCellStateTransitions를 써라).
function collectEffectsWithTiming(state, predicate, { dtSeconds = 0.005, maxTicks = 20000 } = {}) {
  const { board } = state;
  const seen = new Set();
  const found = [];
  let elapsedMs = 0;
  const stillAnimating = () =>
    state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null) || state.effects.length > 0;
  let ticks = 0;
  while (stillAnimating() && ticks < maxTicks) {
    state.update(dtSeconds);
    elapsedMs += dtSeconds * 1000;
    for (const e of state.effects) {
      if (!seen.has(e) && predicate(e)) {
        seen.add(e);
        found.push({ effect: e, atMs: elapsedMs });
      }
    }
    ticks++;
  }
  assert.ok(ticks < maxTicks, '상한 안에 모든 애니메이션이 끝나야 한다');
  return found;
}

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
// 1) 거리 순 발동 시간
// ============================================================

test('라인 잼 발동: 영향 범위의 각 칸이 origin으로부터의 거리 * lineStepMs만큼 armedMs를 받는다', () => {
  // 기존 "매치에 낀 기존 특수 잼" 테스트(tests/gameState.test.js)와 같은 패턴: row2에 가로
  // 라인 잼(가로 방향 -> 자기 행 전체 삭제)을 심어두고, (row+1,2)의 칸을 끌어올려 (row,0),
  // (row,1), (row,3) 3칸(col2는 다른 색)짜리 매치를 만들어 그 라인 잼을 연쇄 발동시킨다(§A3의
  // "체인"). 매치 자체에 낀 (row,0)/(row,3)은 즉시 커밋되므로, 라인 잼의 "자기 행 전체 삭제"
  // 효과가 실제로 거리 기반으로 새로 캐치하는 칸은 매치 범위 밖인 cols 4,5,6,7뿐이다.
  const board = new Board({ rows: 8, cols: 8, typeCount: 5, seed: 42 });
  const row = 2;
  board.set(row, 0, 0);
  board.set(row, 1, 0);
  board.set(row, 2, 3);
  board.set(row, 3, 0);
  board.setSpecial(row, 1, { kind: 'line', direction: 'horizontal' });
  board.set(row + 1, 2, 0);
  const state = new GameState({ board });

  const accepted = state.trySwap(row, 2, row + 1, 2);
  assert.equal(accepted, true);

  const transitions = collectCellStateTransitions(state);
  const origin = { row, col: 1 };

  const armedLine = transitions.filter((t) => t.phase === 'armed' && t.cause === 'line' && t.cell.row === row);
  const byCol = new Map(armedLine.map((t) => [t.cell.col, t.durationMs]));

  // cols 0,1,3은 "플레이어 스왑이 만든 매치 자체"에 낀 칸들이라 armedMs=0으로 곧장 커밋되고
  // (col1은 매치 캐치 -> chainArmMs 체인을 거쳐 자기 효과를 낸다), 이미 그 시점에 clearing으로
  // 점유돼 있어서 나중에(chainArmMs 뒤) 도는 라인 자기 효과 루프가 닿았을 때는 "이미 점유된
  // 칸"으로 조용히 건너뛰어진다(§A4) - 그래서 이 칸들은 cause='line'인 armed 전환이 없다.
  // 매치와 무관하게 "라인 효과가 거리로 캐치한" 칸은 cols 4,5,6,7뿐이고, origin에서의
  // 거리(맨해튼) * lineStepMs와 정확히 같아야 한다(2초 상한에 걸리지 않는 작은 값들).
  for (const col of [4, 5, 6, 7]) {
    const expected = manhattanDistance({ row, col }, origin) * DETONATION_CONFIG.lineStepMs;
    assert.equal(byCol.get(col), expected, `col=${col}의 armedMs는 거리 * lineStepMs여야 한다`);
  }
  assert.equal(byCol.has(0), false, '매치로 이미 커밋된 칸은 라인 효과의 armed 루프에 다시 걸리지 않는다');
  assert.equal(byCol.has(3), false);
  assert.equal(byCol.has(2), false, '새로 생성된 라인 잼의 생성 칸(row,2)은 보호되어 효과에 끼면 안 된다');
  assert.equal(byCol.has(1), false, '효과를 낸 라인 잼 자기 자신은 이 루프로 다시 armed되지 않는다');

  // 가까운 칸이 먼 칸보다 먼저 clearing으로 전환되는지(그 칸의 'clearing' 전환 시각 순서로 확인).
  const detonateOrder = transitions
    .filter((t) => t.phase === 'clearing' && t.cell.row === row && [4, 5, 6, 7].includes(t.cell.col))
    .sort((a, b) => a.atMs - b.atMs)
    .map((t) => t.cell.col);
  assert.deepEqual(detonateOrder, [4, 5, 6, 7], '거리가 짧은 칸부터 순서대로 clearing으로 전환돼야 한다');

  drainAll(state);
  assert.equal(state.resolutions.length, 0);
  assert.ok(!board.grid.includes(EMPTY));
  assert.equal(findMatches(board).length, 0);
});

test('폭탄+폭탄 조합 발동: 영향 범위의 각 칸이 기준 칸으로부터의 체비셰프 거리 * bombStepMs만큼 armedMs를 받는다', () => {
  const rows = 6;
  const cols = 6;
  const grid = Array.from({ length: rows * cols }, (_, i) => i % 5);
  const board = boardFromGrid(rows, cols, grid, 22);
  board.setSpecial(2, 2, { kind: 'bomb', direction: null });
  board.setSpecial(2, 3, { kind: 'bomb', direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(2, 2, 2, 3);
  assert.equal(accepted, true);

  const ref = { row: 2, col: 3 }; // 플레이어가 옮긴 도착 칸.
  const comboCells = bombComboCells(board, { row: 2, col: 2 }, { row: 2, col: 3 }, ref);
  assert.equal(comboCells.length, 16, '사전 조건: 4x4 범위여야 한다');

  const transitions = collectCellStateTransitions(state);
  const armedBomb = transitions.filter((t) => t.phase === 'armed' && t.cause === 'bomb');
  assert.ok(armedBomb.length > 0, '거리가 0보다 큰 칸은 적어도 하나는 armed 단계를 거쳐야 한다');

  for (const t of armedBomb) {
    const expected = chebyshevDistance(t.cell, ref) * DETONATION_CONFIG.bombStepMs;
    assert.equal(t.durationMs, expected, `(${t.cell.row},${t.cell.col})의 armedMs는 체비셰프 거리 * bombStepMs여야 한다`);
  }

  // comboCells 안에서 거리가 다른 두 칸을 직접 골라(모호함 없이) 가까운 칸이 먼저 clearing되는지 확인.
  const nearCell = { row: 1, col: 3 }; // chebyshev(= max(1,0)) = 1
  const farCell = { row: 1, col: 1 }; // chebyshev(= max(1,2)) = 2
  assert.equal(chebyshevDistance(nearCell, ref), 1);
  assert.equal(chebyshevDistance(farCell, ref), 2);

  const clearing = transitions.filter((t) => t.phase === 'clearing');
  const near = clearing.find((t) => t.cell.row === nearCell.row && t.cell.col === nearCell.col);
  const far = clearing.find((t) => t.cell.row === farCell.row && t.cell.col === farCell.col);
  assert.ok(near && far, '거리1, 거리2 칸의 clearing 전환을 모두 찾아야 한다');
  assert.ok(near.atMs < far.atMs, '거리가 가까운 칸이 먼 칸보다 먼저 clearing으로 전환돼야 한다');

  drainAll(state);
  assert.equal(state.resolutions.length, 0);
  assert.ok(!board.grid.includes(EMPTY));
  assert.equal(findMatches(board).length, 0);
});

// ============================================================
// 2) 특수 잼 armed 후 발동: 캐치된 뒤 즉시 발동하지 않고 chainArmMs만큼 더 기다린다.
// ============================================================

test('체인으로 캐치된 특수 잼은 캐치 지연이 끝난 뒤 즉시 발동하지 않고, chainArmMs만큼 더 지난 뒤에 자기 효과가 시작된다', () => {
  // row2에 가로 라인 잼(자기 행 전체 삭제)을 두고, 그 행(col5)에 아직 발동 안 한 폭탄 잼을
  // 하나 더 심어둔다. 라인 잼이 매치로 캐치 -> chainArmMs 뒤 자기 효과(row 전체) 발동 ->
  // 그 효과가 (row,5)의 폭탄을 "캐치"(거리 비례 armedMs) -> 그 캐치가 끝난 뒤 다시
  // chainArmMs를 기다려야 폭탄 자신의 효과(specialActivate kind=bomb)가 시작돼야 한다.
  const board = new Board({ rows: 8, cols: 8, typeCount: 5, seed: 42 });
  const row = 2;
  board.set(row, 0, 0);
  board.set(row, 1, 0);
  board.set(row, 2, 3);
  board.set(row, 3, 0);
  board.setSpecial(row, 1, { kind: 'line', direction: 'horizontal' });
  board.set(row + 1, 2, 0);
  board.set(row, 5, 2);
  board.setSpecial(row, 5, { kind: 'bomb', direction: null });
  assert.equal(findMatches(board).length, 0, '사전 조건: (row,5)를 바꿔도 다른 매치가 생기면 안 된다');

  const state = new GameState({ board });
  const accepted = state.trySwap(row, 2, row + 1, 2);
  assert.equal(accepted, true);

  const transitions = collectCellStateTransitions(state);
  const atCell5 = transitions.filter((t) => t.cell.row === row && t.cell.col === 5);

  const catchLine = atCell5.find((t) => t.phase === 'armed' && t.cause === 'line');
  assert.ok(catchLine, '폭탄 칸이 라인 효과에 캐치되는 armed(cause=line) 전환이 있어야 한다');
  const expectedCatchMs = manhattanDistance({ row, col: 5 }, { row, col: 1 }) * DETONATION_CONFIG.lineStepMs;
  assert.equal(catchLine.durationMs, expectedCatchMs);

  const chainGap = atCell5.find((t) => t.phase === 'armed' && t.cause === 'chain');
  assert.ok(chainGap, '캐치가 끝나면 즉시 발동하지 않고 chainArmMs짜리 armed(cause=chain) 전환이 걸려야 한다');
  assert.equal(chainGap.durationMs, DETONATION_CONFIG.chainArmMs);
  assert.ok(
    Math.abs(chainGap.atMs - (catchLine.atMs + expectedCatchMs)) < 10,
    '체인 갭은 캐치 지연이 끝나는 시점에 걸려야 한다'
  );

  // 폭탄 자신의 자기 효과(3x3)가 실제로 시작됐다는 증거: 이웃 칸 중 하나가 cause='bomb'로 armed된다.
  const neighborArmedBomb = transitions.find(
    (t) => t.phase === 'armed' && t.cause === 'bomb' && Math.abs(t.cell.row - row) <= 1 && Math.abs(t.cell.col - 5) <= 1
  );
  assert.ok(neighborArmedBomb, '체인 갭이 끝나면 폭탄 자신의 효과(이웃 칸 armed, cause=bomb)가 나타나야 한다');
  assert.ok(
    Math.abs(neighborArmedBomb.atMs - (chainGap.atMs + DETONATION_CONFIG.chainArmMs)) < 10,
    '폭탄 자기 효과는 캐치 + chainArmMs가 모두 지난 뒤에만 시작돼야 한다(즉시 발동 아님)'
  );
  // 즉시 발동이 아니라는 걸 직접 반증: 캐치가 끝난 시각 바로 다음(체인 갭 절반 지점)에는 아직
  // 자기 효과가 나타나지 않아야 한다.
  assert.ok(
    neighborArmedBomb.atMs > catchLine.atMs + expectedCatchMs + DETONATION_CONFIG.chainArmMs / 2,
    '폭탄 자기 효과가 캐치 직후 곧바로 나타나면 안 된다'
  );

  drainAll(state);
  assert.equal(state.resolutions.length, 0);
  assert.ok(!board.grid.includes(EMPTY));
  assert.equal(findMatches(board).length, 0);
});

// ============================================================
// 3) 변환 순서: 변환 대상은 등장 순서 * transformStepMs 간격으로 변환되고, 변환이 끝나면
//    체인의 +chainArmMs 없이 거의 곧바로 자기 효과가 시작된다.
// ============================================================

test('라인+컬러 조합: 변환된 칸들이 transformStepMs 간격으로 순서대로 발동하고, 추가 200ms 캐치 지연이 없다', () => {
  const rows = 6;
  const cols = 6;
  const grid = new Array(rows * cols).fill(1);
  const idx = (r, c) => r * cols + c;
  grid[idx(0, 0)] = 2; // 라인 잼의 원래 색.
  grid[idx(3, 3)] = 2;
  grid[idx(4, 4)] = 2;
  grid[idx(5, 5)] = 2;
  const board = boardFromGrid(rows, cols, grid, 25);
  board.setSpecial(0, 0, { kind: 'line', direction: 'horizontal' });
  board.set(0, 1, -2); // COLORLESS
  board.setSpecial(0, 1, { kind: 'color', direction: null });
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 0, 0, 1);
  assert.equal(accepted, true);

  const allEvents = collectEffectsWithTiming(state, () => true);
  const lineActivations = allEvents
    .filter(({ effect }) => effect.type === 'specialActivate' && effect.kind === 'line')
    .sort((a, b) => a.atMs - b.atMs);
  assert.equal(lineActivations.length, 3, '변환된 3칸이 모두 발동해야 한다');

  const t0 = lineActivations[0].atMs;
  const offsets = lineActivations.map((e) => e.atMs - t0);
  // 등장 순서대로 transformStepMs(40ms) 간격 - 체인의 chainArmMs(200ms)가 끼면 간격이 훨씬
  // 커지므로, 200ms보다 훨씬 작은 허용치로 "추가 캐치 지연이 없음"을 직접 반증한다.
  assert.ok(Math.abs(offsets[1] - DETONATION_CONFIG.transformStepMs) < 15, `offsets[1]=${offsets[1]}`);
  assert.ok(Math.abs(offsets[2] - DETONATION_CONFIG.transformStepMs * 2) < 15, `offsets[2]=${offsets[2]}`);
  assert.ok(offsets[2] < DETONATION_CONFIG.chainArmMs, '변환-발동 사이에 chainArmMs만큼의 추가 지연이 있으면 안 된다');

  drainAll(state);
  assert.equal(state.resolutions.length, 0);
  assert.ok(!board.grid.includes(EMPTY));
  assert.equal(findMatches(board).length, 0);
});

// ============================================================
// 4) 2초 상한 압축: computeDistanceDelays/computeSequentialDelays 자체를 단위 테스트한다
//    (plan에서 "제일 확실하고 쉬움"이라고 명시한 방식).
// ============================================================

test('computeDistanceDelays: 상한을 넘지 않으면 거리 * stepMs를 그대로(스케일 1) 반환한다', () => {
  const cells = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }];
  const origin = { row: 0, col: 0 };
  const delays = computeDistanceDelays(cells, origin, 40, 2000, manhattanDistance);
  assert.deepEqual(delays, [0, 40, 80]);
});

test('computeDistanceDelays: 가장 큰 지연이 상한을 넘으면 그 값이 정확히 상한이 되도록 비율로 축소된다', () => {
  const cells = Array.from({ length: 101 }, (_, i) => ({ row: 0, col: i })); // 거리 0..100
  const origin = { row: 0, col: 0 };
  const stepMs = 40; // 최대 raw = 100 * 40 = 4000 > 2000
  const cap = 2000;
  const delays = computeDistanceDelays(cells, origin, stepMs, cap, manhattanDistance);
  assert.equal(delays[100], cap, '가장 먼 칸의 armedMs는 정확히 상한과 같아야 한다');
  assert.equal(delays[0], 0);
  assert.ok(delays.every((d) => d <= cap), '어떤 지연도 상한을 넘으면 안 된다');
  // 비율이 유지된 선형 스케일인지 확인(중간 지점 = 중간 비율).
  const scale = cap / (100 * stepMs);
  assert.ok(Math.abs(delays[50] - 50 * stepMs * scale) < 1e-9);
});

test('computeSequentialDelays: 상한을 넘지 않으면 등장 순서 * stepMs, 넘으면 비율로 축소된다', () => {
  assert.deepEqual(computeSequentialDelays(3, 150, 2000), [0, 150, 300]);

  const many = computeSequentialDelays(20, 150, 2000); // 최대 raw = 19 * 150 = 2850 > 2000
  assert.equal(many[0], 0);
  assert.equal(many[19], 2000, '가장 늦은 항목의 지연은 정확히 상한과 같아야 한다');
  const scale = 2000 / (19 * 150);
  assert.ok(Math.abs(many[10] - 10 * 150 * scale) < 1e-9);
});

// ============================================================
// 5) armed 중 열 잠금 + 다른 열 스왑: armed 상태인 칸의 열은 잠기고, 무관한 다른 열의 스왑은
//    그동안에도 정상적으로 받아들여져 독립된 Resolution으로 동시에 진행된다.
// ============================================================

test('armed 상태인 칸의 열은 isColumnLocked가 true이고, 그동안에도 다른 열의 스왑은 정상적으로 받아들여진다', () => {
  // "독립 진행" 테스트(tests/concurrent-resolution.test.js)와 같은 겹치지 않는 두 매치 배치를
  // 재사용한다. SwapA의 매치 칸 중 하나(0,1)에 폭탄 잼을 심어 그 자기 효과(3x3, rows -1..1 ->
  // 0..1, cols 0..2)가 armed로 머무는 동안 cols 0-2만 잠기고, SwapB가 쓰는 cols 3-5는 전혀
  // 영향받지 않아야 한다.
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
  board.setSpecial(0, 1, { kind: 'bomb', direction: null });
  const state = new GameState({ board });

  const acceptedA = state.trySwap(0, 2, 1, 2); // row0 cols0-2 매치(0,1,2) - (0,1)의 폭탄이 체인 발동한다.
  assert.equal(acceptedA, true);
  assert.equal(state.resolutions.length, 1);

  // 폭탄의 자기 효과(3x3)가 armed 단계에 들어선 순간을 찾는다(cause='bomb'인 armed 칸이 생길 때).
  let foundArmed = false;
  let guard = 0;
  while (!foundArmed && guard < 5000) {
    state.update(0.005);
    guard++;
    for (let r = 0; r <= 1; r++) {
      for (let c = 0; c <= 2; c++) {
        const cs = board.cellStates[board.index(r, c)];
        if (cs && cs.phase === 'armed' && cs.cause === 'bomb') {
          foundArmed = true;
        }
      }
    }
  }
  assert.ok(foundArmed, '상한 안에 폭탄 자기 효과의 armed 칸을 찾아야 한다');

  assert.equal(board.isColumnLocked(0), true, 'armed 칸이 있는 열은 잠겨야 한다');
  assert.equal(board.isColumnLocked(1), true);
  assert.equal(board.isColumnLocked(2), true);
  for (const col of [3, 4, 5]) {
    assert.equal(board.isColumnLocked(col), false, `col=${col}은 무관하므로 잠기면 안 된다`);
  }

  const acceptedB = state.trySwap(3, 5, 4, 5); // row3 cols3-5 매치, A와 완전히 무관.
  assert.equal(acceptedB, true, 'A가 armed 상태로 진행 중이어도 전혀 다른 열의 B는 수락돼야 한다');
  assert.equal(state.resolutions.length, 2, 'A, B가 독립된 Resolution 두 개로 동시에 존재해야 한다');

  drainAll(state, { maxTicks: 2000 });
  assert.equal(state.resolutions.length, 0);
  assert.ok(!board.grid.includes(EMPTY));
  assert.equal(findMatches(board).length, 0);
  assert.ok(board.cellStates.every((cs) => cs === null));
});

// ============================================================
// 6) 무작위 스왑 + 무작위 dt 반복에서 보드와 화면(cellStates) 일치(BUG-001/002 회귀).
// ============================================================

for (const seed of [4004, 5005]) {
  test(`결정론적 퍼즈(seed=${seed}): armed 동안 board.get()이 원래 값과 일치하고, idle/armed/clearing과 EMPTY 여부가 항상 맞는다`, () => {
    const board = new Board({ rows: 6, cols: 6, seed });
    const state = new GameState({ board });
    const pick = createRng(seed * 17 + 3);

    const iterations = 1500;
    for (let i = 0; i < iterations; i++) {
      const r1 = Math.floor(pick() * board.rows);
      const c1 = Math.floor(pick() * board.cols);
      const horizontal = pick() < 0.5;
      const r2 = horizontal ? r1 : r1 + 1;
      const c2 = horizontal ? c1 + 1 : c1;
      if (board.inBounds(r2, c2)) {
        state.trySwap(r1, c1, r2, c2);
      }

      const dt = 0.001 + pick() * 0.049; // 1~50ms
      state.update(dt);

      for (let idx = 0; idx < board.grid.length; idx++) {
        const cs = board.cellStates[idx];
        if (cs === null) {
          assert.notEqual(board.grid[idx], EMPTY, `seed=${seed}, i=${i}: idle인 칸(idx=${idx})이 EMPTY면 안 된다`);
          continue;
        }
        if (cs.phase === 'armed') {
          // §A4 핵심 불변식: armed 동안은 아직 아무 것도 지워지지 않았다 - 보드 값이 cellState의
          // 스냅샷과 같아야 하고, 당연히 EMPTY도 아니어야 한다(BUG-001/002).
          assert.equal(
            board.grid[idx],
            cs.value,
            `seed=${seed}, i=${i}: armed인 칸(idx=${idx})의 board.get()은 아직 원래 값이어야 한다`
          );
          assert.notEqual(board.grid[idx], EMPTY, `seed=${seed}, i=${i}: armed인 칸(idx=${idx})이 EMPTY면 안 된다`);
        } else if (cs.phase === 'clearing') {
          assert.equal(
            board.grid[idx],
            EMPTY,
            `seed=${seed}, i=${i}: clearing인 칸(idx=${idx})은 커밋된 직후부터 EMPTY여야 한다`
          );
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
