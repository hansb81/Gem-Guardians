import { EMPTY, OBSTACLE } from '../core/board.js';
import { ANIMATION_DURATIONS_MS } from '../config/animation.js';
import { DETONATION_CONFIG } from '../config/detonation.js';

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

function easeInQuad(t) {
  return t * t;
}

// specialCreate/specialTransform 오버레이 공통 "뽕" 스케일 곡선(0→1.4→1).
function bounceScale(t) {
  return t < 0.5 ? 1 + 0.4 * (t / 0.5) : 1.4 - 0.4 * ((t - 0.5) / 0.5);
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// center 기준으로 (fromRow,fromCol) 벡터를 반경 radiusScale배로 줄이고 angleRad만큼 돌린
// 지점을 돌려준다(셔플 1단계 "소용돌이"). col을 x, row를 y로 보고 표준 2D 회전행렬을 쓴다.
function rotateAroundCenter(center, fromRow, fromCol, radiusScale, angleRad) {
  const vx = (fromCol - center.col) * radiusScale;
  const vy = (fromRow - center.row) * radiusScale;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    row: center.row + (vx * sin + vy * cos),
    col: center.col + (vx * cos - vy * sin),
  };
}

// board.shuffle()이 내보낸 move 하나를, 셔플 연출 시작(0ms) 기준 경과 시간에서의 위치/균일
// scale로 바꾸는 순수 함수(테스트는 0ms/phases.convergeMs/phases.totalMs 세 지점만 본다 -
// 그 경계들이 서로 이어지는지가 핵심이라 중간 값은 굳이 스냅샷하지 않았다). config는
// config/effects.json의 shuffleAnim(phases/pop/converge/scatter) 그대로 넘기면 된다.
// 단계 0 [0,popMs): 제자리에서 scale 1 -> pop.scale로 커짐(§0 팝).
// 단계 1 [popMs,convergeMs): 중심 쪽으로 끌려가며(반경 1 -> 1-pullRatio) easeInQuad로 최대
//   maxRotationDeg까지 회전(§1 모으기/소용돌이). scale pop.scale -> converge.scale.
// 단계 2 [convergeMs,scatterMs): 1단계가 끝난 지점에서 to 칸으로 easeOutBack 이동 - to.row가
//   클수록(아래 행일수록) scatter.rowStaggerMs만큼 늦게 시작해 위->아래로 차르르 정렬되지만
//   전부 scatterMs에는 도착한다(§2 흩어져 정렬). scale converge.scale -> scatter.scaleTo.
// 단계 3 [scatterMs,totalMs]: to 칸에 고정(scale은 scatter.scaleTo로 유지) - 착지 바운스는
//   이 함수가 책임지지 않는다. CanvasRenderer의 landingSquash 메커니즘을 그대로 재사용한다
//   (낙하 착지와 같은 비대칭 세로 스쿼시이므로 또 만들 필요가 없다).
export function computeShuffleMovePose(move, elapsedMs, config, rows, cols) {
  const { phases, pop, converge, scatter } = config;
  const center = { row: (rows - 1) / 2, col: (cols - 1) / 2 };

  if (elapsedMs < phases.popMs) {
    const t0 = phases.popMs > 0 ? elapsedMs / phases.popMs : 1;
    return { row: move.from.row, col: move.from.col, scale: 1 + (pop.scale - 1) * t0 };
  }

  if (elapsedMs < phases.convergeMs) {
    const t1 = (elapsedMs - phases.popMs) / Math.max(1, phases.convergeMs - phases.popMs);
    const e = easeInQuad(t1);
    const pos = rotateAroundCenter(
      center,
      move.from.row,
      move.from.col,
      1 - converge.pullRatio * e,
      (converge.maxRotationDeg * e * Math.PI) / 180
    );
    return { row: pos.row, col: pos.col, scale: pop.scale + (converge.scale - pop.scale) * t1 };
  }

  const convergeEndPos = rotateAroundCenter(
    center,
    move.from.row,
    move.from.col,
    1 - converge.pullRatio,
    (converge.maxRotationDeg * Math.PI) / 180
  );

  if (elapsedMs < phases.scatterMs) {
    const rowStart = phases.convergeMs + move.to.row * scatter.rowStaggerMs;
    const duration = Math.max(1, phases.scatterMs - rowStart);
    const t2 = Math.min(1, Math.max(0, (elapsedMs - rowStart) / duration));
    const e = easeOutBack(t2);
    return {
      row: convergeEndPos.row + (move.to.row - convergeEndPos.row) * e,
      col: convergeEndPos.col + (move.to.col - convergeEndPos.col) * e,
      scale: converge.scale + (scatter.scaleTo - converge.scale) * e,
    };
  }

  return { row: move.to.row, col: move.to.col, scale: scatter.scaleTo };
}

