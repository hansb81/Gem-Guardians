import { Board, EMPTY, COLORLESS } from './board.js';
import { findMatches } from './match.js';
import { hasAnyValidMove } from './moves.js';
import { findAnyValidMove } from './moves.js';
import { applyGravity, refill } from './gravity.js';
import {
  SPECIAL_KIND,
  COMBO_KIND,
  decideSpecialForGroup,
  pickSpawnCell,
  resolveSpecialCombo,
  computeEffect,
  cellsOfColor,
  lineLineComboCells,
  bombComboCells,
  lineBombComboCells,
  plainCellsOfColor,
  allCells,
  pickRandomIdleCells,
  pickRandomCellsOfColor,
  manhattanDistance,
  chebyshevDistance,
  computeDistanceDelays,
  computeSequentialDelays,
} from './specials.js';
import { SCORING_CONFIG } from '../config/scoring.js';
import { ANIMATION_DURATIONS_MS } from '../config/animation.js';
import { DETONATION_CONFIG } from '../config/detonation.js';
import { COMBO_CONFIG } from '../config/combo.js';
import { HINT_CONFIG } from '../config/hint.js';
import { createObstacleRegistry } from './obstacles/registry.js';
import {
  isSwappable,
  occupantIndices,
  removeLowestHpOccupant,
  damageOccupantsInCells,
  tickAttachmentTimers,
  placeInitialObstacles,
  maybeSpawnOnMove,
} from './obstacles/obstacles.js';

const keyOf = (cell) => `${cell.row},${cell.col}`;

// 조합 종류 -> cellArmed 이벤트의 cause로 쓸 대표 발동 종류("line"|"bomb"|"box"|"color").
// 분류 전용 - 로직은 여기 의존하지 않는다(렌더가 읽을 디버깅/연출용 힌트일 뿐).
function causeForComboKind(comboKind) {
  switch (comboKind) {
    case COMBO_KIND.LINE_LINE:
    case COMBO_KIND.LINE_BOMB:
      return 'line';
    case COMBO_KIND.BOMB_BOMB:
      return 'bomb';
    case COMBO_KIND.BOX_BOX:
      return 'box';
    case COMBO_KIND.COLOR_COLOR:
      return 'color';
    default:
      return 'combo';
  }
}

// comboStreak(연속 스트릭)에 해당하는 가장 높은 tier를 반환한다(없으면 null). 참고용 순수
// 헬퍼 - 아직 전투 쪽 어디서도 호출되지 않는다.
export function getComboTier(comboStreak, tiers = COMBO_CONFIG.tiers) {
  let best = null;
  for (const tier of tiers) {
    if (comboStreak >= tier.min && (!best || tier.min > best.min)) best = tier;
  }
  return best;
}

// ============================================================
// 시간 기반 + 열 단위 동시 진행 아키텍처.
//
// 과거에는 trySwap() 한 번이 매치/특수 잼/연쇄/낙하/리필을 전부 동기로 끝까지 계산해
// 이벤트 배열을 반환했다. 지금은 "플레이어 스왑 하나 = Resolution 하나"이고, 각
// Resolution은 board.cellStates(칸별 애니메이션 상태)를 통해 시간에 걸쳐 진행된다.
// 서로 다른 Resolution은 서로 다른 열을 쓰는 한 완전히 독립적으로 동시에 진행되고,
// 같은 열을 요구하는 순간 자동으로(별도 대기열 없이, 매 틱 재검사로) 잠긴다.
//
// 로직 자체(매치 판정, 특수 잼 생성/발동/조합 범위 계산, 점수 계산)는 기존 코드를 그대로
// 재사용한다 - "언제 그 계산을 실행해도 되는지"(필요한 열이 비어 있는지)와 "결과를 얼마나
// 걸려서 보여줄지"(에니메이션 진행도)만 시간에 걸쳐 나뉜다.
//
// GameState가 더 이상 이벤트 배열을 반환하지 않는다는 점이 render/input 쪽에 가장 큰 영향을
// 준다 - 대신 board.cellStates(칸별 전환)와 gameState.effects(1회성 연출: 빔/폭발/변환/
// 보드 플래시)를 매 프레임 읽어서 그린다.
//
// "순차 폭발 타이밍"(cellStates의 'armed' phase)
// --------------------------------------------------------------
// 특수 잼이 발동하면 영향 범위의 모든 칸이 한꺼번에 사라지지 않는다. 각 칸은 발동 종류(라인/
// 폭탄/박스/컬러/매치)에 따라 거리 또는 등장 순서로 결정된 armedMs를 배정받아 'armed'
// cellState(= 보드 값은 그대로, 곧 지워질 거라는 표시만)로 대기하다가, 그 시간이 지나야
// 실제로 EMPTY가 커밋되고 'clearing' 애니메이션이 시작된다(_armCell/_advanceArmedCells).
//
// armed 범위 안에 "아직 발동 안 한 다른 특수 잼"이 걸리면(체인), 그 칸은 자신이 배정받은
// armedMs로 먼저 armed된 뒤, 그 armed가 끝나는 시점 + DETONATION_CONFIG.chainArmMs(200ms)
// 후에야 "자기 자신의" 효과가 시작된다 - 그리고 그 효과의 범위(특히 박스의 랜덤 대상, 컬러의
// "가장 많은 색")는 그 실제 발동 시각의 보드 상태를 보고 그 순간(update()의
// _advanceArmedCells 패스)에 계산한다(_runSelfEffect) - 전부 t=0에 미리 계산해두지 않는다.
// 이 재귀는 Resolution마다 캐스케이드 단계 시작 시 새로 만드는 resolution.chainActivated
// Set으로 같은 특수 잼이 두 번 체인되지 않게 막는다.
//
// "직접" 발동(매치/스왑/조합으로 바로 트리거된 특수 잼 자신, 또는 colorSwap/boxSwap의 대상)은
// 이 캐스케이드 단계가 시작되는 시점(t=0, 아직 아무 것도 지워지지 않은 보드)에서 바로 효과
// 범위를 계산한다 - 그 시점의 보드 상태가 이미 정확하므로 지연할 필요가 없다. 변환 조합
// (LINE_COLOR 등)으로 "새로 생성"되는 특수 잼은 등장 순서 * transformStepMs 뒤에 "자기 효과
// 직행"으로 스케줄된다(체인의 +200ms 캐치 지연 없이 - 캐치된 게 아니라 막 만들어진 것이므로).
// ============================================================
export class GameState {
  // obstaclesConfig(config/obstacles.json 그대로)와 floorObstacles(floorGen.js가 만든
  // 이번 층의 { crate:{initial,everyMoves,maxAlive}, ... } 등장 수치)는 둘 다 선택이다 -
  // 없으면 방해요소 기능 전체가 비활성(this.obstaclesRegistry===null)이라 기존 동작과
  // 100% 동일하다(docs/balance.md 7장).
  constructor({ board, seed, obstaclesConfig, floorObstacles } = {}) {
    this.board = board ?? new Board({ seed });
    this.score = 0;

    this.obstaclesRegistry = obstaclesConfig ? createObstacleRegistry(obstaclesConfig) : null;
    this.floorObstacles = floorObstacles ?? null;
    this._obstacleSpawnCounters = {};
    this._obstacleReshuffleFailures = 0;
    if (this.obstaclesRegistry) {
      placeInitialObstacles(this.board, this.obstaclesRegistry, this.floorObstacles, this.board.rng);
    }

    // HUD용: "가장 최근에 수락된 스왑이 시작한 Resolution"의 cascadeIndex. 그 Resolution이
    // 끝나도 마지막 값을 유지하고, 다음 유효 스왑이 들어올 때만 0으로 리셋된다. 여러
    // Resolution이 동시에 돌 때 다른(더 최근이 아닌) Resolution이 이 값을 덮어쓰지 않도록
    // _latestResolutionId로 "진짜 최신"만 갱신을 허용한다.
    this.cascadeCount = 0;

    // 활성 Resolution 목록. 완료된 것은 update()가 매 틱 끝에서 제거한다.
    this.resolutions = [];

    // 렌더용 1회성 연출(specialActivate/comboActivate/specialCreate/specialTransform/shuffle/
    // cellArmed/cellDetonate/comboChange/comboBreak/hint). 각 항목: { type, ...원래 필드들,
    // elapsedMs, durationMs }. elapsedMs는 push 시점에 0으로 시작해서 update(dt)마다
    // dt*1000만큼 늘어나고, durationMs를 넘으면 배열에서 빠진다. "sequential" 체인(변환 ->
    // 연쇄 발동처럼 하나씩 순서대로 보여야 하는 이펙트들)은 내부적으로 _sequentialQueue
    // 필드에 "아직 안 보여준 다음 이펙트들"을 들고 있다가, 앞 항목이 끝나는 순간 다음 항목을
    // 이어서 push한다 - 외부에서는 신경 쓸 필요 없이 그냥 effects 배열을 읽으면 된다.
    this.effects = [];
    // trySwap()은 update() 밖(포인터 입력과 동기)에서 바로 호출되므로, 거기서 만든 이펙트를
    // 곧장 _pushEffect하면 다음 update()의 0단계(_advanceEffects)가 "이전 틱 효과"로 오인해
    // durationMs:1짜리를 render()가 보기도 전에 지워버린다(시한폭탄 폭발 연출 누락 버그).
    // update() 0단계 뒤에 큐를 비워 밀어 넣어 다른 신규 이펙트와 같은 보장(최소 한 번은
    // 읽힘)을 받게 한다.
    this._pendingSwapEffects = [];

    // 무효 스왑의 "들썩" 애니메이션은 Resolution을 만들지 않으므로 별도로 추적해서
    // 끝나면 cellStates를 정리해준다.
    this._invalidSwapCells = [];

    this._nextResolutionId = 1;
    this._latestResolutionId = null;

    // 콤보(연속 스트릭) - 특수 잼끼리의 "조합"(COMBO_KIND)과는 다른 개념이다.
    this.comboStreak = 0;
    this.comboStreakTimerMs = 0;

    // 힌트(§C) - 입력이 일정 시간 없으면 가능한 수 한 칸을 가리킨다.
    this.hintCell = null;
    this._inputIdleMs = 0;
    this._hintShown = false;

    // 셔플 연출 길이 선택(§설정 "흔들림/연출 줄이기") - main.js가 effects.json 로드 후 설정한다.
    this.reduceEffects = false;

    // true면 clearing이 끝난 Resolution이 중력/리필(_settleAfterClear)로 넘어가지 않고 기다린다.
    // 렌더의 발동/조합 스프라이트 일정(assets/effects/manifest.json의 swapMs 리드인, 컬러 물결,
    // 변환 조합의 연쇄 지연)은 core의 clear(180ms)보다 훨씬 길어서, 그대로 두면 아직 터지지도
    // 않은 칸 옆으로 새 잼이 떨어진다. main.js가 매 프레임 "렌더가 아직 터뜨리는 중인가"를
    // 넣어준다(core는 연출 길이를 모르므로 판단은 렌더 쪽에 둔다 - reduceEffects와 같은 방식).
    this.settleHold = false;
  }

