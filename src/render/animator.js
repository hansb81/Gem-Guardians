import { EMPTY, OBSTACLE } from '../core/board.js';
import { createRng } from '../core/rng.js';

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

// 셔플 1단계(떨어지기)의 칸별 시작/착지 시각을 계산하는 순수 함수(§셔플 애니메이션) - seed와
// 보드 크기, config/effects.json의 shuffleAnim만으로 결정된다(테스트가 바로 이 함수를 본다).
// 칸마다: 시작 지연 = fallStartMs + (아래에서부터의 행 번호) * rowStaggerMs + seed 기반 지터,
// 낙하 시간 = seed 기반 minMs~maxMs. 그 다음 두 번 보정한다:
// 1) 시작 시각을 열 안에서 아래->위로 단조 증가하게 다짐(지터가 행 간격보다 커도 "맨 아래 행이
//    가장 먼저 시작"이 항상 성립해야 하므로 - 문서의 날 숫자 그대로 쓰면 지터(0~60) > 행
//    간격(45)이라 가끔 역전될 수 있다).
// 2) 착지 시각을 열 안에서 아래->위로 최소 minGapMs 간격이 벌어지게 다짐(위 젬이 아래 젬을
//    추월/겹치지 않게) - 그다음 전체가 fallEndMs를 넘지 않게 넘친 만큼만 낙하 시간을 줄인다.
export function computeShuffleFallTiming(seed, rows, cols, shuffleAnimConfig) {
  const { phases = {}, fall = {} } = shuffleAnimConfig ?? {};
  const fallStartMs = phases.fallStartMs ?? 150;
  const fallEndMs = phases.fallEndMs ?? 860;
  const rowStaggerMs = fall.rowStaggerMs ?? 45;
  const jitterMaxMs = fall.jitterMaxMs ?? 60;
  const minMs = fall.minMs ?? 280;
  const maxMs = fall.maxMs ?? 380;
  const minGapMs = fall.minGapMs ?? 30;

  const rng = createRng(seed ?? 0);
  const timing = new Array(rows * cols);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const jitter = rng() * jitterMaxMs;
      const durationMs = minMs + rng() * (maxMs - minMs);
      const startMs = fallStartMs + (rows - 1 - r) * rowStaggerMs + jitter;
      timing[r * cols + c] = { startMs, durationMs };
    }
  }

  for (let c = 0; c < cols; c++) {
    for (let r = rows - 2; r >= 0; r--) {
      const upper = timing[r * cols + c];
      const lowerStart = timing[(r + 1) * cols + c].startMs;
      if (upper.startMs < lowerStart) upper.startMs = lowerStart;
    }
  }

  for (let i = 0; i < timing.length; i++) {
    timing[i].landMs = timing[i].startMs + timing[i].durationMs;
  }

  for (let c = 0; c < cols; c++) {
    for (let r = rows - 2; r >= 0; r--) {
      const upper = timing[r * cols + c];
      const minLand = timing[(r + 1) * cols + c].landMs + minGapMs;
      if (upper.landMs < minLand) {
        upper.landMs = minLand;
        upper.durationMs = Math.max(1, upper.landMs - upper.startMs);
      }
    }
  }

  for (let i = 0; i < timing.length; i++) {
    const entry = timing[i];
    if (entry.landMs > fallEndMs) {
      entry.landMs = fallEndMs;
      entry.durationMs = Math.max(1, entry.landMs - entry.startMs);
    }
  }

  return timing;
}

// 셔플 이펙트의 "실효 경과 시간". 입장 연출(effect.skipClear)은 §0 비우기 구간이 없으므로 그
// 길이만큼 타임라인을 앞당긴다 - 낙하 그리기/착지 사운드가 모두 이 함수 하나를 거쳐야 서로
// 어긋나지 않는다(gameState.shuffleBoard({skipClear}) 주석 참고).
export function shuffleElapsedMs(effect, shuffleAnimConfig) {
  if (!effect.skipClear) return effect.elapsedMs;
  return effect.elapsedMs + (shuffleAnimConfig?.phases?.clearMs ?? 150);
}