// 과거의 Animator는 core가 내보낸 이벤트 배열을 큐에 담아 순서대로 재생하면서
// visualGrid/visualSpecials라는 섀도 상태를 직접 들고 있었다. 지금의 core는 더 이상
// 이벤트 배열을 반환하지 않고(시간 기반 + 열 단위 동시 진행), board.cellStates(칸별
// 전환 상태)와 gameState.effects(1회성 연출)를 매 프레임 그대로 노출한다. 그래서 이
// Animator는 상태를 전혀 갖지 않는 뷰 모델 빌더가 됐다 - 매 프레임 core 상태를 읽어서
// 그릴 목록을 새로 계산할 뿐, 자신만의 기억(큐/섀도 그리드)은 없다.
export class Animator {
  constructor() {
    // getNewlyClearingCells 전용 최소 상태 - "지난 프레임에 clearing 중이던 칸"의 인덱스
    // Set 두 개를 번갈아 쓴다(매 프레임 새 Set을 만들지 않으려고 스왑한다). 이 외에는
    // Animator가 여전히 무상태 뷰 모델 빌더다.
    this._prevClearing = new Set();
    this._scratchClearing = new Set();

    // getNewlySettledCells 전용 - "지난 프레임엔 falling/spawning이었는데 이번 프레임엔 idle이
    // 된 칸"을 추리기 위한 동일한 전/후 Set 비교 상태.
    this._prevFalling = new Set();
    this._scratchFalling = new Set();
  }

  // 퍼즐 보드(board) 자체가 새로 만들어졌을 때(층 전환) 호출한다 - "지난 프레임" 기억을
  // 비워 새 보드의 같은 칸 인덱스를 이전 보드 기준으로 오판하지 않게 한다
  // (puzzleBattleBridge.reset()과 같은 이유).
  reset() {
    this._prevClearing.clear();
    this._scratchClearing.clear();
    this._prevFalling.clear();
    this._scratchFalling.clear();
  }