  setReduceEffects(value) {
    this.reduceEffects = !!value;
  }

  // 칸당 점수 * 연쇄 단계. 실제로 칸 하나가 'clearing'으로 커밋되는 순간마다 호출한다
  // (_commitCellClear) - 체인으로 나중에 지워지는 칸도 지워지는 시점에 자연히 채점되므로,
  // 전체 발동이 몇 틱에 걸쳐 나뉘어도 합산 점수는 "한 번에 다 지웠을 때"와 동일하다.
  _scoreForClear(cellCount, cascadeIndex) {
    return cellCount * SCORING_CONFIG.pointsPerCell * cascadeIndex;
  }

  // ------------------------------------------------------------
  // 입력
  // ------------------------------------------------------------

  // 두 칸을 스왑 시도한다. 반환값은 "입력이 받아들여져 뭔가 반응했는지"(bool)뿐이고,
  // 더 이상 이벤트 배열을 돌려주지 않는다.
  // - 인접하지 않거나, 두 칸 중 하나라도 cellStates!==null(애니메이션 중)이거나, 두 열 중
  //   하나라도 isColumnLocked이면: 아무 것도 하지 않고 false를 반환한다(이벤트도 애니메이션도 없음).
  // - 매치/컬러 스왑/조합 중 하나도 안 걸리면: 보드를 즉시 원복하고, 두 칸에 짧은 단일
  //   'falling' 들썩 애니메이션만 걸고 true를 반환한다(Resolution은 만들지 않음).
  // - 하나라도 걸리면: 새 Resolution을 만들어 두 칸에 스왑 위치 이동 'falling' 애니메이션을
  //   걸고 true를 반환한다. 실제 매치/컬러스왑/조합 해소는 그 애니메이션이 끝난 뒤
  //   update()에서 시작된다(스왑 애니메이션이 끝나기 전에 클리어가 시작되지 않는다).
  trySwap(r1, c1, r2, c2) {
    // 셔플 연출이 재생 중이면 입력을 받지 않는다 - 보드 데이터는 이미 확정돼 있지만
    // 화면에선 아직 소용돌이/정렬 중이라 지금 스왑을 받으면 어색하다.
    if (this._hasActiveShuffle()) return false;

    // 입력이 들어오면(성공/실패 무관) 힌트 유휴 타이머를 취소한다 - §C.
    this._inputIdleMs = 0;
    this.hintCell = null;
    this._hintShown = false;

    const { board } = this;
    if (!board.inBounds(r1, c1) || !board.inBounds(r2, c2) || !board.isAdjacent(r1, c1, r2, c2)) {
      return false;
    }

    const i1 = board.index(r1, c1);
    const i2 = board.index(r2, c2);
    if (board.cellStates[i1] !== null || board.cellStates[i2] !== null) return false;
    if (board.isColumnLocked(c1) || board.isColumnLocked(c2)) return false;
    // occupant 방해요소(swappable:false)는 스왑 판정에 들어오지 못한다 - 매치 코드는 손대지
    // 않고 여기서만 걸러낸다(docs/balance.md 7-2 "occupant는 스왑·매치 불가").
    if (this.obstaclesRegistry) {
      if (!isSwappable(board, this.obstaclesRegistry, r1, c1) || !isSwappable(board, this.obstaclesRegistry, r2, c2)) {
        return false;
      }
    }

    const specialA = board.getSpecial(r1, c1);
    const specialB = board.getSpecial(r2, c2);
    const a = { row: r1, col: c1 };
    const b = { row: r2, col: c2 };

    // 스왑으로 지워지기 전에 원래 값들을 미리 읽어둔다(스왑 후에는 각 칸이 서로의 값을
    // 갖게 되어 "원래" 정보를 잃는다) - 이미 한 번 버그로 겪은 패턴이라 반드시 유지한다.
    const originalValueA = board.get(r1, c1);
    const originalSpecialA = specialA;
    const originalValueB = board.get(r2, c2);
    const originalSpecialB = specialB;

    let colorSwap = null;
    if (specialA?.kind === SPECIAL_KIND.COLOR && !specialB) {
      colorSwap = { colorCell: b, color: board.get(r2, c2) };
    } else if (specialB?.kind === SPECIAL_KIND.COLOR && !specialA) {
      colorSwap = { colorCell: a, color: board.get(r1, c1) };
    }

    // colorSwap과 같은 이유로 "스왑 후" 위치를 기록한다 - board.swap()이 specials도
    // 교환하므로, a에 있던 박스 잼은 스왑 후 b 위치에 가 있다(반대로 적으면 발동 위치가
    // 틀리고, _resolveBoxSwapStep의 activated 체크가 실제 박스 칸을 놓쳐 같은 박스가
    // 체인으로 중복 발동하는 버그가 생긴다).
    let boxSwap = null;
    if (specialA?.kind === SPECIAL_KIND.BOX && !specialB) {
      boxSwap = { boxCell: b, targetCell: a };
    } else if (specialB?.kind === SPECIAL_KIND.BOX && !specialA) {
      boxSwap = { boxCell: a, targetCell: b };
    }

    let comboSeed = null;
    if (specialA && specialB) {
      const comboKind = resolveSpecialCombo(specialA, specialB);
      if (comboKind) {
        comboSeed = {
          comboKind,
          a,
          b,
          ref: b, // 기준 칸 = 플레이어가 옮긴 도착 칸.
          specialA,
          specialB,
          colorA: board.get(r1, c1),
          colorB: board.get(r2, c2),
        };
      }
    }

    const swapped = board.swap(r1, c1, r2, c2);
    if (!swapped) return false;

    let trigger;
    if (comboSeed) {
      trigger = { kind: 'combo', data: comboSeed };
    } else if (colorSwap) {
      trigger = { kind: 'colorSwap', data: colorSwap };
    } else if (boxSwap) {
      trigger = { kind: 'boxSwap', data: boxSwap };
    } else {
      // 다른 열에서 동시에 진행 중인 Resolution이 아직 처리하지 않은 매치가 보드 어딘가에
      // 남아있을 수 있으므로, findMatches 전체가 아니라 이 스왑이 건드린 두 칸(swapCells)과
      // 겹치는 그룹이 있는지로 판정한다(_beginFirstCascadeStep과 같은 필터) - 그렇지 않으면
      // 무관한 매치 때문에 "매치됨"으로 오판해 되돌리지 않고, 뒤에서 relevant가 비어 아무
      // 일도 안 일어나는 채로 스왑된 상태가 영구히 남는 버그가 생긴다.
      const matches = findMatches(board);
      const swapKeys = new Set([keyOf(a), keyOf(b)]);
      const relevant = matches.some((group) => group.cells.some((cell) => swapKeys.has(keyOf(cell))));
      if (!relevant) {
        board.swap(r1, c1, r2, c2); // 매치가 없으면 되돌린다.
        this._beginInvalidSwapWiggle(a, b, originalValueA, originalSpecialA, originalValueB, originalSpecialB);
        return true;
      }
      trigger = { kind: 'match', data: { swapCells: [a, b] } };
    }

    const resolution = this._createResolution();
    resolution.trigger = trigger;
    resolution.phase = 'swap';
    resolution.watchCells = [a, b];
    resolution.columns.add(a.col);
    resolution.columns.add(b.col);

    // 스왑 후 각 칸에 지금 들어있는(= 상대 칸에서 넘어온) 값/특수 메타데이터를 스냅샷으로
    // 싣는다. fromRow/fromCol은 상대 칸의 위치 - 렌더가 거기서 지금 위치로 보간한다.
    board.cellStates[i1] = {
      phase: 'falling',
      elapsedMs: 0,
      durationMs: ANIMATION_DURATIONS_MS.swap,
      value: board.get(r1, c1),
      special: board.getSpecial(r1, c1),
      fromRow: r2,
      fromCol: c2,
    };
    board.cellStates[i2] = {
      phase: 'falling',
      elapsedMs: 0,
      durationMs: ANIMATION_DURATIONS_MS.swap,
      value: board.get(r2, c2),
      special: board.getSpecial(r2, c2),
      fromRow: r1,
      fromCol: c1,
    };

    this.resolutions.push(resolution);
    this._latestResolutionId = resolution.id;
    this.cascadeCount = 0; // 아직 1단계 진입 전.

    // 방해요소: "유효한 스왑" 1회 - 시한폭탄 타이머는 여기서만 줄고(연쇄는 포함 안 됨), 등장
    // 스케줄의 everyMoves 카운터도 여기서만 올라간다(docs/balance.md 7-2/7-3).
    if (this.obstaclesRegistry) this._onObstacleValidSwap();

    // 콤보(연속 스트릭) - Resolution을 만드는 모든 성공 스왑(match/colorSwap/boxSwap/combo)에서
    // 스트릭을 올리고 타이머를 리셋한다. 무효 스왑(여기 도달하지 못함)은 기본적으로 끊지 않는다.
    this.comboStreak += 1;
    this.comboStreakTimerMs = COMBO_CONFIG.timerMs;
    this._pushEffect({
      type: 'comboChange',
      comboStreak: this.comboStreak,
      remainingMs: this.comboStreakTimerMs,
      durationMs: 1,
    });

    return true;
  }

