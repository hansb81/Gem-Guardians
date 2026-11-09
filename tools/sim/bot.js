// 봇 플레이어 - 가능한 스왑을 전부 찾고, 보드 복사본(clone)에서 실제로 GameState를 끝까지
// 돌려(findMatches/specials/gravity 등 src/core 규칙 그대로) 지워지는 잼 수(연쇄 포함)를 센다.
// 점수 = 지운 잼 + 특수 잼 생성 보너스 + (bombAware면) 시한폭탄 해제 보너스 + 성벽에 가까운
// 적이 있으면 그 색 탑 우선(보고: "그 색"은 적마다 색 약점이 없는 게임이라 "지금 가장 센(레벨
// 높은) 탑의 색"으로 해석했다 - docs/battle.md에 명시가 없어 임의로 정한 값, 확인 필요).
import { Board } from '../../src/core/board.js';
import { GameState } from '../../src/core/gameState.js';
import { findMatches } from '../../src/core/match.js';
import { resolveSpecialCombo, SPECIAL_KIND } from '../../src/core/specials.js';
import { isSwappable } from '../../src/core/obstacles/obstacles.js';
import { createRng } from '../../src/core/rng.js';

export const WEIGHTS = { special: 5, bomb: 10, danger: 3 };
export const DANGER_PROGRESS = 0.75;

function wouldMatch(board, r1, c1, r2, c2) {
  const grid = board.grid.slice();
  const i1 = board.index(r1, c1);
  const i2 = board.index(r2, c2);
  const tmp = grid[i1];
  grid[i1] = grid[i2];
  grid[i2] = tmp;
  return findMatches({ grid, rows: board.rows, cols: board.cols }).length > 0;
}

// trySwap()의 분기와 같은 기준: 컬러/박스 잼이 낀 스왑이나 특수 잼 조합은 매치 여부와
// 무관하게 항상 Resolution을 만든다(gameState.js _resolveComboStep 등 참고). 그 외(평범한
// 잼 또는 라인/폭탄+평범한 잼)는 실제로 매치가 생겨야 한다.
function isProductiveSwap(board, r1, c1, r2, c2) {
  const specialA = board.getSpecial(r1, c1);
  const specialB = board.getSpecial(r2, c2);
  if (specialA && specialB) return resolveSpecialCombo(specialA, specialB) != null;
  if (specialA?.kind === SPECIAL_KIND.COLOR && !specialB) return true;
  if (specialB?.kind === SPECIAL_KIND.COLOR && !specialA) return true;
  if (specialA?.kind === SPECIAL_KIND.BOX && !specialB) return true;
  if (specialB?.kind === SPECIAL_KIND.BOX && !specialA) return true;
  return wouldMatch(board, r1, c1, r2, c2);
}

export function findCandidateMoves(gameState) {
  const { board } = gameState;
  const registry = gameState.obstaclesRegistry;
  const out = [];

  const usable = (r, c) => {
    if (!board.isCellStable(r, c)) return false;
    if (registry && !isSwappable(board, registry, r, c)) return false;
    return true;
  };

  for (let r = 0; r < board.rows; r++) {
    for (let c = 0; c < board.cols; c++) {
      if (!usable(r, c)) continue;
      if (c + 1 < board.cols && usable(r, c + 1)) {
        if (isProductiveSwap(board, r, c, r, c + 1)) out.push({ r1: r, c1: c, r2: r, c2: c + 1 });
      }
      if (r + 1 < board.rows && usable(r + 1, c)) {
        if (isProductiveSwap(board, r, c, r + 1, c)) out.push({ r1: r, c1: c, r2: r + 1, c2: c });
      }
    }
  }
  return out;
}

