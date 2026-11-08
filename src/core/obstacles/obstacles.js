// 퍼즐 방해요소 오케스트레이션 - 보드/매치/중력/스왑 코드는 고치지 않고, 그 바깥에서
// board.occupants/board.attachments(+ grid의 OBSTACLE 값)만 다룬다(docs/balance.md 7장).
// 이 파일은 방해요소 "종류"를 몰라도 되게(types 데이터 + registry.handler만 본다) 짜여 있다 -
// 새 방해요소는 obstacles.json에 항목을 추가하고(핸들러가 필요하면 handler 파일 하나) registry.js
// HANDLERS에 등록하면 된다. gameState.js가 캐스케이드/타이밍을 조율하고 이 모듈은 순수 헬퍼만 제공.
import { EMPTY, OBSTACLE } from '../board.js';

// ------------------------------------------------------------
// 스왑 가능 여부 / 재배치 보존
// ------------------------------------------------------------

export function isSwappable(board, registry, row, col) {
  const occ = board.occupants[board.index(row, col)];
  if (!occ) return true;
  const typeDef = registry.get(occ.type);
  return typeDef?.swappable !== false;
}

// board.reshuffle(fixedIndices)에 넘길 "손대면 안 되는 칸" 집합 - occupant가 차지한 칸.
export function occupantIndices(board) {
  const set = new Set();
  for (let i = 0; i < board.occupants.length; i++) {
    if (board.occupants[i]) set.add(i);
  }
  return set;
}