  _beginInvalidSwapWiggle(a, b, valueA, specialA, valueB, specialB) {
    const { board } = this;
    const i1 = board.index(a.row, a.col);
    const i2 = board.index(b.row, b.col);
    // 값은 그대로(스왑이 되돌려졌으므로 원래 칸의 원래 값) - fromRow/fromCol은 상대 칸을
    // 가리킨다. bounce:true면 animator가 "원위치 -> 상대 칸 -> 원위치"를 각 구간 swap과
    // 같은 속도(ANIMATION_DURATIONS_MS.swap)로 재생한다(갔다가 같은 속도로 돌아오는 느낌을
    // 내기 위해 - 한쪽으로 순간 이동한 뒤 혼자 돌아오는 것처럼 보이면 어색하다).
    // breakOnNonMatchSwap:true일 때만 무효 스왑도 콤보를 끊는다(기본은 false - §B4).
    if (COMBO_CONFIG.breakOnNonMatchSwap && this.comboStreak > 0) {
      this._pushEffect({ type: 'comboBreak', comboStreak: this.comboStreak, durationMs: 1 });
      this.comboStreak = 0;
      this.comboStreakTimerMs = 0;
    }
    const legMs = ANIMATION_DURATIONS_MS.swap;
    board.cellStates[i1] = {
      phase: 'falling',
      bounce: true,
      elapsedMs: 0,
      durationMs: legMs * 2,
      value: valueA,
      special: specialA,
      fromRow: b.row,
      fromCol: b.col,
    };
    board.cellStates[i2] = {
      phase: 'falling',
      bounce: true,
      elapsedMs: 0,
      durationMs: legMs * 2,
      value: valueB,
      special: specialB,
      fromRow: a.row,
      fromCol: a.col,
    };
    this._invalidSwapCells.push(a, b);
  }

  _createResolution() {
    return {
      id: this._nextResolutionId++,
      cascadeIndex: 0,
      columns: new Set(), // 지금까지 이 Resolution이 건드린 열(디버깅/검증용, 로직은 의존하지 않음).
      done: false,
      phase: 'swap', // 'swap' | 'clearing' | 'settling' | 'blocked'
      watchCells: [], // 지금 애니메이션 완료를 기다리고 있는 칸들(체인이 발견되는 대로 동적으로 늘어난다).
      seedCells: [], // settling이 끝난 뒤 "내가 settle시킨 칸"으로 다음 매치를 찾을 때 쓰는 기준점.
      trigger: null, // 첫 단계를 시작할 때 쓸 정보: { kind: 'combo'|'colorSwap'|'boxSwap'|'match', data }.
      chainActivated: new Set(), // 이번 캐스케이드 단계에서 이미 자기 효과를 시작한 특수 잼(key).
      protectedKeys: new Set(), // 이번 캐스케이드 단계에서 막 생성된 특수 잼의 칸(key) - 체인/효과가 건드리면 안 된다.
    };
  }

  // 시한폭탄 타이머 틱 + everyMoves 등장 스케줄 - trySwap이 유효한 스왑을 만들 때만 1번
  // 부른다(연쇄/캐스케이드 중에는 호출되지 않으므로 자동으로 "연쇄는 안 셈"이 보장된다).
  // 타이머가 0이 된 attachment는 그 칸을 지우는 전용 Resolution을 새로 만든다(기존
  // armed/clearing -> settle(중력/리필) 파이프라인을 그대로 재사용) - 점수는 다른 clear와
  // 동일하게 매겨지지만 탑 사격은 없다(PuzzleBattleBridge가 value<0/attachment 칸이 아니라
  // GEM_TYPES 색상 기준으로만 쏘므로 영향 없음, obstacleExpire는 wallDamage 전용 신호).
  _onObstacleValidSwap() {
    const { board } = this;
    const registry = this.obstaclesRegistry;

    for (const { row, col, instance, handler } of tickAttachmentTimers(board, registry)) {
      const cell = { row, col };
      const expireResolution = this._createResolution();
      this.resolutions.push(expireResolution);
      this._beginClear(expireResolution, new Map([[keyOf(cell), { row, col, armedMs: 0, cause: 'obstacleExpire' }]]), 1);
      const event = handler.onExpire?.(instance);
      if (event) this._pendingSwapEffects.push({ ...event, cell, durationMs: 1 });
    }

    if (this.floorObstacles) {
      maybeSpawnOnMove(board, registry, this.floorObstacles, board.rng, this._obstacleSpawnCounters);
    }
  }

  // ------------------------------------------------------------
  // 시간 진행
  // ------------------------------------------------------------

  update(dt) {
    const dtMs = dt * 1000;
    const { board } = this;

    // 0) 먼저 "이전 틱들에서 이미 있던" effects만 늙힌다 - 이번 틱 아래에서 cellArmed/
    //    cellDetonate/comboChange/comboBreak/hint 등으로 새로 push되는 효과는 이 호출 뒤에
    //    생기므로 elapsedMs=0인 채로 남고, 최소 한 번은(다음 update() 전까지) 밖에서 읽힐
    //    기회를 보장받는다. 순서를 반대로 하면(기존 버그) durationMs:1짜리 신규 효과가 같은
    //    틱에 바로 dtMs만큼 늙어 사라져 영원히 관찰 불가능해진다.
    this._advanceEffects(dtMs);
    if (this._pendingSwapEffects.length > 0) {
      for (const fields of this._pendingSwapEffects) this._pushEffect(fields);
      this._pendingSwapEffects = [];
    }

    // 1) 지금 애니메이션 중인 모든 칸의 경과 시간을 한 번만 올린다. 그 다음부터는 "완료됐는지"
    //    판정만 하므로, 한 Resolution이 한 틱에 두 단계 이상 전진하지 않는다(새로 시작되는
    //    전환은 elapsedMs=0으로 시작해서 다음 update() 호출에서야 올라간다).
    for (let i = 0; i < board.cellStates.length; i++) {
      const cs = board.cellStates[i];
      if (cs) cs.elapsedMs += dtMs;
    }

    // 2) armed 칸 중 이번 틱에 타이머가 끝난 칸을 처리한다(§A4) - 실제로 클리어를 커밋하거나,
    //    체인/변환이면 그 순간의 보드 상태로 자기 효과를 계산해 새 armed 칸들을 더 예약한다.
    this._advanceArmedCells();

    this._advanceInvalidSwaps();

    for (const resolution of this.resolutions) {
      if (!resolution.done) this._advanceResolution(resolution);
    }

    this._advanceComboStreak(dtMs);
    this._advanceHint(dtMs);

    const hadActive = this.resolutions.length > 0;
    if (hadActive) {
      this.resolutions = this.resolutions.filter((r) => !r.done);
    }
    if (hadActive && this.resolutions.length === 0) {
      this._maybeReshuffle();
    }
  }

