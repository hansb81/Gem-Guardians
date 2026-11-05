// 힌트(§C, plan.md §16) 검증. 입력 없이 HINT_CONFIG.idleMs 이상 지나면(연쇄 진행 중이 아닐 때만
// 유휴로 센다) 가능한 수 하나를 가리키고, trySwap을 호출하면(성공/실패 무관) 즉시 사라지고
// 유휴 타이머가 0부터 다시 시작한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { HINT_CONFIG } from '../src/config/hint.js';

// predicate를 만족하는 effects 항목을(객체 참조 기준 중복 없이) 틱마다 수집한다 - hint 이펙트는
// durationMs:1(ms)짜리 "1틱 알림"이라 매 update(dt) 호출 직후 바로 확인해야 놓치지 않는다
// (gameState.js의 _advanceEffects가 같은 tick 안에서 바로 늙혀 지운다).
function tickAndCollect(state, ticks, dtSeconds, predicate) {
  const seen = new Set();
  const found = [];
  for (let i = 0; i < ticks; i++) {
    state.update(dtSeconds);
    for (const e of state.effects) {
      if (!seen.has(e) && predicate(e)) {
        seen.add(e);
        found.push(e);
      }
    }
  }
  return found;
}

test('입력 없이 HINT_CONFIG.idleMs 이상 지나면 hintCell이 채워지고 hint 이펙트가 1회만 push된다', () => {
  // 새로 생성되는 보드는 항상 가능한 수가 1개 이상 있다(규칙 1) - findAnyValidMove가 반드시
  // 뭔가를 찾는다.
  const board = new Board({ rows: 6, cols: 6, seed: 123 });
  const state = new GameState({ board });
  assert.equal(state.hintCell, null);

  const dtStep = 0.5; // 500ms
  const beforeThreshold = Math.floor((HINT_CONFIG.idleMs - 1) / 1000 / dtStep); // 아직 모자란 만큼(엄격히 미달).
  for (let i = 0; i < beforeThreshold; i++) {
    state.update(dtStep);
    assert.equal(state.hintCell, null, `tick ${i}: 아직 idleMs가 지나지 않았으면 힌트가 없어야 한다`);
  }

  // 그 뒤로도 넉넉히 더 틱을 돌려서(힌트가 1번만 뜨는지 확인하기 위해) hint 이펙트를 수집한다.
  const hintEffects = tickAndCollect(state, 20, dtStep, (e) => e.type === 'hint');
  assert.ok(hintEffects.length >= 1, 'idleMs를 넘기면 hint 이펙트가 떠야 한다');
  assert.equal(hintEffects.length, 1, '다시 리셋되지 않는 한 hint 이펙트는 1회만 push돼야 한다');
  assert.notEqual(state.hintCell, null, 'hintCell이 채워져 있어야 한다');
  assert.equal(typeof state.hintCell.row, 'number');
  assert.equal(typeof state.hintCell.col, 'number');
});

test('trySwap 호출 시(성공/실패 무관) hintCell이 즉시 null로 돌아가고 유휴 타이머가 0부터 다시 시작한다', () => {
  const board = new Board({ rows: 6, cols: 6, seed: 123 });
  const state = new GameState({ board });

  const dtStep = 0.5;
  const steps = Math.ceil(HINT_CONFIG.idleMs / 1000 / dtStep) + 2;
  for (let i = 0; i < steps; i++) state.update(dtStep);
  assert.notEqual(state.hintCell, null, '사전 조건: 힌트가 뜬 상태여야 한다');

  // 명백히 인접하지 않은(그래서 바로 거부되는) 요청도 "실패"로 처리되지만, trySwap 최상단에서
  // 성공/실패와 무관하게 힌트를 리셋한다.
  const accepted = state.trySwap(0, 0, 5, 5);
  assert.equal(accepted, false);
  assert.equal(state.hintCell, null, 'trySwap 호출 즉시 hintCell이 null이어야 한다(실패한 호출이어도)');

  // 유휴 타이머가 0부터 다시 시작하므로, idleMs보다 적게 지나면 아직 힌트가 없어야 한다.
  const lessThanThreshold = Math.floor((HINT_CONFIG.idleMs - 1) / 1000 / dtStep);
  for (let i = 0; i < lessThanThreshold; i++) {
    state.update(dtStep);
    assert.equal(state.hintCell, null, `tick ${i}: 타이머가 다시 시작했으므로 아직 힌트가 없어야 한다`);
  }

  // 다시 충분히 지나면(= _hintShown도 함께 리셋됐다는 뜻) 힌트가 다시 뜬다.
  for (let i = 0; i < 5; i++) state.update(dtStep);
  assert.notEqual(state.hintCell, null, '타이머가 다시 idleMs를 넘기면 힌트가 다시 떠야 한다');
});

test('연쇄(resolutions가 있는 동안)는 유휴 시간으로 세지 않는다', () => {
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  const board = new Board({ rows: 3, cols: 3, typeCount: 5, seed: 7 });
  board.grid = grid.slice();
  board.specials = new Array(9).fill(null);
  board.cellStates = new Array(9).fill(null);
  const state = new GameState({ board });

  const accepted = state.trySwap(0, 2, 1, 2); // row0이 [0,0,0]이 되는 매치.
  assert.equal(accepted, true);
  assert.equal(state.resolutions.length, 1);

  let guard = 0;
  while (state.resolutions.length > 0 && guard < 10000) {
    state.update(0.01);
    assert.equal(state._inputIdleMs, 0, '연쇄가 진행 중인 동안에는 idle 시간이 쌓이면 안 된다');
    assert.equal(state.hintCell, null);
    guard++;
  }
  assert.ok(guard < 10000, '상한 안에 해소가 끝나야 한다');

  // 연쇄가 끝난 뒤부터는 정상적으로 idle 시간이 쌓인다.
  state.update(1); // 1000ms
  assert.equal(state._inputIdleMs, 1000, '연쇄가 끝난 뒤에는 dt만큼 idle 시간이 쌓여야 한다');
});
