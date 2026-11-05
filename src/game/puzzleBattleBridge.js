import { GEM_TYPES } from '../config/gems.js';

// 퍼즐(src/core)이 지우는 잼을 전투(src/battle)의 공격으로 옮긴다.
//
// core는 specialCreate/specialActivate/comboActivate/shuffle만 이벤트로 내보내고, 일반
// 매치 제거는 board.cellStates[i].phase가 'clearing'으로 바뀌는 것으로만 표시된다(전용
// 이벤트 없음). 그래서 "이번 틱에 새로 clearing이 시작된 칸"을 직접 찾아야 한다 - 이전
// 틱에 clearing이던 칸의 인덱스 집합을 기억해두고 차이를 본다(render의 Animator가 파티클
// 트리거에 쓰는 것과 같은 패턴이지만, 이 모듈은 그것과 독립적으로 자기 상태를 가진다).
//
// cascadeIndex(연쇄 단계)는 core가 cellStates에 직접 싣지 않지만, gameState.resolutions의
// 각 resolution이 phase='clearing'으로 바뀌는 순간 cascadeIndex가 이미 정확히 세팅돼
// 있고 그 resolution.watchCells가 바로 이번에 지워지는 칸 목록이다(여러 Resolution이
// 동시에 진행돼도 각자 독립적인 객체라 안전하다 - concurrent-resolution 테스트로 보장됨).
// 그래서 새로 clearing이 시작된 칸마다 그 칸을 watchCells에 들고 있는 resolution을 찾아
// cascadeIndex를 역추적한다.
//
// 주의: _prevClearingKeys는 "이 인스턴스가 계속 같은 GameState/board를 관찰한다"는
// 전제로 유효하다(지금 main.js는 GameState를 한 번만 만들고 재시작 경로가 없다). 나중에
// 퍼즐을 새 GameState로 재시작하면서 이 브리지 인스턴스를 재사용하는 기능이 생기면,
// 반드시 그 시점에 _prevClearingKeys를 비워야 한다(안 비우면 새 보드의 같은 인덱스가
// "이미 처리한 칸"으로 오판돼 공격이 누락될 수 있다) - 간단히 새 PuzzleBattleBridge를
// 만들어 교체하거나 reset() 메서드를 추가해서 처리할 것.
export class PuzzleBattleBridge {
  // onGemClear({ color, count, cascadeIndex, row, col })는 applyGemClear와 같은 그룹마다
  // 한 번씩, 그 그룹이 지워진 칸들의 중심 위치(row/col, 소수 가능)와 함께 호출된다 - 렌더가
  // "퍼즐에서 잼이 터진 위치 -> 같은 색 탑"으로 빛이 날아가는 연출을 만들 때 쓴다. 이
  // 브리지 자체는 화면 좌표를 전혀 모른다(row/col은 보드 칸 좌표일 뿐).
  constructor(battleState, { onGemClear } = {}) {
    this.battleState = battleState;
    this.onGemClear = onGemClear;
    this._prevClearingKeys = new Set();
  }

  // 층이 바뀌면(클리어/재시도/dev 층 이동) BattleController가 새 BattleState를 만든다 - 이
  // 브리지가 계속 이전 전투 객체에 쏘지 않도록 참조만 갈아 끼운다(_prevClearingKeys는
  // 보드 칸 좌표 기준이라 층이 바뀌어도 그대로 둬도 안전 - 클래스 헤더 주석 참고).
  setTarget(battleState) {
    this.battleState = battleState;
  }

  // 퍼즐 보드(GameState) 자체가 새로 만들어졌을 때(층 전환) 호출한다 - 클래스 헤더 주석에서
  // 예고한 대로, _prevClearingKeys(보드 칸 인덱스 기준 기억)를 비워 새 보드의 같은 인덱스를
  // "이미 처리한 칸"으로 오판하지 않게 한다. battleState 타겟은 건드리지 않는다(setTarget과
  // 독립적인 관심사 - main.js가 필요하면 둘 다 부른다).
  reset() {
    this._prevClearingKeys = new Set();
  }

  update(gameState) {
    const { board, resolutions, effects } = gameState;
    const { cellStates, cols } = board;

    // 시한폭탄 타이머 만료 - gameState가 durationMs:1로 한 번만 보여주는 1회성 이펙트라
    // elapsedMs===0인(이번 틱에 막 생긴) 항목만 처리하면 중복 없이 정확히 한 번 반영된다
    // (comboChange/hint 등 다른 1회성 이펙트와 같은 소비 패턴).
    for (const effect of effects) {
      if (effect.type === 'obstacleExpire' && effect.elapsedMs === 0) {
        this.battleState.applyObstacleWallDamage(effect.wallDamagePct);
      }
    }

    const currentKeys = new Set();
    // resolution.id -> { cascadeIndex, colors: Map<colorIndex, {count, rowSum, colSum}> }
    const groups = new Map();

    for (let i = 0; i < cellStates.length; i++) {
      const cs = cellStates[i];
      if (!cs || cs.phase !== 'clearing') continue;
      currentKeys.add(i);
      if (this._prevClearingKeys.has(i)) continue; // 이미 지난 틱에 처리한 칸.

      const value = cs.value;
      if (value < 0) continue; // EMPTY(-1)/COLORLESS(-2) - 색이 없다.

      const row = Math.floor(i / cols);
      const col = i % cols;
      const resolution = resolutions.find(
        (r) => r.phase === 'clearing' && r.watchCells.some((cell) => cell.row === row && cell.col === col)
      );
      if (!resolution) continue; // 방어적 - 이론상 항상 찾아져야 한다.

      let group = groups.get(resolution.id);
      if (!group) {
        group = { cascadeIndex: resolution.cascadeIndex, colors: new Map() };
        groups.set(resolution.id, group);
      }
      let entry = group.colors.get(value);
      if (!entry) {
        entry = { count: 0, rowSum: 0, colSum: 0 };
        group.colors.set(value, entry);
      }
      entry.count += 1;
      entry.rowSum += row;
      entry.colSum += col;
    }

    this._prevClearingKeys = currentKeys;

    for (const { cascadeIndex, colors } of groups.values()) {
      for (const [colorIndex, { count, rowSum, colSum }] of colors) {
        const colorId = GEM_TYPES[colorIndex]?.id;
        if (!colorId) continue;
        this.battleState.applyGemClear(colorId, count, cascadeIndex);
        this.onGemClear?.({
          color: colorId,
          count,
          cascadeIndex,
          row: rowSum / count,
          col: colSum / count,
        });
      }
    }
  }
}