  _advanceInvalidSwaps() {
    const { board } = this;
    if (this._invalidSwapCells.length === 0) return;
    this._invalidSwapCells = this._invalidSwapCells.filter((cell) => {
      const idx = board.index(cell.row, cell.col);
      const cs = board.cellStates[idx];
      if (!cs) return false;
      if (cs.elapsedMs >= cs.durationMs) {
        board.cellStates[idx] = null;
        return false;
      }
      return true;
    });
  }

  // 콤보(연속 스트릭) 타이머 - §B3. 보드에 armed/clearing/falling/spawning 칸이 하나라도
  // 있거나 활성 Resolution이 있으면 "진행 중"으로 보고 줄이지 않는다.
  _advanceComboStreak(dtMs) {
    if (this.comboStreak === 0) return;
    const { board } = this;
    const busy = this.resolutions.length > 0 || board.cellStates.some((cs) => cs !== null);
    if (busy) return;
    this.comboStreakTimerMs -= dtMs;
    if (this.comboStreakTimerMs <= 0) {
      this._pushEffect({ type: 'comboBreak', comboStreak: this.comboStreak, durationMs: 1 });
      this.comboStreak = 0;
      this.comboStreakTimerMs = 0;
    }
  }

  _hasActiveShuffle() {
    return this.effects.some((effect) => effect.type === 'shuffle');
  }

  // 힌트(§C) - 연쇄가 진행 중이거나 셔플 연출 중이면 유휴로 치지 않는다(plan.md §16과 동일).
  // 셔플가 끝나는 틱엔 resolutions가 비어 있으므로 이 체크가 없으면 유휴 누적이 새지 않게
  // 막아주는 셈 - 연출이 끝나면 자연히 다음 틱부터 0에서 다시 쌓인다(별도 리셋 불필요).
  _advanceHint(dtMs) {
    if (this.resolutions.length > 0 || this._hasActiveShuffle()) {
      this._inputIdleMs = 0;
      return;
    }
    this._inputIdleMs += dtMs;
    if (this._hintShown || this._inputIdleMs < HINT_CONFIG.idleMs) return;
    // shortcut: 수가 없으면 _hintShown만 세우고 조용히 넘어간다 - 매 틱 재탐색(findAnyValidMove는
    // O(rows*cols)의 매치 재계산)을 반복하지 않기 위함. 다음 입력(trySwap)이 들어오면 다시 풀린다.
    this._hintShown = true;
    const canSwap = this.obstaclesRegistry
      ? (r1, c1, r2, c2) =>
          isSwappable(this.board, this.obstaclesRegistry, r1, c1) && isSwappable(this.board, this.obstaclesRegistry, r2, c2)
      : undefined;
    const move = findAnyValidMove(this.board, canSwap);
    if (move) {
      this.hintCell = move.from;
      this._pushEffect({ type: 'hint', cell: move.from, durationMs: 1 });
    }
  }

  _advanceEffects(dtMs) {
    if (this.effects.length === 0) return;
    const next = [];
    for (const effect of this.effects) {
      effect.elapsedMs += dtMs;
      if (effect.elapsedMs < effect.durationMs) {
        next.push(effect);
        continue;
      }
      // 다 보여줬다 - sequential 체인이면 다음 항목을 이어서 push, 아니면 그냥 버린다.
      if (effect._sequentialQueue && effect._sequentialQueue.length > 0) {
        const queue = effect._sequentialQueue;
        const nextItem = queue.shift();
        next.push({ ...nextItem, elapsedMs: 0, _sequentialQueue: queue });
      }
    }
    this.effects = next;
  }

  _cellsComplete(cells) {
    const { board } = this;
    return cells.every((cell) => {
      const cs = board.cellStates[board.index(cell.row, cell.col)];
      return !cs || cs.elapsedMs >= cs.durationMs;
    });
  }

  _clearCellStates(cells) {
    const { board } = this;
    for (const cell of cells) {
      board.cellStates[board.index(cell.row, cell.col)] = null;
    }
  }

  _advanceResolution(resolution) {
    if (resolution.phase === 'blocked') {
      // 대기열 없이 매 틱 같은 조건을 다시 본다.
      this._checkNextCascadeStep(resolution);
      return;
    }

    if (!this._cellsComplete(resolution.watchCells)) return; // 아직 애니메이션/체인 발동 중.
    // 렌더가 아직 이 제거를 연출하는 중이면 중력/리필만 미룬다(이미 지워진 칸은 그대로 빈 자리로
    // 남고, 연출이 끝나면 한꺼번에 떨어진다). armed 타이머와 체인 발동은 계속 진행한다 -
    // 렌더의 지연 연출(_deferComboChain)이 core의 specialActivate를 기다리고 있으므로 여기서
    // 같이 멈추면 서로 기다려 영원히 안 끝난다.
    if (resolution.phase === 'clearing' && this.settleHold) return;
    this._clearCellStates(resolution.watchCells);

    if (resolution.phase === 'swap') {
      this._beginFirstCascadeStep(resolution);
    } else if (resolution.phase === 'clearing') {
      this._settleAfterClear(resolution);
    } else if (resolution.phase === 'settling') {
      resolution.seedCells = resolution.watchCells;
      this._checkNextCascadeStep(resolution);
    }
  }

  _markCascadeIndex(resolution) {
    if (resolution.id === this._latestResolutionId) {
      this.cascadeCount = resolution.cascadeIndex;
    }
  }

  // 스왑 애니메이션이 끝난 뒤 첫 캐스케이드 단계를 시작한다. trySwap에서 미리 분류해둔
  // trigger(컬러스왑/조합/일반매치)에 따라 분기한다.
  _beginFirstCascadeStep(resolution) {
    resolution.cascadeIndex = 1;
    this._markCascadeIndex(resolution);

    const { trigger } = resolution;
    if (trigger.kind === 'combo') {
      this._resolveComboStep(resolution, trigger.data, 1);
    } else if (trigger.kind === 'colorSwap') {
      this._resolveColorSwapStep(resolution, trigger.data, 1);
    } else if (trigger.kind === 'boxSwap') {
      this._resolveBoxSwapStep(resolution, trigger.data, 1);
    } else {
      // 'match': 스왑 애니메이션이 재생되는 동안(최대 ANIMATION_DURATIONS_MS.swap만큼) 다른
      // 열에서 동시에 진행 중인 독립적인 해소가 이 매치 그룹과 무관한 곳에 새 매치를 만들어
      // 놓았을 수 있으므로, findMatches 결과 전체를 쓰지 않고 이 스왑이 실제로 건드린 칸
      // (swapCells)과 겹치는 그룹만 "내 것"으로 추린다 - 그래야 전혀 무관한(다른 Resolution이
      // 아직 처리하지 않은) 매치를 가로채지 않는다. _checkNextCascadeStep의 seedCells 필터링과
      // 같은 원칙이다.
      const swapCells = trigger.data.swapCells;
      const matches = findMatches(this.board);
      const swapKeys = new Set(swapCells.map(keyOf));
      const relevant = matches.filter((group) => group.cells.some((cell) => swapKeys.has(keyOf(cell))));
      this._resolveMatchStep(resolution, relevant, 1, swapCells);
    }
  }

  // 클리어 애니메이션이 끝난 뒤 낙하/리필을 동기로 커밋하고, 그 결과(moves/spawns)로
  // falling/spawning cellStates를 건다.
  _settleAfterClear(resolution) {
    const { board } = this;
    const moves = applyGravity(board);
    const spawns = refill(board);

    const watchCells = [];
    for (const move of moves) {
      const idx = board.index(move.to.row, move.to.col);
      board.cellStates[idx] = {
        phase: 'falling',
        elapsedMs: 0,
        durationMs: ANIMATION_DURATIONS_MS.fall,
        value: move.value,
        special: move.special,
        fromRow: move.from.row,
        fromCol: move.from.col,
      };
      watchCells.push({ row: move.to.row, col: move.to.col });
      resolution.columns.add(move.to.col);
    }
    for (const spawn of spawns) {
      const idx = board.index(spawn.row, spawn.col);
      board.cellStates[idx] = {
        phase: 'spawning',
        elapsedMs: 0,
        durationMs: ANIMATION_DURATIONS_MS.spawn,
        value: spawn.value,
        special: null,
        fromRow: null,
        fromCol: null,
      };
      watchCells.push({ row: spawn.row, col: spawn.col });
      resolution.columns.add(spawn.col);
    }

    resolution.watchCells = watchCells;
    resolution.phase = 'settling';

    // affectedMap이 비어있지 않았던 한 moves/spawns가 둘 다 비는 경우는 없다(클리어된 칸이
    // 있으면 그 열에 적어도 하나의 move 또는 spawn이 생긴다). 그래도 방어적으로 빈 경우를
    // 대비해 바로 다음 체크로 넘어간다.
    if (watchCells.length === 0) {
      resolution.seedCells = [];
      this._checkNextCascadeStep(resolution);
    }
  }