// 재배치를 거듭해도 가능한 수가 안 생기면(occupant가 너무 많아 막힌 경우) hp가 가장 낮은
// occupant 1개를 없앤다(동점이면 보드 순서상 먼저 찾은 쪽). 그 자리는 새 잼으로 채운다.
export function removeLowestHpOccupant(board) {
  let bestIdx = -1;
  let bestHp = Infinity;
  for (let i = 0; i < board.occupants.length; i++) {
    const occ = board.occupants[i];
    if (occ && occ.hp < bestHp) {
      bestHp = occ.hp;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return null;
  const type = board.occupants[bestIdx].type;
  board.occupants[bestIdx] = null;
  board.grid[bestIdx] = board.randomType();
  return { row: Math.floor(bestIdx / board.cols), col: bestIdx % board.cols, type };
}

// ------------------------------------------------------------
// 피해
// ------------------------------------------------------------

// cells 중 occupant가 있는 칸에 1 피해(damagedBy에 cause가 있을 때만). seenSet(resolution이
// 캐스케이드 단계마다 새로 만드는 Set<"row,col">)로 "한 해결 단계에서 같은 방해요소는 최대
// 1 피해"를 보장한다. hp가 0이 되면 occupant를 치우고 칸을 비운다(다음 settle에서 중력/리필이
// 자연히 새 잼으로 채운다) - 부서져도 탑 사격은 없다(호출부가 애초에 점수/공격 경로를 타지 않음).
export function damageOccupantsInCells(board, registry, cells, seenSet, cause) {
  const effects = [];
  for (const cell of cells) {
    const idx = board.index(cell.row, cell.col);
    const occ = board.occupants[idx];
    if (!occ) continue;
    const key = `${cell.row},${cell.col}`;
    if (seenSet.has(key)) continue;
    const typeDef = registry.get(occ.type);
    if (!typeDef?.damagedBy?.includes(cause)) continue;
    seenSet.add(key);

    occ.hp -= 1;
    if (occ.hp <= 0) {
      board.occupants[idx] = null;
      board.grid[idx] = EMPTY;
      effects.push({ type: 'obstacleDestroyed', id: occ.type, cell: { row: cell.row, col: cell.col }, cause });
    } else {
      effects.push({ type: 'obstacleDamaged', id: occ.type, cell: { row: cell.row, col: cell.col }, hp: occ.hp, cause });
    }
  }
  return effects;
}

// ------------------------------------------------------------
// 시한폭탄류(attachment) 타이머
// ------------------------------------------------------------

// 유효한 스왑 1회당 한 번 호출된다(연쇄 중에는 호출되지 않음 - gameState.trySwap이 Resolution을
// 막 만든 직후 1번만 부른다). onMove 핸들러가 있는 attachment만 틱이 진행된다(핸들러 없는
// attachment 종류가 생기면 자동으로 제외됨 - 범용).
export function tickAttachmentTimers(board, registry) {
  const expired = [];
  for (let i = 0; i < board.attachments.length; i++) {
    const att = board.attachments[i];
    if (!att) continue;
    const handler = registry.handler(att.type);
    if (!handler?.onMove) continue;
    const result = handler.onMove(att);
    if (result?.expired) {
      expired.push({ row: Math.floor(i / board.cols), col: i % board.cols, instance: att, handler });
    }
  }
  return expired;
}

// ------------------------------------------------------------
// 등장(초기 배치 / everyMoves 스폰)
// ------------------------------------------------------------

function shuffledIndices(rng, n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function countOccupants(board) {
  let n = 0;
  for (const occ of board.occupants) if (occ) n++;
  return n;
}

function countAlive(board, type) {
  let n = 0;
  for (const occ of board.occupants) if (occ?.type === type) n++;
  for (const att of board.attachments) if (att?.type === type) n++;
  return n;
}

// 층 시작 보드(이미 매치 없는 그리드가 채워진 뒤)에 floor.obstacles(floorGen.js가 만든
// { crate: {initial, everyMoves, maxAlive}, stone: {...}, timeBomb: {initial:0, everyMoves,
// timer, wallDamagePct, maxAlive} }) 의 initial 수만큼 배치한다. occupant 먼저, 그다음
// attachment(둘 다 없으면 조용히 넘어간다 - floorObstacles가 비어 있으면 전혀 생성하지 않음).
export function placeInitialObstacles(board, registry, floorObstacles, rng) {
  if (!floorObstacles) return;
  const order = shuffledIndices(rng, board.grid.length);
  let cursor = 0;
  const nextIdx = () => (cursor < order.length ? order[cursor++] : null);

  for (const [type, cfg] of Object.entries(floorObstacles)) {
    const typeDef = registry.get(type);
    if (!typeDef || typeDef.layer !== 'occupant' || !cfg.initial) continue;
    let placed = 0;
    while (placed < cfg.initial && countOccupants(board) < registry.boardCap) {
      const idx = nextIdx();
      if (idx === null) break;
      if (board.occupants[idx] || board.attachments[idx] || board.specials[idx]) continue;
      board.occupants[idx] = { type, hp: typeDef.hp };
      board.grid[idx] = OBSTACLE;
      placed++;
    }
  }

  for (const [type, cfg] of Object.entries(floorObstacles)) {
    const typeDef = registry.get(type);
    if (!typeDef || typeDef.layer !== 'attachment' || !cfg.initial) continue;
    let placed = 0;
    while (placed < cfg.initial) {
      const idx = nextIdx();
      if (idx === null) break;
      if (board.grid[idx] < 0 || board.attachments[idx]) continue;
      board.attachments[idx] = { type, hp: typeDef.hp, timer: cfg.timer, wallDamagePct: cfg.wallDamagePct };
      placed++;
    }
  }
}

// "다음 층"에서 보드를 유지할 때(docs/balance.md 7장) - 종류별로 보드에 남은 수가 새 층
// initial보다 적으면 부족분만 빈 일반 잼 칸(idle, occupant/attachment/특수 잼 없음)에 채운다.
export function topUpInitialObstacles(board, registry, floorObstacles, rng) {
  if (!floorObstacles) return;
  const order = shuffledIndices(rng, board.grid.length);
  let cursor = 0;
  const nextFreeIdx = () => {
    while (cursor < order.length) {
      const idx = order[cursor++];
      if (
        board.grid[idx] >= 0 &&
        board.cellStates[idx] === null &&
        !board.occupants[idx] &&
        !board.attachments[idx] &&
        !board.specials[idx]
      ) return idx;
    }
    return null;
  };
  // placeInitialObstacles와 같은 순서 - occupant 먼저, 그다음 attachment.
  for (const layer of ['occupant', 'attachment']) {
    for (const [type, cfg] of Object.entries(floorObstacles)) {
      const typeDef = registry.get(type);
      if (!typeDef || typeDef.layer !== layer || !cfg.initial) continue;
      for (let missing = cfg.initial - countAlive(board, type); missing > 0; missing--) {
        if (layer === 'occupant' && countOccupants(board) >= registry.boardCap) break;
        const idx = nextFreeIdx();
        if (idx === null) return;
        if (layer === 'occupant') {
          board.occupants[idx] = { type, hp: typeDef.hp };
          board.grid[idx] = OBSTACLE;
        } else {
          board.attachments[idx] = { type, hp: typeDef.hp, timer: cfg.timer, wallDamagePct: cfg.wallDamagePct };
        }
      }
    }
  }
}

function pickRandomTopRowIdleCell(board, rng) {
  const candidates = [];
  for (let c = 0; c < board.cols; c++) {
    const idx = board.index(0, c);
    if (
      board.grid[idx] >= 0 &&
      board.cellStates[idx] === null &&
      !board.occupants[idx] &&
      !board.attachments[idx] &&
      !board.specials[idx]
    ) {
      candidates.push(idx);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

function pickRandomAttachableCell(board, rng) {
  const candidates = [];
  for (let i = 0; i < board.grid.length; i++) {
    if (board.grid[i] >= 0 && board.cellStates[i] === null && !board.attachments[i]) candidates.push(i);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

// 유효한 스왑마다 호출(tickAttachmentTimers와 같은 시점). 타입별 "스왑 N번마다" 카운터를
// counters(gameState가 들고 있는 { [type]: number } - 인스턴스별로 하나씩, 재시작 시 새로
// 만들면 됨)에서 올리고, 차면 1개 생성 후 카운터를 0으로 되돌린다. maxAlive/boardCap을
// 넘으면 이번 기회는 조용히 생략한다(docs/balance.md 7-2 "maxAlive를 넘으면 생성 생략").
export function maybeSpawnOnMove(board, registry, floorObstacles, rng, counters) {
  if (!floorObstacles) return;
  for (const [type, cfg] of Object.entries(floorObstacles)) {
    if (!cfg.everyMoves) continue;
    counters[type] = (counters[type] ?? 0) + 1;
    if (counters[type] < cfg.everyMoves) continue;
    counters[type] = 0;

    const typeDef = registry.get(type);
    if (!typeDef) continue;
    if (countAlive(board, type) >= (cfg.maxAlive ?? Infinity)) continue;

    if (typeDef.layer === 'occupant') {
      if (countOccupants(board) >= registry.boardCap) continue;
      const idx = pickRandomTopRowIdleCell(board, rng);
      if (idx === null) continue;
      board.occupants[idx] = { type, hp: typeDef.hp };
      board.grid[idx] = OBSTACLE;
    } else if (typeDef.layer === 'attachment') {
      const idx = pickRandomAttachableCell(board, rng);
      if (idx === null) continue;
      board.attachments[idx] = { type, hp: typeDef.hp, timer: cfg.timer, wallDamagePct: cfg.wallDamagePct };
    }
  }
}
