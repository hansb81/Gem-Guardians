// 퍼즐(src/core)이 지우는 잼을 전투 공격으로 옮기는 PuzzleBattleBridge 테스트.
// battleState는 applyGemClear 호출만 기록하는 스텁으로 대체하고, 실제 Board/GameState로
// 격자를 직접 짜서 매치/연쇄를 만든다 (tests/gameState.test.js의 boardFromGrid 패턴 참고).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, EMPTY, COLORLESS } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { SPECIAL_KIND } from '../src/core/specials.js';
import { GEM_TYPES } from '../src/config/gems.js';
import { PuzzleBattleBridge } from '../src/game/puzzleBattleBridge.js';

function boardFromGrid(rows, cols, values, seed = 1) {
  const board = new Board({ rows, cols, typeCount: 5, seed });
  board.grid = values.slice();
  board.specials = new Array(rows * cols).fill(null);
  board.cellStates = new Array(rows * cols).fill(null);
  return board;
}

// applyGemClear 호출만 기록하는 스텁. 이 모듈은 battleState.status를 보지 않으므로
// status 필드는 아무 값이나 둔다.
function makeFakeBattleState() {
  return {
    status: 'active',
    calls: [],
    skills: [], // 특수 잼 기술 발동(count 0 + specialType) - 기본 사격 calls와 따로 기록.
    applyGemClear(color, count, cascadeIndex, isSpecial, specialType, chosenColor) {
      if (specialType) this.skills.push({ color, count, specialType, chosenColor: chosenColor ?? null });
      else this.calls.push({ color, count, cascadeIndex });
    },
  };
}

// resolutions와 cellStates가 모두 idle로 돌아올 때까지 state.update(dt)와 bridge.update(state)를
// 같이 반복 호출한다(concurrent-resolution.test.js의 drainAll 패턴 + bridge 연동).
function drainWithBridge(state, bridge, { dtSeconds = 0.02, maxTicks = 2000 } = {}) {
  const { board } = state;
  const stillAnimating = () => state.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null);
  let ticks = 0;
  while (stillAnimating() && ticks < maxTicks) {
    state.update(dtSeconds);
    bridge.update(state);
    ticks++;
  }
  assert.ok(ticks < maxTicks, '상한 안에 해소가 끝나야 한다');
  return ticks;
}

test('평범한 3매치가 제거되면 그 색/개수/cascadeIndex=1로 applyGemClear가 정확히 한 번 호출된다', () => {
  // (0,2)<->(1,2) 스왑하면 row0이 [0,0,0]이 되어 매치가 생긴다(gameState.test.js와 동일한 격자).
  // 색0(인덱스0)=GEM_TYPES[0].id='red', 3칸 매치, 특수 잼은 생기지 않는다(3개 일자).
  const grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  const board = boardFromGrid(3, 3, grid, 7);
  assert.equal(findMatches(board).length, 0, '사전 조건: 매치가 없어야 한다');

  const state = new GameState({ board });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);

  const accepted = state.trySwap(0, 2, 1, 2);
  assert.equal(accepted, true);

  drainWithBridge(state, bridge);

  assert.equal(fake.calls.length, 1, '같은 매치가 여러 틱에 걸쳐 지워지는 동안 중복 호출되면 안 된다');
  assert.deepEqual(fake.calls[0], { color: GEM_TYPES[0].id, count: 3, cascadeIndex: 1 });
});

test('연쇄(cascade)가 2단계 이상 이어지면 두 번째 단계의 cascadeIndex가 2 이상이다', () => {
  // 3열x5행 격자. (2,2)<->(3,2) 세로 스왑으로 row2가 [0,0,0](색0) 가로 3매치가 되어
  // 1단계로 지워진다. 지워진 뒤 중력으로 내려오면 col1에 기존에 있던 색1(X) 3칸이 세로로
  // 모여 2단계 매치를 만든다(새로 리필되는 칸은 이 매치에 섞이지 않도록 설계).
  const grid = [
    2, 3, 4, // row0
    3, 1, 3, // row1
    0, 0, 2, // row2 (스왑 전: col2=2, col0/col1=0)
    4, 1, 0, // row3 (스왑 전: col2=0 -> 스왑으로 row2,col2와 교체)
    2, 1, 4, // row4
  ];
  const board = boardFromGrid(5, 3, grid, 7);
  assert.equal(findMatches(board).length, 0, '사전 조건: 매치가 없어야 한다');

  const state = new GameState({ board });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);

  const accepted = state.trySwap(2, 2, 3, 2);
  assert.equal(accepted, true);

  drainWithBridge(state, bridge);

  const stage1 = fake.calls.filter((c) => c.cascadeIndex === 1);
  const stage2 = fake.calls.filter((c) => c.cascadeIndex >= 2);
  assert.equal(stage1.length, 1, '1단계는 정확히 한 번만 호출돼야 한다');
  assert.deepEqual(stage1[0], { color: GEM_TYPES[0].id, count: 3, cascadeIndex: 1 });
  assert.equal(stage2.length, 1, '2단계는 정확히 한 번만 호출돼야 한다(중복 없음)');
  assert.deepEqual(stage2[0], { color: GEM_TYPES[1].id, count: 3, cascadeIndex: 2 });
});

test('컬러 잼(COLORLESS) 자신은 집계되지 않지만, 같이 지워지는 같은 색 일반 잼들은 정상 집계된다', () => {
  // specials.test.js의 "컬러 잼이 일반 잼과 스왑되면..." 시나리오를 그대로 재사용한다(사전
  // 검증된 격자). 색3(인덱스3)이 보드에 4칸 있고, 컬러 잼(1,1)과 (1,2, 색3)을 스왑하면
  // 색3 4칸 + 컬러 잼 자신(COLORLESS) 1칸 = 5칸이 지워지지만, 다리는 COLORLESS 칸을 세면
  // 안 되므로 count는 4여야 한다.
  const grid = [0, 1, 2, 3, 1, 2, 3, 0, 2, 3, 0, 1, 3, 0, 1, 2];
  const board = boardFromGrid(4, 4, grid, 7);
  board.set(1, 1, COLORLESS);
  board.setSpecial(1, 1, { kind: SPECIAL_KIND.COLOR, direction: null });
  assert.equal(findMatches(board).length, 0, '사전 조건: 매치가 없어야 한다');

  const state = new GameState({ board });
  const fake = makeFakeBattleState();
  const bridge = new PuzzleBattleBridge(fake);

  const accepted = state.trySwap(1, 1, 1, 2); // (1,2) 색은 3.
  assert.equal(accepted, true);

  drainWithBridge(state, bridge);

  assert.equal(fake.calls.length, 1, '중복 호출 없이 한 번만 집계돼야 한다');
  assert.deepEqual(fake.calls[0], { color: GEM_TYPES[3].id, count: 4, cascadeIndex: 1 });
  // 무지개 발동 = 궁극기 1번, 고른 색 = 스왑한 잼의 색.
  assert.deepEqual(fake.skills, [{ color: GEM_TYPES[3].id, count: 0, specialType: 'color', chosenColor: GEM_TYPES[3].id }]);
  assert.ok(!board.grid.includes(EMPTY));
});

test('reset()은 _prevClearingKeys를 비운다(층 전환으로 보드가 새로 만들어졌을 때 쓴다)', () => {
  const bridge = new PuzzleBattleBridge(makeFakeBattleState());
  bridge._prevClearingKeys.add(7);
  bridge.reset();
  assert.equal(bridge._prevClearingKeys.size, 0);
});