  // settling이 끝났거나(최초 호출) blocked 상태에서 재시도할 때 공통으로 쓰는 다음 단계 판정.
  // resolution.seedCells(이 Resolution이 가장 최근에 settle시킨 칸들)과 겹치는 매치 그룹만
  // "내 것"으로 간주한다 - 그래야 다른 Resolution이 아직 처리 중인(또는 처리 대기 중인) 매치를
  // 가로채지 않는다.
  _checkNextCascadeStep(resolution) {
    const { board } = this;
    if (resolution.seedCells.length === 0) {
      resolution.done = true;
      return;
    }

    const matches = findMatches(board);
    const seedKeys = new Set(resolution.seedCells.map(keyOf));
    const relevant = matches.filter((group) => group.cells.some((cell) => seedKeys.has(keyOf(cell))));

    if (relevant.length === 0) {
      resolution.done = true;
      return;
    }

    const columns = new Set();
    for (const group of relevant) {
      for (const cell of group.cells) columns.add(cell.col);
    }
    const blocked = Array.from(columns).some((col) => board.isColumnLocked(col));
    if (blocked) {
      resolution.phase = 'blocked';
      return; // 다음 틱에 같은 조건을 다시 본다.
    }

    resolution.cascadeIndex += 1;
    this._markCascadeIndex(resolution);
    this._resolveMatchStep(resolution, relevant, resolution.cascadeIndex, null);
  }

  // ------------------------------------------------------------
  // 캐스케이드 단계 계산(매치/특수 잼 생성 계획/연쇄 발동 범위 계산은 기존 로직을 그대로
  // 재사용한다 - 달라진 것은 "affected 전부를 한 번에 clearing으로 커밋"하는 대신, 각 칸을
  // armedMs(거리/등장 순서 기반 지연)와 함께 _beginClear/_armCell에 넘겨 시간에 걸쳐 순차적으로
  // 지워지게 하는 것, 그리고 체인으로 캐치되는 특수 잼은 그 자리에서 효과를 계산하지 않고
  // _advanceArmedCells가 실제 발동 시각에 계산하도록 미루는 것뿐이다).
  // ------------------------------------------------------------

  // 특수 잼끼리 스왑된 조합 효과를 적용한다. 스왑된 두 잼(a,b)은 항상 소모(제거)되고,
  // 각자의 단독 발동은 일어나지 않는다. 조합 종류에 따라:
  // - 즉시 범위 삭제(라인+라인/폭탄+폭탄/라인+폭탄/컬러+컬러/박스+박스): comboActivate 이펙트
  //   하나 + 범위 안의 각 칸을 거리/등장 순서 기반 armedMs로 예약(그 안의 다른 특수 잼은
  //   체인으로 나중에 자기 효과를 발동).
  // - 변환(라인+컬러/폭탄+컬러/박스+라인/박스+폭탄/박스+컬러): 같은 색 일반 잼을 모두
  //   라인/폭탄/박스로 바꾸는 specialTransform 이펙트 하나 + 변환된 칸들을 등장 순서 *
  //   transformStepMs 뒤에 "자기 효과 직행"으로 예약(박스+컬러는 변환된 칸 자체는 터지지 않고,
  //   대신 랜덤 (변환 개수 x 2)개가 모든 변환이 끝난 시각부터 박스 규칙으로 터진다).
  _resolveComboStep(resolution, comboSeed, cascadeIndex) {
    const { board } = this;
    const { comboKind, a, b, ref, specialA, specialB, colorA, colorB } = comboSeed;

    resolution.chainActivated = new Set([keyOf(a), keyOf(b)]);
    resolution.protectedKeys = new Set(); // 이 단계는 새 특수 잼을 생성하지 않는다(매치 단계만 해당).

    // 컬러+컬러는 이미 보드 전체가 범위다 - 그 안의 다른 특수 잼을 "아직 발동 안 함"으로 보고
    // 체인(캐치 후 +200ms, 자기 효과)으로 넘기면 쓸모없이 따로 다시 발동하는 꼴이 된다(전부
    // 같은 틱에 지워질 범위 안에 있으므로). 미리 "이미 발동함"으로 표시해 그냥 즉시 지운다.
    if (comboKind === COMBO_KIND.COLOR_COLOR) {
      for (let r = 0; r < board.rows; r++) {
        for (let c = 0; c < board.cols; c++) {
          if (board.getSpecial(r, c)) resolution.chainActivated.add(keyOf({ row: r, col: c }));
        }
      }
    }

    const plan = new Map();
    plan.set(keyOf(a), { row: a.row, col: a.col, armedMs: 0, cause: 'combo' });
    plan.set(keyOf(b), { row: b.row, col: b.col, armedMs: 0, cause: 'combo' });

    let comboCells = [];
    let transformPlan = null; // { kind, cells, noActivate?, color? }

    switch (comboKind) {
      case COMBO_KIND.LINE_LINE:
        comboCells = lineLineComboCells(board, ref);
        break;
      case COMBO_KIND.BOMB_BOMB:
        comboCells = bombComboCells(board, a, b, ref);
        break;
      case COMBO_KIND.LINE_BOMB:
        comboCells = lineBombComboCells(board, ref);
        break;
      case COMBO_KIND.LINE_COLOR: {
        const lineColor = specialA.kind === SPECIAL_KIND.LINE ? colorA : colorB;
        transformPlan = { kind: SPECIAL_KIND.LINE, cells: plainCellsOfColor(board, lineColor) };
        break;
      }
      case COMBO_KIND.BOMB_COLOR: {
        const bombColor = specialA.kind === SPECIAL_KIND.BOMB ? colorA : colorB;
        transformPlan = { kind: SPECIAL_KIND.BOMB, cells: plainCellsOfColor(board, bombColor) };
        break;
      }
      case COMBO_KIND.COLOR_COLOR:
        comboCells = allCells(board);
        break;
      case COMBO_KIND.BOX_BOX:
        comboCells = pickRandomIdleCells(board, 6, new Set([keyOf(a), keyOf(b)]));
        break;
      case COMBO_KIND.BOX_LINE: {
        const lineColor = specialA.kind === SPECIAL_KIND.LINE ? colorA : colorB;
        transformPlan = { kind: SPECIAL_KIND.LINE, cells: pickRandomCellsOfColor(board, lineColor, 2) };
        break;
      }
      case COMBO_KIND.BOX_BOMB: {
        const bombColor = specialA.kind === SPECIAL_KIND.BOMB ? colorA : colorB;
        transformPlan = { kind: SPECIAL_KIND.BOMB, cells: pickRandomCellsOfColor(board, bombColor, 2) };
        break;
      }
      case COMBO_KIND.BOX_COLOR: {
        const boxColor = specialA.kind === SPECIAL_KIND.BOX ? colorA : colorB;
        transformPlan = {
          kind: SPECIAL_KIND.BOX,
          cells: plainCellsOfColor(board, boxColor),
          noActivate: true,
          color: boxColor,
        };
        break;
      }
      default:
        break;
    }

    if (comboCells.length > 0) {
      const cause = causeForComboKind(comboKind);
      let delays;
      if (comboKind === COMBO_KIND.LINE_LINE || comboKind === COMBO_KIND.LINE_BOMB) {
        delays = computeDistanceDelays(
          comboCells,
          ref,
          DETONATION_CONFIG.lineStepMs,
          DETONATION_CONFIG.maxDetonationMs,
          manhattanDistance
        );
      } else if (comboKind === COMBO_KIND.BOMB_BOMB) {
        delays = computeDistanceDelays(
          comboCells,
          ref,
          DETONATION_CONFIG.bombStepMs,
          DETONATION_CONFIG.maxDetonationMs,
          chebyshevDistance
        );
      } else if (comboKind === COMBO_KIND.BOX_BOX) {
        delays = computeSequentialDelays(comboCells.length, DETONATION_CONFIG.boxStepMs, DETONATION_CONFIG.maxDetonationMs);
      } else {
        // COLOR_COLOR: 즉시, 보드 전체.
        delays = comboCells.map(() => 0);
      }
      comboCells.forEach((cell, i) => {
        plan.set(keyOf(cell), { row: cell.row, col: cell.col, armedMs: delays[i], cause });
      });
      // 줄+줄/폭탄+폭탄/줄+폭탄/컬러+컬러 조합의 효과 범위 - 방해요소 1 피해(specialEffect).
      this._damageObstacles(resolution, comboCells, cascadeIndex, 'specialEffect');
    }

    this._pushEffect({
      type: 'comboActivate',
      comboKind,
      position: ref,
      // 스왑된 두 특수 잼({kind, direction})과 그 색 - 전투에서 각자 기술을 따로 발동한다.
      specials: [specialA, specialB],
      gemColors: [colorA, colorB],
      affected: [...plan.values()].map(({ row, col }) => ({ row, col })),
      cascadeIndex,
      durationMs: ANIMATION_DURATIONS_MS.comboActivate,
    });

    let transformedCells = [];
    let transformDelays = [];
    if (transformPlan) {
      transformedCells = transformPlan.cells;
      // 라인으로 변환되는 칸은 각자 무작위 방향을 받는다(seed RNG).
      const directedCells = transformedCells.map((cell) => {
        const direction =
          transformPlan.kind === SPECIAL_KIND.LINE ? (board.rng() < 0.5 ? 'horizontal' : 'vertical') : null;
        board.setSpecial(cell.row, cell.col, { kind: transformPlan.kind, direction });
        return { row: cell.row, col: cell.col, direction };
      });
      if (directedCells.length > 0) {
        this._pushEffect({
          type: 'specialTransform',
          cells: directedCells,
          kind: transformPlan.kind,
          cascadeIndex,
          durationMs: ANIMATION_DURATIONS_MS.specialTransform,
        });
      }
      transformDelays = computeSequentialDelays(
        transformedCells.length,
        DETONATION_CONFIG.transformStepMs,
        DETONATION_CONFIG.maxDetonationMs
      );

      if (transformPlan.noActivate) {
        // 박스+컬러: 변환된 잼은 터지지 않고 남는다(plan에 넣지 않는다). (변환 개수 x 2)개의
        // 랜덤 잼이, 모든 변환이 끝나는 시각부터 박스 규칙(등장 순서대로 150ms 간격)으로 대신 터진다.
        const lastTransformEndMs = transformDelays.length ? transformDelays[transformDelays.length - 1] : 0;
        const exclude = new Set([...plan.keys(), ...transformedCells.map(keyOf)]);
        const extra = pickRandomIdleCells(board, transformedCells.length * 2, exclude);
        if (extra.length > 0) {
          this._pushEffect({
            type: 'specialActivate',
            kind: SPECIAL_KIND.BOX,
            direction: null,
            position: ref,
            color: transformPlan.color,
            affected: extra,
            cascadeIndex,
            durationMs: ANIMATION_DURATIONS_MS.specialActivate,
          });
        }
        const extraDelays = computeSequentialDelays(extra.length, DETONATION_CONFIG.boxStepMs, DETONATION_CONFIG.maxDetonationMs);
        extra.forEach((cell, i) => {
          plan.set(keyOf(cell), { row: cell.row, col: cell.col, armedMs: lastTransformEndMs + extraDelays[i], cause: 'box' });
        });
        this._damageObstacles(resolution, extra, cascadeIndex, 'specialEffect');
        transformedCells = []; // 자기 효과 직행 스케줄을 걸지 않는다(터지지 않으므로).
      }
    }

    // 점수는 각 칸이 실제로 'clearing'으로 커밋되는 시점에 _commitCellClear가 매긴다
    // (affected.size로 미리 셀 수 없다 - 체인/변환으로 나중에 드러나는 칸은 이 시점에는
    // 아직 모른다).
    this._beginClear(resolution, plan, cascadeIndex);

    // 변환으로 "새로 생성"된 특수 잼은 캐치된 게 아니라 막 만들어진 것이므로, 체인의 +200ms
    // 캐치 지연 없이 등장 순서 * transformStepMs 뒤에 바로 자기 효과가 시작되도록 예약한다.
    // _beginClear가 watchCells를 초기화하므로 그 뒤에 걸어야 한다.
    transformedCells.forEach((cell, i) => {
      this._armCell(resolution, { row: cell.row, col: cell.col }, transformDelays[i], 'transform', cascadeIndex, {
        forceSelfEffect: true,
      });
    });
  }