  // { row, col, value, special, opacity, scale } 목록. row/col은 전환 중에는 소수일 수 있다.
  // gameState를 같이 넘기면 specialCreate/specialTransform 중인 칸을 idle 렌더링 대신
  // bounce 오버레이로 대체한다(그 칸들은 core가 이미 즉시 커밋해 cellStates가 idle이므로,
  // 여기서 가려주지 않으면 bounce 없이 그냥 조용히 나타나 보인다).
  getDisplayList(board, gameState, effectsConfig) {
    const { rows, cols, grid, specials, cellStates, attachments } = board;
    const hasAttachments = Array.isArray(attachments);

    // 셔플 연출 중엔 board.cellStates가 전부 idle(= 데이터는 이미 확정됨, §셔플 애니메이션)이라
    // 아래의 평소 경로로는 "이미 다 섞인 최종 모습"이 그냥 나타나 버린다 - moves를 보고 연출
    // 전용 목록을 따로 만들어 완전히 대신한다(다른 오버레이와 동시에 일어나지 않으므로 이 한
    // 효과만 체크하면 충분하다 - 셔플은 보드가 완전히 idle일 때만 트리거된다).
    const shuffleFx = gameState?.effects?.find((e) => e.type === 'shuffle');
    if (shuffleFx) {
      return this._getShuffleDisplayList(shuffleFx, rows, cols, effectsConfig);
    }

    const list = [];
    const bounceOverride = new Set();

    if (gameState) {
      for (const effect of gameState.effects) {
        if (effect.type === 'specialCreate') {
          const t = Math.min(1, effect.elapsedMs / effect.durationMs);
          const scale = bounceScale(t);
          const i = effect.position.row * cols + effect.position.col;
          bounceOverride.add(i);
          list.push({
            row: effect.position.row,
            col: effect.position.col,
            value: effect.color,
            special: { kind: effect.kind, direction: effect.direction },
            opacity: 1,
            scale,
          });
        } else if (effect.type === 'specialTransform') {
          const t = Math.min(1, effect.elapsedMs / effect.durationMs);
          const scale = bounceScale(t);
          for (const cell of effect.cells) {
            const i = cell.row * cols + cell.col;
            bounceOverride.add(i);
            const value = grid[i];
            if (value === EMPTY) continue;
            list.push({
              row: cell.row,
              col: cell.col,
              value,
              special: { kind: effect.kind, direction: cell.direction },
              opacity: 1,
              scale,
            });
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (bounceOverride.has(i)) continue;

        const cs = cellStates[i];
        if (cs === null) {
          const value = grid[i];
          if (value === EMPTY || value === OBSTACLE) continue; // occupant 방해요소 - 잼이 없다.
          list.push({
            row: r,
            col: c,
            value,
            special: specials[i],
            opacity: 1,
            scale: 1,
            attachment: hasAttachments ? attachments[i] : null,
          });
          continue;
        }
        // occupant가 떨어지는 중(falls:true)이면 grid에 OBSTACLE 값이 그대로 실려 있다 -
        // 잼 그리기 목록에는 넣지 않는다(CanvasRenderer의 occupant 전용 패스가 따로 그린다).
        if (cs.value === EMPTY || cs.value === OBSTACLE) continue;

        const t = cs.durationMs > 0 ? Math.min(1, cs.elapsedMs / cs.durationMs) : 1;
        if (cs.phase === 'armed') {
          // 발동 대기 중 - 보드 값은 아직 지워지지 않았으므로 그대로 그리되, 남은 시간
          // 비율(progress)을 실어서 CanvasRenderer._drawGem이 커짐/떨림/글로우를 입히게 한다.
          list.push({
            row: r,
            col: c,
            value: cs.value,
            special: cs.special,
            opacity: 1,
            scale: 1,
            armed: true,
            cause: cs.cause,
            progress: t,
            attachment: hasAttachments ? attachments[i] : null,
          });
        } else if (cs.phase === 'clearing') {
          // 더 이상 줄어들며 사라지는 잼을 그리지 않는다 - CanvasRenderer가 이 칸에
          // pop_{색} 스프라이트(assets/effects)를 재생한다(그 스프라이트가 잼 그림을
          // 이미 포함하고 있다, getNewlyClearingCells 참고).
          continue;
        } else if (cs.phase === 'falling' && cs.bounce) {
          // 무효 스왑 들썩: 원위치(r,c) -> 상대 칸(fromRow/fromCol) -> 원위치를 절반씩
          // 나눠 재생한다. 각 구간이 durationMs/2(=swap 한 번과 같은 길이)를 쓰므로 갔다가
          // 돌아오는 속도가 둘 다 유효 스왑과 같게 느껴진다.
          const leg = cs.durationMs / 2;
          const goingOut = cs.elapsedMs < leg;
          const legT = Math.min(1, (goingOut ? cs.elapsedMs : cs.elapsedMs - leg) / leg);
          const ease = easeOutQuad(legT);
          const startRow = goingOut ? r : cs.fromRow;
          const startCol = goingOut ? c : cs.fromCol;
          const endRow = goingOut ? cs.fromRow : r;
          const endCol = goingOut ? cs.fromCol : c;
          const row = startRow + (endRow - startRow) * ease;
          const col = startCol + (endCol - startCol) * ease;
          list.push({ row, col, value: cs.value, special: cs.special, opacity: 1, scale: 1, attachment: hasAttachments ? attachments[i] : null });
        } else if (cs.phase === 'falling') {
          // 중력 낙하와 유효 스왑 재배치를 포괄한다 - fromRow/fromCol에서 지금 칸(r,c)까지
          // 위치만 보간하면 된다.
          const ease = easeOutQuad(t);
          const row = cs.fromRow + (r - cs.fromRow) * ease;
          const col = cs.fromCol + (c - cs.fromCol) * ease;
          list.push({ row, col, value: cs.value, special: cs.special, opacity: 1, scale: 1, attachment: hasAttachments ? attachments[i] : null });
        } else if (cs.phase === 'spawning') {
          // fromRow/fromCol이 null이므로, 과거 Animator의 spawn 오버레이와 동일하게
          // "한 칸 위에서 내려오는" 것으로 처리한다.
          const ease = easeOutQuad(t);
          const startRow = r - 1;
          const row = startRow + (r - startRow) * ease;
          list.push({ row, col: c, value: cs.value, special: cs.special, opacity: 1, scale: 1 });
        }
      }
    }

    return list;
  }

  // getDisplayList가 셔플 이펙트를 발견하면 대신 호출한다 - moves를 computeShuffleMovePose로
  // 보간해 그릴 목록을 만든다. effectsConfig는 config/effects.json 전체(settings.reduceMotion/
  // shuffleAnim)를 그대로 받는다(없으면 - 테스트 등 - 연출 없이 최종 배치만 보여준다).
  _getShuffleDisplayList(effect, rows, cols, effectsConfig) {
    const list = [];
    if (effectsConfig?.settings?.reduceMotion) {
      const { fadeOutMs = 150, fadeInMs = 150 } = effectsConfig.shuffleAnim?.reducedMotion ?? {};
      for (const move of effect.moves) {
        if (move.value === EMPTY || move.value === OBSTACLE) continue;
        if (effect.elapsedMs < fadeOutMs) {
          const opacity = 1 - effect.elapsedMs / fadeOutMs;
          list.push({ row: move.from.row, col: move.from.col, value: move.value, special: move.special, opacity, scale: 1 });
        } else {
          const opacity = Math.min(1, (effect.elapsedMs - fadeOutMs) / fadeInMs);
          list.push({ row: move.to.row, col: move.to.col, value: move.value, special: move.special, opacity, scale: 1 });
        }
      }
      return list;
    }

    const cfg = effectsConfig?.shuffleAnim;
    for (const move of effect.moves) {
      if (move.value === EMPTY || move.value === OBSTACLE) continue;
      if (!cfg) {
        list.push({ row: move.to.row, col: move.to.col, value: move.value, special: move.special, opacity: 1, scale: 1 });
        continue;
      }
      const pose = computeShuffleMovePose(move, effect.elapsedMs, cfg, rows, cols);
      list.push({ row: pose.row, col: pose.col, value: move.value, special: move.special, opacity: 1, scale: pose.scale });
    }
    return list;
  }

  // occupant 방해요소(상자/돌) 그리기 목록 - { row, col, occupant: {type, hp} }. getDisplayList와
  // 분리한 이유: occupant는 grid에 OBSTACLE 값만 들고 있어(잼이 아님) 잼 목록에서는 걸러지므로,
  // CanvasRenderer가 상자/돌 스프라이트를 그릴 땐 이 목록을 따로 읽는다. occupant는 armed/
  // clearing/spawning 애니메이션이 없다(부서짐은 즉시, 생성은 등장 스케줄로만) - falls:true로
  // 떨어지는 중일 때만 getDisplayList의 'falling'과 같은 위치 보간이 필요하다.
  getObstacleDisplayList(board) {
    const { rows, cols, occupants, cellStates } = board;
    if (!Array.isArray(occupants)) return [];
    const list = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const occ = occupants[i];
        if (!occ) continue;

        const cs = cellStates[i];
        if (cs === null) {
          list.push({ row: r, col: c, occupant: occ });
          continue;
        }
        if (cs.phase !== 'falling' || cs.bounce) continue; // occupant는 무효 스왑 들썩이 없다.
        const t = cs.durationMs > 0 ? Math.min(1, cs.elapsedMs / cs.durationMs) : 1;
        const ease = easeOutQuad(t);
        const row = cs.fromRow + (r - cs.fromRow) * ease;
        const col = cs.fromCol + (c - cs.fromCol) * ease;
        list.push({ row, col, occupant: occ });
      }
    }

    return list;
  }

