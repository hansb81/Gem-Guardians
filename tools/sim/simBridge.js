// src/game/puzzleBattleBridge.js와 같은 역할(퍼즐 clearing 칸 -> 탑 사격)이지만 두 가지가
// 다르다: (1) 렌더가 없으므로 투사체 비행을 기다리지 않고 applyGemClear 직후 바로
// resolveTowerAttack을 불러 피해를 즉시 확정한다(docs/simulation.md "애니메이션 대기는
// secondsPerMove에 포함된 것으로 본다"). (2) T2 모디파이어의 trigger:'special'을 판정하려면
// "이 칸이 특수 잼 발동 범위에 들어서 지워졌는지"가 필요한데, GameState의 clearing cellState는
// 그 정보를 들고 있지 않다(cause는 armed 단계에만 있다가 commit 시 사라짐) - 그래서
// specialActivate/comboActivate 이펙트의 affected 칸 목록을 별도 Set에 태깅해두고, 그 칸이
// 실제로 clearing으로 바뀌는 순간(수백ms~2초 뒤, maxDetonationMs 한도 내) 소비한다.
import { GEM_TYPES } from '../../src/config/gems.js';
import { PuzzleBattleBridge } from '../../src/game/puzzleBattleBridge.js';

const keyOf = (row, col) => `${row},${col}`;

export class SimBridge {
  // onShot(event): 측정 전용(floorSim shotFlight) - 주면 즉시 명중 대신 그 함수에 탄을 넘긴다(비행 시간 근사).
  constructor(battleState, onShot = null) {
    this.battleState = battleState;
    this.onShot = onShot;
    // 특수 잼 발동 -> 전투 기술(docs/skills.md 2장)은 게임 브리지의 판정을 그대로 쓴다(어떤 잼이
    // 기술을 쏘는지 - 변환 잼 제외, 조합 규칙 - 를 여기서 다시 짜지 않기 위해).
    this._caster = new PuzzleBattleBridge(battleState);
    this._prevClearingKeys = new Set();
    this._specialTagged = new Set();
    this.stats = {
      colorCounts: Object.fromEntries(GEM_TYPES.map((g) => [g.id, 0])),
      specialsCreated: 0,
      maxCascadeIndex: 0,
      cascadeSamples: [], // 스왑마다 "이 Resolution이 도달한 최대 cascadeIndex" 기록(평균 연쇄용).
      bombsDefused: 0,
      bombsExpired: 0,
      totalCellsCleared: 0,
      swapGroupCount: 0, // 색상 그룹 수(스왑당 평균 발사 수 추정용).
    };
    this._resolutionPeakCascade = new Map();
  }

  setTarget(battleState) {
    this.battleState = battleState;
    this._caster.setTarget(battleState);
  }

  update(gameState) {
    const { board, resolutions, effects } = gameState;
    const { cellStates, cols } = board;

    for (const effect of effects) {
      if (effect.elapsedMs !== 0) continue;
      if (effect.type === 'obstacleExpire') {
        this.battleState.applyObstacleWallDamage(effect.wallDamagePct);
        this.stats.bombsExpired++;
      } else if (effect.type === 'specialCreate') {
        this.stats.specialsCreated++;
      } else if (effect.type === 'specialActivate' || effect.type === 'comboActivate') {
        for (const cell of effect.affected) this._specialTagged.add(keyOf(cell.row, cell.col));
        if (effect.type === 'specialActivate') this._caster._castSpecialActivate(effect);
        else this._caster._castCombo(effect);
      } else if (effect.type === 'obstacleDestroyed' && effect.id === 'timeBomb' && effect.cause === 'gemCleared') {
        this.stats.bombsDefused++;
      }
    }

    const currentKeys = new Set();
    const groups = new Map(); // resolutionId -> { cascadeIndex, colors: Map<colorIndex, {count, special}> }

    for (let i = 0; i < cellStates.length; i++) {
      const cs = cellStates[i];
      if (!cs || cs.phase !== 'clearing') continue;
      currentKeys.add(i);
      if (this._prevClearingKeys.has(i)) continue;

      const row = Math.floor(i / cols);
      const col = i % cols;
      const key = keyOf(row, col);
      const isSpecial = this._specialTagged.has(key);
      this._specialTagged.delete(key);

      const value = cs.value;
      if (value < 0) continue; // EMPTY/COLORLESS - 색이 없다.

      const resolution = resolutions.find(
        (r) => r.phase === 'clearing' && r.watchCells.some((cell) => cell.row === row && cell.col === col)
      );
      if (!resolution) continue;

      const prevPeak = this._resolutionPeakCascade.get(resolution.id) ?? 0;
      this._resolutionPeakCascade.set(resolution.id, Math.max(prevPeak, resolution.cascadeIndex));

      let group = groups.get(resolution.id);
      if (!group) {
        group = { cascadeIndex: resolution.cascadeIndex, colors: new Map() };
        groups.set(resolution.id, group);
      }
      let entry = group.colors.get(value);
      if (!entry) {
        entry = { count: 0, special: false };
        group.colors.set(value, entry);
      }
      entry.count += 1;
      entry.special = entry.special || isSpecial;
    }

    this._prevClearingKeys = currentKeys;

    // gameState.update()는 done인 Resolution을 그 틱이 끝나기 전에 이미 resolutions 배열에서
    // 빼버린다 - 그래서 "done 플래그"가 아니라 "이번 틱엔 더 이상 보이지 않는 id"로 완료를
    // 감지한다(평균 연쇄 깊이 샘플용).
    const activeIds = new Set(resolutions.map((r) => r.id));
    for (const [id, peak] of this._resolutionPeakCascade) {
      if (!activeIds.has(id)) {
        this.stats.cascadeSamples.push(peak);
        this._resolutionPeakCascade.delete(id);
      }
    }

    for (const { cascadeIndex, colors } of groups.values()) {
      this.stats.maxCascadeIndex = Math.max(this.stats.maxCascadeIndex, cascadeIndex);
      for (const [colorIndex, { count, special }] of colors) {
        const colorId = GEM_TYPES[colorIndex]?.id;
        if (!colorId) continue;
        this.stats.totalCellsCleared += count;
        this.stats.colorCounts[colorId] = (this.stats.colorCounts[colorId] ?? 0) + count;
        this.stats.swapGroupCount++;
        const event = this.battleState.applyGemClear(colorId, count, cascadeIndex, special);
        if (event) {
          if (this.onShot) this.onShot(event);
          else this.battleState.resolveTowerAttack(event);
        }
      }
    }
  }
}