  // 컬러 잼 <-> 일반 잼 스왑: 그 일반 잼과 같은 색을 보드에서 전부 지운다(자기 자신도 소모).
  // 범위 안에 다른 특수 잼이 있으면 체인으로 나중에 자기 효과를 발동한다.
  _resolveColorSwapStep(resolution, { colorCell, color }, cascadeIndex) {
    const { board } = this;
    resolution.chainActivated = new Set([keyOf(colorCell)]);
    resolution.protectedKeys = new Set();
    const colorCells = cellsOfColor(board, color);
    this._damageObstacles(resolution, colorCells, cascadeIndex, 'specialEffect');

    const plan = new Map();
    plan.set(keyOf(colorCell), { row: colorCell.row, col: colorCell.col, armedMs: 0, cause: 'color' });
    for (const cell of colorCells) {
      plan.set(keyOf(cell), { row: cell.row, col: cell.col, armedMs: 0, cause: 'color' });
    }

    this._pushEffect({
      type: 'specialActivate',
      kind: SPECIAL_KIND.COLOR,
      direction: null,
      position: colorCell,
      color,
      affected: [...plan.values()].map(({ row, col }) => ({ row, col })),
      cascadeIndex,
      durationMs: ANIMATION_DURATIONS_MS.specialActivate,
    });

    this._beginClear(resolution, plan, cascadeIndex);
  }

  // 박스 잼 <-> 일반 잼 스왑: 상대 잼 + 박스 잼이 지워지고, idle 칸 중 랜덤 2개가 등장 순서대로
  // 150ms 간격으로 추가로 지워진다. 랜덤 칸이 특수 잼이면 체인으로 나중에 자기 효과를 발동한다.
  _resolveBoxSwapStep(resolution, { boxCell, targetCell }, cascadeIndex) {
    const { board } = this;
    resolution.chainActivated = new Set([keyOf(boxCell)]);
    resolution.protectedKeys = new Set();
    const extra = pickRandomIdleCells(board, 2, new Set([keyOf(boxCell), keyOf(targetCell)]));
    this._damageObstacles(resolution, extra, cascadeIndex, 'specialEffect');
    const delays = computeSequentialDelays(extra.length, DETONATION_CONFIG.boxStepMs, DETONATION_CONFIG.maxDetonationMs);

    const plan = new Map();
    plan.set(keyOf(boxCell), { row: boxCell.row, col: boxCell.col, armedMs: 0, cause: 'box' });
    plan.set(keyOf(targetCell), { row: targetCell.row, col: targetCell.col, armedMs: 0, cause: 'box' });
    extra.forEach((cell, i) => {
      plan.set(keyOf(cell), { row: cell.row, col: cell.col, armedMs: delays[i], cause: 'box' });
    });

    this._pushEffect({
      type: 'specialActivate',
      kind: SPECIAL_KIND.BOX,
      direction: null,
      position: boxCell,
      color: null,
      gemColor: board.get(boxCell.row, boxCell.col), // 특수 잼 자신의 색 - 전투 기술 색(docs/skills.md).
      affected: [...plan.values()].map(({ row, col }) => ({ row, col })),
      cascadeIndex,
      durationMs: ANIMATION_DURATIONS_MS.specialActivate,
    });

    this._beginClear(resolution, plan, cascadeIndex);
  }

  // 매치 그룹 목록을 해소: 특수 잼 생성 계획 수립(생성 칸은 이번 단계에서 지우지 않는다) ->
  // 생성 적용 -> 나머지 매치 칸(기존에 있던 특수 잼 포함) 전부를 armedMs=0으로 clearing 시작.
  // 매치에 낀 기존 특수 잼은 "일반 매치 제거"와 같은 0 지연으로 캐치되지만, 특수 잼이므로
  // _armCell이 자동으로 체인(캐치 후 +200ms, 그 시점 보드 상태로 자기 효과 계산)으로 처리한다.
  _resolveMatchStep(resolution, matches, cascadeIndex, swapCells) {
    const { board } = this;
    resolution.chainActivated = new Set();

    const plan = new Map();
    for (const group of matches) {
      for (const cell of group.cells) {
        plan.set(keyOf(cell), { row: cell.row, col: cell.col, armedMs: 0, cause: 'match' });
      }
    }

    // 매치로 지워진 칸들의 상하좌우 occupant 방해요소에 1 피해(adjacentMatch, docs/balance.md 7-2).
    if (this.obstaclesRegistry) {
      const neighborSeen = new Set();
      const neighbors = [];
      for (const group of matches) {
        for (const cell of group.cells) {
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = cell.row + dr;
            const nc = cell.col + dc;
            if (!board.inBounds(nr, nc)) continue;
            const key = `${nr},${nc}`;
            if (neighborSeen.has(key)) continue;
            neighborSeen.add(key);
            neighbors.push({ row: nr, col: nc });
          }
        }
      }
      this._damageObstacles(resolution, neighbors, cascadeIndex, 'adjacentMatch');
    }

    const spawnPlans = [];
    for (const group of matches) {
      const decision = decideSpecialForGroup(group);
      if (!decision) continue;
      const spawnCell = pickSpawnCell(group, decision.kind, swapCells);
      plan.delete(keyOf(spawnCell)); // 생성 칸은 이번 단계에서 지우지 않는다.
      const color = decision.kind === SPECIAL_KIND.COLOR ? COLORLESS : group.color;
      spawnPlans.push({
        cell: spawnCell,
        kind: decision.kind,
        direction: decision.direction ?? null,
        color,
        sourceColor: group.color,
      });
    }

    // 생성 칸은 이후(이번 틱이든 체인으로 나중이든) 어떤 효과도 건드리면 안 된다 - 라이브
    // 보드 상태로 계산되는 체인의 효과 범위(computeEffect)는 "생성 예정"이라는 사실을 모르므로,
    // _armCell/_runSelfEffect가 이 Set을 보고 명시적으로 걸러낸다(§A4 "보드-화면 일치").
    resolution.protectedKeys = new Set(spawnPlans.map((p) => keyOf(p.cell)));

