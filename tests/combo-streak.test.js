// 콤보(연속 스트릭) 검증 - 특수 잼끼리의 "조합"(COMBO_KIND)과는 다른 개념(§B). trySwap이
// Resolution을 만드는 모든 성공 스왑에서 comboStreak가 오르고 타이머가 리셋되며, 보드/Resolution이
// 모두 idle일 때만 타이머가 줄어든다. 0이 되면 comboBreak + 리셋.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.js';
import { GameState, getComboTier } from '../src/core/gameState.js';
import { COMBO_CONFIG } from '../src/config/combo.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
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

test('매치 스왑 성공 시 comboStreak가 오르고 comboStreakTimerMs가 리셋되고 comboChange 이펙트가 push된다', () => {
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  const board = boardFromGrid(3, 3, grid, 7);
  const state = new GameState({ board });
  assert.equal(state.comboStreak, 0);

  const accepted = state.trySwap(0, 2, 1, 2); // row0이 [0,0,0]이 되는 매치.
  assert.equal(accepted, true);

  // 증가/리셋은 Resolution이 끝나길 기다리지 않고 trySwap 안에서 즉시 일어난다.
  assert.equal(state.comboStreak, 1);
  assert.equal(state.comboStreakTimerMs, COMBO_CONFIG.timerMs);

  const changeEffects = state.effects.filter((e) => e.type === 'comboChange');
  assert.equal(changeEffects.length, 1, 'comboChange 이펙트가 정확히 1개 push돼야 한다');
  assert.equal(changeEffects[0].comboStreak, 1);
  assert.equal(changeEffects[0].remainingMs, COMBO_CONFIG.timerMs);
});

test('독립된 두 열에서 연속으로 유효 스왑하면 comboStreak가 즉시 2까지 오른다(드레인 불필요)', () => {
  // tests/concurrent-resolution.test.js의 "독립 진행" 배치 재사용: 두 매치가 서로 다른 열이라
  // 첫 Resolution이 끝나길 기다리지 않고 바로 두 번째 스왑을 넣을 수 있다.
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

  assert.equal(state.trySwap(0, 2, 1, 2), true);
  assert.equal(state.comboStreak, 1);
  assert.equal(state.trySwap(3, 5, 4, 5), true);
  assert.equal(state.comboStreak, 2);
  assert.equal(state.comboStreakTimerMs, COMBO_CONFIG.timerMs);

  drainAll(state, { maxTicks: 500 });
  assert.equal(state.resolutions.length, 0);
});

test('보드/Resolution이 idle일 때만 타이머가 줄고, 0이 되면 comboBreak 이펙트 + comboStreak 리셋', () => {
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  const board = boardFromGrid(3, 3, grid, 7);
  const state = new GameState({ board });

  assert.equal(state.trySwap(0, 2, 1, 2), true);
  assert.equal(state.comboStreak, 1);

  // 연출(armed/clearing/falling/spawning 칸이 있거나 resolutions가 있을 때) 중에는 타이머가
  // 전혀 줄지 않는다 - 완전히 드레인될 때까지 반복해도 비지니스 체크 때문에 그대로다.
  drainAll(state, { maxTicks: 500 });
  assert.equal(state.resolutions.length, 0, '드레인이 끝나 있어야 한다');
  assert.ok(board.cellStates.every((cs) => cs === null));
  assert.equal(state.comboStreak, 1, '연출 중에는 콤보가 끊기지 않아야 한다');
  assert.equal(
    state.comboStreakTimerMs,
    COMBO_CONFIG.timerMs,
    '드레인 내내 보드/Resolution이 busy였으므로 타이머는 전혀 줄지 않아야 한다'
  );

  // 이제 완전히 idle이다 - dt만큼 정확히 줄어드는지, 0이 되면 끊기는지 확인한다.
  const dtStep = 0.5; // 500ms
  const totalSteps = COMBO_CONFIG.timerMs / 1000 / dtStep; // 정확히 나눠지는 값으로 고름.
  for (let i = 1; i < totalSteps; i++) {
    state.update(dtStep);
    assert.equal(state.comboStreak, 1, `tick ${i}: 아직 타이머가 0이 되지 않았으면 콤보가 유지돼야 한다`);
    assert.equal(state.comboStreakTimerMs, COMBO_CONFIG.timerMs - dtStep * 1000 * i);
  }

  assert.equal(state.effects.some((e) => e.type === 'comboBreak'), false, '아직 타이머가 0이 되기 전이다');
  state.update(dtStep); // 정확히 0이 되는 마지막 틱.
  assert.equal(state.comboStreak, 0, '타이머가 0이 되면 콤보가 리셋돼야 한다');
  assert.equal(state.comboStreakTimerMs, 0);
  const breakEffects = state.effects.filter((e) => e.type === 'comboBreak');
  assert.equal(breakEffects.length, 1, 'comboBreak 이펙트가 1개 push돼야 한다');
  assert.equal(breakEffects[0].comboStreak, 1, '끊기기 직전의 스트릭 값을 담아야 한다');
});

test('무효(매치 없는) 스왑은 기본 설정(breakOnNonMatchSwap:false)에서 콤보를 끊지 않는다', () => {
  assert.equal(COMBO_CONFIG.breakOnNonMatchSwap, false, '사전 조건: 기본 설정 확인');

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

  assert.equal(state.trySwap(0, 2, 1, 2), true);
  assert.equal(state.comboStreak, 1);
  drainAll(state, { maxTicks: 500 });
  assert.equal(state.resolutions.length, 0);

  // (0,4)<->(0,5): cols3-5는 A가 전혀 건드리지 않은 영역이라 여전히 원래 값대로다. 2,3,4의
  // 자리를 바꿔도(row0 cols3,4,5 = 2,3,4 -> 2,4,3) 어떤 방향으로도 3연속이 생기지 않는다.
  const before = state.comboStreak;
  const accepted = state.trySwap(0, 4, 0, 5);
  assert.equal(accepted, true, '무효 스왑도 "처리는 됐다"는 의미로 true를 반환해야 한다');
  assert.equal(state.resolutions.length, 0, '무효 스왑은 Resolution을 만들지 않는다');
  assert.equal(state.comboStreak, before, '무효 스왑이 콤보를 끊으면 안 된다(기본 설정)');
  assert.equal(state.effects.some((e) => e.type === 'comboBreak'), false);
});

test('getComboTier가 tiers 경계값에서 올바른 tier를 반환한다', () => {
  assert.equal(getComboTier(0), null);
  assert.equal(getComboTier(4), null, '5 미만은 어떤 tier도 아니다');
  assert.equal(getComboTier(5).min, 5);
  assert.equal(getComboTier(9).min, 5, '다음 tier(10) 전까지는 그대로');
  assert.equal(getComboTier(10).min, 10);
  assert.equal(getComboTier(19).min, 10);
  assert.equal(getComboTier(20).min, 20);
  assert.equal(getComboTier(29).min, 20);
  assert.equal(getComboTier(30).min, 30);
  assert.equal(getComboTier(1000).min, 30, '최고 tier를 넘어서도 최고 tier를 유지한다');
});