  // "지난 프레임엔 clearing이 아니었는데 이번 프레임에 clearing이 된" 칸만 추려서 돌려준다
  // (일반 매치 제거 파편 파티클의 스폰 트리거). core는 clearing을 effects 배열이 아니라
  // board.cellStates로만 표현하므로, "방금 시작됐다"를 알아내려면 이전 프레임 기억이
  // 필요하다 - Animator에 남겨둔 유일한 상태가 이 용도다.
  getNewlyClearingCells(board) {
    const { cols, cellStates } = board;
    const newly = [];
    const curr = this._scratchClearing;
    curr.clear();

    for (let i = 0; i < cellStates.length; i++) {
      const cs = cellStates[i];
      if (!cs || cs.phase !== 'clearing') continue;
      curr.add(i);
      if (!this._prevClearing.has(i)) {
        newly.push({ row: Math.floor(i / cols), col: i % cols, value: cs.value, special: cs.special });
      }
    }

    this._scratchClearing = this._prevClearing;
    this._prevClearing = curr;
    return newly;
  }

  // "지난 프레임엔 falling/spawning이었는데 이번 프레임엔 idle(cellStates===null)이 된" 칸만
  // 추려서 돌려준다(낙하 착지 스쿼시 트리거, §11). getNewlyClearingCells와 완전히 같은 전/후
  // Set 비교 패턴.
  getNewlySettledCells(board) {
    const { cols, cellStates } = board;
    const newly = [];
    const curr = this._scratchFalling;
    curr.clear();

    for (let i = 0; i < cellStates.length; i++) {
      const cs = cellStates[i];
      if (cs && (cs.phase === 'falling' || cs.phase === 'spawning')) {
        curr.add(i);
      } else if (this._prevFalling.has(i)) {
        newly.push({ row: Math.floor(i / cols), col: i % cols });
      }
    }

    this._scratchFalling = this._prevFalling;
    this._prevFalling = curr;
    return newly;
  }