// 실제 gameState.board를 건드리지 않는 평가용 복제본. floorObstacles는 null로 둬서(docs
// 참고) 평가 중 새 방해요소가 등장하는 부수효과를 만들지 않는다 - 점수 계산과 무관한 효과다.
function cloneForProbe(gameState, obstaclesConfig, probeSeed) {
  const real = gameState.board;
  const board = new Board({ rows: real.rows, cols: real.cols, typeCount: real.typeCount, rng: createRng(probeSeed) });
  board.grid = real.grid.slice();
  board.specials = real.specials.map((s) => (s ? { ...s } : null));
  board.occupants = real.occupants.map((o) => (o ? { ...o } : null));
  board.attachments = real.attachments.map((a) => (a ? { ...a } : null));
  return new GameState({ board, obstaclesConfig: obstaclesConfig ?? undefined, floorObstacles: null });
}

const PROBE_DT_SEC = 5; // 어떤 애니메이션 단계든 한 번의 update()로 넘길 만큼 큰 값(§A4 참고).
const PROBE_MAX_ITERS = 60; // 연쇄가 60단계를 넘는 일은 없다 - 안전판.

function scoreCandidate(gameState, obstaclesConfig, move, probeSeed, dangerColor, bombAware) {
  const clone = cloneForProbe(gameState, obstaclesConfig, probeSeed);
  clone.trySwap(move.r1, move.c1, move.r2, move.c2);
  if (clone.resolutions.length === 0) return null; // 방어적 - isProductiveSwap이 보장하므로 실제로는 안 걸림.

  let cellsCleared = 0;
  let specialsCreated = 0;
  let bombsDefused = 0;
  const colorCounts = {};
  let prevClearingKeys = new Set();

  for (let i = 0; i < PROBE_MAX_ITERS && clone.resolutions.length > 0; i++) {
    clone.update(PROBE_DT_SEC);
    const { board } = clone;
    const currentKeys = new Set();
    for (let idx = 0; idx < board.cellStates.length; idx++) {
      const cs = board.cellStates[idx];
      if (!cs || cs.phase !== 'clearing') continue;
      currentKeys.add(idx);
      if (prevClearingKeys.has(idx)) continue;
      cellsCleared++;
      if (cs.value >= 0) colorCounts[cs.value] = (colorCounts[cs.value] ?? 0) + 1;
    }
    prevClearingKeys = currentKeys;
    for (const effect of clone.effects) {
      if (effect.elapsedMs !== 0) continue;
      if (effect.type === 'specialCreate') specialsCreated++;
      else if (effect.type === 'obstacleDestroyed' && effect.id === 'timeBomb' && effect.cause === 'gemCleared') bombsDefused++;
    }
  }

  const dangerColorCleared = dangerColor != null ? colorCounts[dangerColor] ?? 0 : 0;
  const bombScore = bombAware ? bombsDefused * WEIGHTS.bomb : 0;
  const score = cellsCleared + specialsCreated * WEIGHTS.special + bombScore + dangerColorCleared * WEIGHTS.danger;
  return { move, score };
}

// pick: 'best'(최고 점수) / 'top3'(상위 3개 중 rng로 하나) / 'random'(채점 없이 전부 중 하나).
// bombAware=false면 시한폭탄 해제는 점수에 들어가지 않는다(가중치를 주지 않을 뿐 - obstacles.json
// 자체 규칙은 항상 그대로 적용된다).
export function chooseMove(gameState, { obstaclesConfig, pick, bombAware, rng, dangerColor, probeSeedBase }) {
  const candidates = findCandidateMoves(gameState);
  if (candidates.length === 0) return null;

  if (pick === 'random') {
    return candidates[Math.floor(rng() * candidates.length)];
  }

  const scored = candidates
    .map((move, idx) =>
      scoreCandidate(gameState, obstaclesConfig, move, probeSeedBase + idx + 1, dangerColor, bombAware)
    )
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return candidates[Math.floor(rng() * candidates.length)];
  if (pick === 'best') return scored[0].move;

  const top = scored.slice(0, 3);
  return top[Math.floor(rng() * top.length)].move;
}