// move 하나를 주어진 칸 타이밍(computeShuffleFallTiming의 한 항목)과 경과 시간으로 위치/스케일로
// 바꾼다. 시작 전이면 null(아직 안 그림). 낙하 중엔 목표 칸보다 (rows+1)칸 위에서 일직선으로
// easeInQuad(중력 가속) 낙하(좌우 흔들림/회전 없음). 착지 후 bounceMs 동안 세로 스케일
// squashScale->1.0 바운스를 "아래 기준"(바닥 고정, row를 0.5*(1-scale)만큼 밀어 올려 보정)으로 준다.
export function computeShuffleFallPose(move, elapsedMs, timing, rows, shuffleAnimConfig) {
  if (!timing || elapsedMs < timing.startMs) return null;
  const land = shuffleAnimConfig?.land ?? {};
  const squashScale = land.squashScale ?? 0.85;
  const bounceMs = land.bounceMs ?? 40;

  if (elapsedMs < timing.landMs) {
    const t = timing.durationMs > 0 ? (elapsedMs - timing.startMs) / timing.durationMs : 1;
    const e = easeInQuad(Math.min(1, Math.max(0, t)));
    const startRow = move.to.row - (rows + 1);
    return { row: startRow + (move.to.row - startRow) * e, col: move.to.col, scale: 1 };
  }

  const bt = bounceMs > 0 ? Math.min(1, (elapsedMs - timing.landMs) / bounceMs) : 1;
  const scale = squashScale + (1 - squashScale) * bt;
  return { row: move.to.row + 0.5 * (1 - scale), col: move.to.col, scale };
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
  // gameState를 같이 넘기면 specialCreate 중인 칸을 idle 렌더링 대신 bounce 오버레이로
  // 대체한다(그 칸은 core가 이미 즉시 커밋해 cellStates가 idle이므로, 여기서 가려주지
  // 않으면 bounce 없이 그냥 조용히 나타나 보인다). specialTransform은 더 이상 여기서
  // 가리지 않는다 - CanvasRenderer가 연쇄 fx의 originGem으로 그린다(manifest.combo).
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

  // getDisplayList가 셔플 이펙트를 발견하면 대신 호출한다 - "비우기(§0) -> 떨어지기(§1) ->
  // 착지 바운스" 연출을 moves로 그린다. effectsConfig는 config/effects.json 전체
  // (settings.reduceMotion/shuffleAnim)를 그대로 받는다(없으면 - 테스트 등 - 연출 없이 최종
  // 배치만 보여준다).
  _getShuffleDisplayList(effect, rows, cols, effectsConfig) {
    const list = [];
    if (effectsConfig?.settings?.reduceMotion) {
      const { fadeOutMs = 150, fadeInMs = 150 } = effectsConfig.shuffleAnim?.reducedMotion ?? {};
      // 입장 연출은 "사라지는" 전반부를 건너뛴다(치울 이전 보드가 없다) - 낙하 경로의
      // shuffleElapsedMs와 같은 발상이지만, 줄인 연출은 clearMs가 아니라 fadeOutMs가 기준이다.
      const elapsed = effect.skipClear ? effect.elapsedMs + fadeOutMs : effect.elapsedMs;
      for (const move of effect.moves) {
        if (move.value === EMPTY || move.value === OBSTACLE) continue;
        if (elapsed < fadeOutMs) {
          const opacity = 1 - elapsed / fadeOutMs;
          list.push({ row: move.from.row, col: move.from.col, value: move.fromValue ?? move.value, special: move.fromValue === undefined ? move.special : move.fromSpecial, opacity, scale: 1 });
        } else {
          const opacity = Math.min(1, (elapsed - fadeOutMs) / fadeInMs);
          list.push({ row: move.to.row, col: move.to.col, value: move.value, special: move.special, opacity, scale: 1 });
        }
      }
      return list;
    }

    const cfg = effectsConfig?.shuffleAnim;
    if (!cfg) {
      for (const move of effect.moves) {
        if (move.value === EMPTY || move.value === OBSTACLE) continue;
        list.push({ row: move.to.row, col: move.to.col, value: move.value, special: move.special, opacity: 1, scale: 1 });
      }
      return list;
    }

    // skipClear면 elapsed가 항상 clearMs 이상이라 아래 §0 블록이 자연히 건너뛰어진다.
    const elapsed = shuffleElapsedMs(effect, cfg);
    const clearMs = cfg.phases?.clearMs ?? 150;

    // §0 비우기 - 기존 칸(from)에서 조금 가라앉으며 페이드아웃.
    if (elapsed < clearMs) {
      const t = clearMs > 0 ? elapsed / clearMs : 1;
      const sinkCells = cfg.clear?.sinkCells ?? 0.3;
      for (const move of effect.moves) {
        // fromValue = 보드 교체(shuffleBoard targetBoard) 때 그 칸에 원래 있던 젬.
        const value = move.fromValue ?? move.value;
        if (value === EMPTY || value === OBSTACLE) continue;
        list.push({
          row: move.from.row + sinkCells * t,
          col: move.from.col,
          value,
          special: move.fromValue === undefined ? move.special : move.fromSpecial,
          opacity: 1 - t,
          scale: 1,
        });
      }
      return list;
    }

    // §1 떨어지기 + 착지 바운스 - 칸별 타이밍은 seed로만 결정되는 순수 함수(테스트 대상).
    const timing = computeShuffleFallTiming(effect.seed, rows, cols, cfg);
    const byColumn = Array.from({ length: cols }, () => []);
    for (const move of effect.moves) {
      if (move.value === EMPTY || move.value === OBSTACLE) continue;
      const pose = computeShuffleFallPose(move, elapsed, timing[move.to.row * cols + move.to.col], rows, cfg);
      if (!pose) continue; // 아직 시작 전 - 그리지 않는다(위 칸이 보드 밖에서 대기).
      const item = { row: pose.row, col: pose.col, value: move.value, special: move.special, opacity: 1, scale: pose.scale };
      list.push(item);
      byColumn[move.to.col].push({ targetRow: move.to.row, item });
    }

    // 같은 열에서 위 젬이 아래 젬을 추월/겹치지 않도록, 아래(큰 행)부터 위로 올라가며
    // 그리기 위치를 한 칸 이상 위로 다진다(데이터는 이미 확정돼 있으니 그리기 좌표만 보정).
    for (const col of byColumn) {
      col.sort((a, b) => a.targetRow - b.targetRow);
      for (let i = col.length - 2; i >= 0; i--) {
        const upper = col[i].item;
        const lower = col[i + 1].item;
        if (upper.row > lower.row - 1) upper.row = lower.row - 1;
      }
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

  // gameState.effects를 CanvasRenderer._drawEffects가 기대하는 { kind: 'glow', ... } 형태로
  // 변환한다. 특수 잼 발동(specialActivate)/조합(comboActivate)/변환(specialTransform)은 더
  // 이상 여기서 도형으로 그리지 않는다 - CanvasRenderer._spawnSpecialFx/_spawnComboFx가 그
  // effect를 보는 즉시 assets/effects 스프라이트 재생 일정을 자체 타이머로 만들어 처리한다
  // (core의 effect 수명보다 스프라이트가 더 오래갈 수 있어서 - README #2~#5 + manifest.combo).
  // 그래서 지금 남은 도형은 특수 잼 생성(specialCreate)의 짧은 글로우 하나뿐이다.
  getEffects(gameState, effectsConfig) {
    const effects = [];
    const flashColor = effectsConfig?.events?.specialCreate?.flash?.color ?? '#ffffff';

    for (const effect of gameState.effects) {
      if (effect.type !== 'specialCreate') continue;
      const t = Math.min(1, effect.elapsedMs / effect.durationMs);
      // 특수 잼 생성: 그 칸 자체의 "뽕" 스케일은 getDisplayList가 처리하고, 여기서는 짧은
      // 빛 번쩍임(글로우)만 덧붙인다. 색은 config/effects.json의
      // events.specialCreate.flash.color에서 읽는다(데이터만 바꿔 교체 가능해야 함).
      effects.push({
        kind: 'glow',
        row: effect.position.row,
        col: effect.position.col,
        opacity: 1 - easeInQuad(t),
        color: flashColor,
      });
    }

    return effects;
  }
}