    for (const spawnPlan of spawnPlans) {
      board.set(spawnPlan.cell.row, spawnPlan.cell.col, spawnPlan.color);
      board.setSpecial(spawnPlan.cell.row, spawnPlan.cell.col, { kind: spawnPlan.kind, direction: spawnPlan.direction });
      this._pushEffect({
        type: 'specialCreate',
        position: spawnPlan.cell,
        kind: spawnPlan.kind,
        direction: spawnPlan.direction,
        color: spawnPlan.color,
        cascadeIndex,
        durationMs: ANIMATION_DURATIONS_MS.specialCreate,
      });
    }

    this._beginClear(resolution, plan, cascadeIndex);
  }

  // "제거 예약" = plan(Map<key, {row, col, armedMs, cause}>)의 각 칸을 armed(또는 즉시 clearing)
  // cellState로 바꾼다. watchCells를 새로 시작한다 - 이후 체인/변환으로 발견되는 칸들은
  // _armCell이 같은 배열에 계속 追加한다(기존 _cellsComplete/_advanceResolution이 그 동적으로
  // 늘어나는 배열을 그대로 기다린다).
  _beginClear(resolution, plan, cascadeIndex) {
    resolution.watchCells = [];
    resolution.phase = 'clearing';
    for (const entry of plan.values()) {
      this._armCell(resolution, { row: entry.row, col: entry.col }, entry.armedMs, entry.cause, cascadeIndex);
    }
  }

  // 한 칸을 "armedMs 뒤에 지워지도록" 예약한다(§A). 이미 다른 Resolution이 점유한 칸은
  // 조용히 건너뛴다(기존 _beginClear의 방어적 가드와 동일한 이유).
  //
  // - 이 칸이 특수 잼이고 아직 이번 캐스케이드 단계에서 발동하지 않았다면(resolution.chainActivated
  //   에 없으면) "체인 후보"다: armedMs(캐치 규칙이 배정한 지연)만큼 먼저 armed되고, 그게 끝나면
  //   (_advanceArmedCells) chainArmMs(200ms)를 더 기다린 뒤에야 자기 효과가 시작된다.
  // - opts.forceSelfEffect가 true면(변환으로 막 생성된 특수 잼) 체인 감지 없이 바로 "캐치 지연
  //   armedMs가 끝나면 곧장 자기 효과 시작"으로 스케줄한다(+200ms 없음).
  // - 그 외(특수 잼이 아니거나 이미 발동한 칸)는 armedMs가 0이면 armed 단계 자체를 건너뛰고
  //   바로 clearing으로 커밋한다(평범한 즉시 제거와 100% 동일), armedMs>0이면 armed로 대기한다.
  _armCell(resolution, cell, armedMs, cause, cascadeIndex, opts = {}) {
    const { board } = this;
    const idx = board.index(cell.row, cell.col);
    const key = keyOf(cell);
    if (board.cellStates[idx] !== null) return; // 다른 Resolution이 이미 점유 - 건너뛴다.
    if (resolution.protectedKeys.has(key)) return; // 이번 단계에서 막 생성된 특수 잼 칸 - 건너뛴다.

    const special = board.getSpecial(cell.row, cell.col);

    let pendingSelfEffect = false;
    let needsGap = false;
    if (opts.forceSelfEffect) {
      pendingSelfEffect = true;
      needsGap = false;
      resolution.chainActivated.add(key);
    } else if (special && !resolution.chainActivated.has(key)) {
      resolution.chainActivated.add(key);
      pendingSelfEffect = true;
      needsGap = true;
    }

    const ms = Math.max(armedMs, 0);
    const value = board.get(cell.row, cell.col);

    if (!pendingSelfEffect && ms <= 0) {
      this._commitCellClear(resolution, cell, { value, special, cause }, cascadeIndex);
      return;
    }

    board.cellStates[idx] = {
      phase: 'armed',
      elapsedMs: 0,
      durationMs: ms,
      value,
      special,
      resolutionId: resolution.id,
      fromRow: null,
      fromCol: null,
      cause,
      cascadeIndex,
      pendingSelfEffect,
      needsGap,
    };
    this._addWatchCell(resolution, cell);
    this._pushEffect({ type: 'cellArmed', cell: { row: cell.row, col: cell.col }, remainingMs: ms, cause, durationMs: 1 });
  }

  _addWatchCell(resolution, cell) {
    resolution.watchCells.push({ row: cell.row, col: cell.col });
    resolution.columns.add(cell.col);
  }

  // armed 칸 중 이번 틱에 elapsedMs가 durationMs를 넘은 칸을 전부 처리한다(§A4) - 보드
  // 전체를 훑는 전역 패스라 어느 Resolution이 걸었는지는 resolutionId로 찾는다.
  _advanceArmedCells() {
    const { board } = this;
    for (let i = 0; i < board.cellStates.length; i++) {
      const cs = board.cellStates[i];
      if (!cs || cs.phase !== 'armed') continue;
      if (cs.elapsedMs < cs.durationMs) continue;

      const resolution = this.resolutions.find((r) => r.id === cs.resolutionId);
      if (!resolution) {
        // 소유 Resolution을 못 찾는 경우는 있을 수 없지만(완료된 Resolution은 watchCells가
        // 전부 끝나야 filter로 빠지므로), 방어적으로 그냥 idle로 정리한다.
        board.cellStates[i] = null;
        continue;
      }

      const row = Math.floor(i / board.cols);
      const col = i % board.cols;
      const cell = { row, col };

      if (!cs.pendingSelfEffect) {
        this._commitCellClear(resolution, cell, cs, cs.cascadeIndex);
        continue;
      }

      if (cs.needsGap) {
        board.cellStates[i] = {
          ...cs,
          elapsedMs: 0,
          durationMs: DETONATION_CONFIG.chainArmMs,
          cause: 'chain',
          needsGap: false,
        };
        this._pushEffect({
          type: 'cellArmed',
          cell: { row, col },
          remainingMs: DETONATION_CONFIG.chainArmMs,
          cause: 'chain',
          durationMs: 1,
        });
        continue;
      }

      // 자기 효과를 "지금"(이 칸이 실제로 발동하는 시각의 보드 상태)으로 계산해 새 칸들을
      // 예약한 뒤, 이 칸 자신은 거리 0이므로 곧장 클리어로 커밋한다.
      this._runSelfEffect(resolution, cell, cs.special, cs.cascadeIndex, cs.cause === 'transform');
      this._commitCellClear(resolution, cell, cs, cs.cascadeIndex);
    }
  }

  // 칸 하나의 자기 효과(라인/폭탄/박스/컬러)를 "지금" 보드 상태로 계산해, 범위 안의 다른 칸들을
  // (자기 자신 제외) 각 종류의 거리/등장 순서 규칙으로 armed 예약한다. 범위 안에 또 다른
  // 발동 안 한 특수 잼이 있으면 _armCell이 자동으로 체인(§A3)으로 처리한다.
  _runSelfEffect(resolution, cell, special, cascadeIndex, fromTransform = false) {
    const { board } = this;
    const { cells, color } = computeEffect(board, cell, special);
    this._damageObstacles(resolution, cells, cascadeIndex, 'specialEffect');
    // 생성 칸(resolution.protectedKeys)은 이펙트 표시에서도 제외한다 - 이 시점의 보드에는
    // 이미 새 특수 잼이 놓여 있지만(§A4), 그 칸은 "방금 생성됨"이라 이 효과가 지운 것처럼
    // 보이면 안 된다(렌더가 방금 만든 특수 잼을 다시 지우는 것처럼 보임).
    const displayCells = cells.filter((c) => !resolution.protectedKeys.has(keyOf(c)));

    this._pushEffect({
      type: 'specialActivate',
      kind: special.kind,
      direction: special.direction ?? null,
      position: cell,
      color,
      gemColor: board.get(cell.row, cell.col), // 특수 잼 자신의 색 - 전투 기술 색(docs/skills.md).
      fromTransform, // 조합 변환으로 생긴 잼 - 전투 기술은 안 나간다(퍼즐 효과·기본 사격만).
      affected: displayCells,
      cascadeIndex,
      durationMs: ANIMATION_DURATIONS_MS.specialActivate,
    });

    const delays = this._delaysForKind(special.kind, cell, cells);
    const selfKey = keyOf(cell);
    cells.forEach((c, i) => {
      if (keyOf(c) === selfKey) return; // 자기 자신은 호출부(_advanceArmedCells)가 직접 커밋한다.
      this._armCell(resolution, c, delays[i], special.kind, cascadeIndex); // 생성 칸이면 _armCell이 알아서 건너뛴다.
    });
  }

  // 특수 잼 종류별 거리/등장 순서 지연 규칙(§A3). cells와 같은 순서/길이의 배열을 반환한다.
  _delaysForKind(kind, origin, cells) {
    const cfg = DETONATION_CONFIG;
    if (kind === SPECIAL_KIND.LINE) {
      return computeDistanceDelays(cells, origin, cfg.lineStepMs, cfg.maxDetonationMs, manhattanDistance);
    }
    if (kind === SPECIAL_KIND.BOMB) {
      return computeDistanceDelays(cells, origin, cfg.bombStepMs, cfg.maxDetonationMs, chebyshevDistance);
    }
    if (kind === SPECIAL_KIND.BOX) {
      // computeEffect(BOX)는 항상 [자기 칸, ...랜덤 대상]을 돌려준다(specials.js 계약).
      const extraDelays = computeSequentialDelays(cells.length - 1, cfg.boxStepMs, cfg.maxDetonationMs);
      return [0, ...extraDelays];
    }
    // COLOR: 전부 즉시.
    return cells.map(() => 0);
  }

  // cells 안의 occupant 방해요소에 cause('adjacentMatch'|'specialEffect') 1 피해를 준다.
  // resolution.obstacleDamagedKeys는 cascadeIndex별 Set<"row,col">으로, "한 해결 단계에서
  // 같은 방해요소는 최대 1 피해"를 보장한다(docs/balance.md 7-2) - 같은 단계 안에서 매치
  // adjacentMatch와 특수 잼 specialEffect가 둘 다 같은 칸을 때려도 1번만 맞는다.
  _damageObstacles(resolution, cells, cascadeIndex, cause) {
    if (!this.obstaclesRegistry || cells.length === 0) return;
    if (!resolution.obstacleDamagedKeys) resolution.obstacleDamagedKeys = new Map();
    let seen = resolution.obstacleDamagedKeys.get(cascadeIndex);
    if (!seen) {
      seen = new Set();
      resolution.obstacleDamagedKeys.set(cascadeIndex, seen);
    }
    const effects = damageOccupantsInCells(this.board, this.obstaclesRegistry, cells, seen, cause);
    for (const effect of effects) this._pushEffect({ ...effect, cascadeIndex, durationMs: 1 });
  }

  // 칸 하나를 즉시 'clearing'으로 커밋한다(board.set(EMPTY), 점수 가산, cellDetonate 발행).
  // cs는 {value, special}만 있으면 된다(armed cellState 전체여도, _armCell의 즉시경로가 만든
  // 임시 객체여도 상관없다).
  _commitCellClear(resolution, cell, cs, cascadeIndex) {
    const { board } = this;
    const idx = board.index(cell.row, cell.col);

    // attachment(시한폭탄)가 붙은 잼이 어떤 이유로든 지워지면 해제된다(damagedBy: gemCleared,
    // docs/balance.md 7-2). obstacleExpire로 지워지는 칸은 그 이벤트가 이미 연출을 맡으므로
    // 여기서 또 obstacleDestroyed를 띄우지 않는다(중복 연출 방지).
    if (this.obstaclesRegistry && board.attachments[idx]) {
      const type = board.attachments[idx].type;
      board.attachments[idx] = null;
      if (cs.cause !== 'obstacleExpire') {
        this._pushEffect({
          type: 'obstacleDestroyed',
          id: type,
          cell: { row: cell.row, col: cell.col },
          cause: 'gemCleared',
          cascadeIndex,
          durationMs: 1,
        });
      }
    }

    board.set(cell.row, cell.col, EMPTY);
    board.setSpecial(cell.row, cell.col, null);
    board.cellStates[idx] = {
      phase: 'clearing',
      elapsedMs: 0,
      durationMs: ANIMATION_DURATIONS_MS.clear,
      value: cs.value,
      special: cs.special,
      fromRow: null,
      fromCol: null,
      resolutionId: resolution.id,
    };
    this._addWatchCell(resolution, cell);
    this.score += this._scoreForClear(1, cascadeIndex);
    this._pushEffect({ type: 'cellDetonate', cell: { row: cell.row, col: cell.col }, durationMs: 1 });
  }

  // ------------------------------------------------------------
  // 이펙트 큐
  // ------------------------------------------------------------

  _pushEffect(fields) {
    this.effects.push({ ...fields, elapsedMs: 0 });
  }

  // list의 항목들을 한 번에 다 보여주지 않고, 앞 항목이 끝나야 다음 항목이 effects에
  // 들어가도록(= 하나씩 순서대로 재생) 작은 내부 큐로 관리한다. (현재는 호출하는 곳이 없지만,
  // 다음 연출 작업에서 "여러 이펙트를 한 번에 몰아서 재생"해야 하는 경우를 위해 남겨둔다.)
  _pushSequentialEffects(list) {
    if (list.length === 0) return;
    const queue = list.slice();
    const first = queue.shift();
    this.effects.push({ ...first, elapsedMs: 0, _sequentialQueue: queue });
  }

  // ------------------------------------------------------------
  // 재배치
  // ------------------------------------------------------------

  // board.shuffle()의 moves를 그대로 shuffle 이펙트에 실어 렌더가 연출을 재생하게 한다.
  // reduceEffects(§설정 "흔들림/연출 줄이기")가 켜져 있으면 연출 전체 길이를 줄인 값을 쓴다 -
  // 렌더가 그 안에서 페이드아웃->페이드인으로 대체한다(render/animator.js 참고).
  // skipClear는 렌더에게만 의미가 있는 플래그다(core는 연출 길이·단계를 모른다) - 아래
  // shuffleBoard() 주석 참고.
  _shuffleBoard(fixed, skipClear = false) {
    const moves = this.board.shuffle(fixed);
    this._invalidSwapCells = []; // 자리가 통째로 바뀌므로 남아있을 수 있던 참조를 정리.
    const durationMs = this.reduceEffects ? ANIMATION_DURATIONS_MS.shuffleReduced : ANIMATION_DURATIONS_MS.shuffle;
    // seed 기반 RNG만 쓰는 규칙(§규칙) - 연출용 난수(칸별 낙하 시작/속도 지터)도 보드의
    // rng에서 뽑아 effect에 실어 보낸다. 같은 seed면 렌더가 같은 낙하 타이밍을 재생한다.
    const seed = Math.floor(this.board.rng() * 2147483647);
    this._pushEffect({ type: 'shuffle', moves, durationMs, seed, skipClear });
  }

  // 층 전환(다음 스테이지로 이동) 등 "조건 없이" 셔플 연출을 보여주고 싶을 때 호출하는
  // 공개 진입점 - _maybeReshuffle과 같은 연출을 재사용한다(docs에 별도 기획이 없어 기존
  // 셔플 연출을 그대로 입장 연출로도 쓰기로 함 - 보고 사항).
  //
  // skipClear:true면 렌더가 "비우기" 단계(기존 젬이 가라앉으며 페이드아웃)를 건너뛰고 낙하만
  // 재생한다 - 입장에는 치울 이전 보드가 없어서, 그 단계를 그대로 쓰면 방금 만든 보드가
  // 내려가며 사라졌다가 다시 위에서 떨어지는 것처럼 보인다. 재배치(수가 없을 때)는 기본값
  // false로 두 단계를 모두 쓴다.
  shuffleBoard({ skipClear = false } = {}) {
    const fixed = this.obstaclesRegistry ? occupantIndices(this.board) : undefined;
    this._shuffleBoard(fixed, skipClear);
  }

  // 활성 Resolution이 하나도 없는 상태로 막 전이한 틱에만(edge-triggered) 호출된다.
  _maybeReshuffle() {
    const { board } = this;
    // occupant 칸을 낀 스왑은 "가능한 수"로 치지 않는다 - 실제로 둘 수 없으므로(swappable:false).
    const canSwap = this.obstaclesRegistry
      ? (r1, c1, r2, c2) =>
          isSwappable(board, this.obstaclesRegistry, r1, c1) && isSwappable(board, this.obstaclesRegistry, r2, c2)
      : undefined;
    // 컬러 잼이 보드에 남아있으면 어떤 인접 스왑도 항상 유효한 수이므로 재배치가 필요 없다.
    const hasColorGem = board.specials.some((s) => s?.kind === SPECIAL_KIND.COLOR);
    if (!hasColorGem && !hasAnyValidMove(board, canSwap)) {
      // occupant 칸은 재배치에서도 보존한다(board.shuffle이 그 칸은 from===to로 그대로 둠).
      const fixed = this.obstaclesRegistry ? occupantIndices(board) : undefined;
      this._shuffleBoard(fixed);

      // occupant가 보드를 너무 막아서 재배치를 해도 여전히 가능한 수가 없으면 "실패"로 센다.
      // 3번 연속 실패하면 hp가 가장 낮은 occupant 1개를 없애 막힌 보드를 풀어준다(docs/balance.md 7-2).
      if (this.obstaclesRegistry) {
        if (!hasAnyValidMove(board, canSwap)) {
          this._obstacleReshuffleFailures += 1;
          if (this._obstacleReshuffleFailures >= 3) {
            const removed = removeLowestHpOccupant(board);
            this._obstacleReshuffleFailures = 0;
            if (removed) {
              this._pushEffect({ type: 'obstacleDestroyed', id: removed.type, cell: { row: removed.row, col: removed.col }, cause: 'noMoves', durationMs: 1 });
            }
          }
        } else {
          this._obstacleReshuffleFailures = 0;
        }
      }
    }
  }
}