  // gameState.effects를 CanvasRenderer._drawEffects가 기대하는
  // { kind: 'beamRow'|'beamCol'|'burst'|'wipe'|'flash'|'glow'|'projectile', ... } 형태로
  // 변환한다.
  getEffects(gameState, effectsConfig) {
    const effects = [];
    const flashColor = effectsConfig?.events?.specialCreate?.flash?.color ?? '#ffffff';
    const transformGlowColor = effectsConfig?.events?.specialTransform?.glow?.color ?? flashColor;

    for (const effect of gameState.effects) {
      const t = Math.min(1, effect.elapsedMs / effect.durationMs);

      if (effect.type === 'specialActivate') {
        // line/bomb/box(일반)/color 발동 연출은 더 이상 여기서 도형으로 그리지 않는다 -
        // CanvasRenderer._spawnSpecialFx가 이 effect를 보는 즉시 assets/effects 스프라이트
        // 재생 일정을 자체 타이머로 만들어 처리한다(core의 specialActivate.durationMs보다
        // 스프라이트가 더 오래갈 수 있어서 - README #2/#3/#4/#5, 점 4).
        // 예외: box+color 조합이 noActivate 변환 대신 터뜨리는 랜덤 박스 타겟(color!=null로
        // 구분됨, gameState.js 참고)은 조합 전용 경로라 손대지 않는다(§5) - 기존 투사체 연출을
        // 그대로 유지한다(CanvasRenderer._spawnSpecialFx도 같은 조건으로 건너뛴다).
        if (effect.kind === 'box' && effect.color != null) {
          const flightMs = ANIMATION_DURATIONS_MS.clear;
          if (effect.elapsedMs < flightMs) {
            const flightT = effect.elapsedMs / flightMs;
            for (const cell of effect.affected) {
              if (cell.row === effect.position.row && cell.col === effect.position.col) continue;
              effects.push({
                kind: 'projectile',
                fromRow: effect.position.row,
                fromCol: effect.position.col,
                toRow: cell.row,
                toCol: cell.col,
                t: flightT,
              });
            }
          }
        }
      } else if (effect.type === 'comboActivate') {
        const opacity = 1 - easeInQuad(t);
        const { row, col } = effect.position;
        // 조합 종류별 색은 config/effects.json의 events.comboActivate_<kind>.color에서 읽는다
        // (CanvasRenderer._colorForEffect의 파티클 색과 같은 소스 - 한쪽만 고치면 어긋나는
        // 숨은 결합을 없애기 위함).
        const comboColor = effectsConfig?.events?.[`comboActivate_${effect.comboKind}`]?.color ?? '#ffffff';
        switch (effect.comboKind) {
          case 'line_line':
            effects.push({ kind: 'beamRow', row, opacity, glow: true, color: comboColor });
            effects.push({ kind: 'beamCol', col, opacity, glow: true, color: comboColor });
            break;
          case 'bomb_bomb':
            effects.push({ kind: 'burst', row, col, t, opacity, radiusScale: 2.6, color: comboColor });
            break;
          case 'box_box':
            effects.push({ kind: 'burst', row, col, t, opacity, radiusScale: 2.0, color: comboColor });
            break;
          case 'line_bomb':
            effects.push({ kind: 'beamRow', row, opacity, thickness: 3, color: comboColor });
            effects.push({ kind: 'beamCol', col, opacity, thickness: 3, color: comboColor });
            break;
          case 'color_color':
            effects.push({ kind: 'flash', t, opacity });
            break;
          default:
            // line_color / bomb_color / box_line / box_bomb / box_color: 변환형 조합(선택한
            // 색의 잼들이 다른 특수 잼으로 바뀐 뒤 연쇄 발동)이라 comboActivate 자체는 작은
            // 효과면 충분하다(진짜 볼거리는 뒤따르는 sequential specialActivate/
            // specialTransform들이 처리한다).
            effects.push({ kind: 'wipe', row, col, t, opacity });
            break;
        }
      } else if (effect.type === 'specialCreate') {
        // 특수 잼 생성: 그 칸 자체의 "뽕" 스케일은 getDisplayList가 처리하고, 여기서는
        // 짧은 빛 번쩍임(글로우)만 덧붙인다. 색은 config/effects.json의
        // events.specialCreate.flash.color에서 읽는다(데이터만 바꿔 교체 가능해야 함).
        effects.push({
          kind: 'glow',
          row: effect.position.row,
          col: effect.position.col,
          opacity: 1 - easeInQuad(t),
          color: flashColor,
        });
      } else if (effect.type === 'specialTransform') {
        // 변환되는 칸들이 "하나씩" 빛나는 느낌 - cells 배열의 등장 순서를 인덱스로 간주하고,
        // 실제 core의 변환 스케줄(DETONATION_CONFIG.transformStepMs)과 같은 리듬으로 각 칸의
        // glow 시작 시각을 늦춘다(core가 실제로 그 간격으로 cell을 하나씩 바꾸므로 맞아떨어진다).
        const glowColor = transformGlowColor;
        effect.cells.forEach((cell, i) => {
          const startMs = i * DETONATION_CONFIG.transformStepMs;
          if (effect.elapsedMs < startMs) return;
          const span = Math.max(1, effect.durationMs - startMs);
          const cellT = Math.min(1, (effect.elapsedMs - startMs) / span);
          effects.push({
            kind: 'glow',
            row: cell.row,
            col: cell.col,
            opacity: 1 - easeInQuad(cellT),
            color: glowColor,
          });
        });
      }
      // specialCreate는 위에서 짧은 glow를 추가로 낸다.
    }

    return effects;
  }
}
