// T6 아이템 봇(docs/items.md 4장 "아이템 사용 봇"). 사용 제한·실행은 게임의 ItemController를 그대로
// 쓰고, 여기서는 "언제 어떤 아이템을 쓸지"와 "층 시작 전에 무엇을 살지"만 정한다.
// 봇이 쓰는 아이템 = 기본 장착 3개(낫, 망치, 수리 망치) + 20층 보스 뒤 4번째 슬롯(모래시계).
// 무지개 결정·교환 장갑은 봇이 쓰지 않는다(판단 규칙이 복잡해 효과를 과소평가할 수 있음 - 보고).
import { itemPrice } from '../../src/core/economy/economy.js';
import { findCandidateMoves } from './bot.js';

export const SLOT4_ITEM = 'hourglass';
const HAMMER_STOCK = 1; // perFloor 제한 없는 망치는 시한폭탄 해제용이라 1개만 채운다(봇이 더는 안 씀).

// 한 결정 틱에 최대 1개. 우선순위: 수리(성벽 50% 아래) > 모래시계(성벽에 적 2마리 또는 보스 60% 진입)
// > 망치(타이머 2 이하 시한폭탄) > 가로 낫(적이 길 75% 넘었거나 보스가 살아 있을 때, 가장 점수 높은 행).
export function pickItemUse(ctl, gameState, battleState) {
  const can = (id) => ctl.canUse(id).ok;
  const alive = battleState.enemies.filter((e) => e.state === 'alive');
  if (can('repair') && battleState.wallHealth / battleState.wallMaxHealth < 0.5) return { id: 'repair' };

  if (can('hourglass') && !battleState.frozen) {
    const atWall = alive.filter((e) => e.progress >= 1).length;
    const boss = alive.find((e) => e.rank === 'boss');
    if (atWall >= 2 || (boss && boss.progress >= 0.6)) return { id: 'hourglass' };
  }

  const { board } = gameState;
  if (can('hammer')) {
    let best = null;
    for (let i = 0; i < board.attachments.length; i++) {
      const a = board.attachments[i];
      if (a?.type === 'timeBomb' && a.timer <= 2 && (!best || a.timer < best.timer)) {
        best = { timer: a.timer, row: Math.floor(i / board.cols), col: i % board.cols };
      }
    }
    if (best) return { id: 'hammer', target: { row: best.row, col: best.col } };
  }

  // 낫(가로·세로 합침, 2026-11-24): 모든 가로줄·세로줄 중 점수가 가장 높은 줄(같으면 가로 먼저).
  if (can('scythe_h') && alive.some((e) => e.progress >= 0.75 || e.rank === 'boss')) {
    const lineScore = (n, at) => {
      const colors = {};
      let score = 0;
      for (let k = 0; k < n; k++) {
        const i = at(k);
        if (board.grid[i] >= 0) colors[board.grid[i]] = (colors[board.grid[i]] ?? 0) + 1;
        if (board.specials[i]) score += 3;
        if (board.attachments[i]?.type === 'timeBomb') score += 3;
      }
      return score + Math.max(0, ...Object.values(colors));
    };
    let target = { row: 0 };
    let bestScore = -1;
    for (let r = 0; r < board.rows; r++) {
      const sc = lineScore(board.cols, (c) => board.index(r, c));
      if (sc > bestScore) [bestScore, target] = [sc, { row: r }];
    }
    for (let c = 0; c < board.cols; c++) {
      const sc = lineScore(board.rows, (r) => board.index(r, c));
      if (sc > bestScore) [bestScore, target] = [sc, { col: c }];
    }
    return { id: 'scythe_h', target };
  }
  return pickExtraItemUse(can, gameState, battleState, alive);
}

// v13-6 아이템 쓸모 측정용 규칙(나머지 하단 아이템). 기존 봇 장착(가로 낫·망치·수리·모래시계)에는 없는 아이템이라
// 기존 결과는 그대로다(canUse가 장착 안 한 아이템은 false). 실행은 ItemController 그대로, 여기서는 언제·어디에만.
function pickExtraItemUse(can, gameState, battleState, alive) {
  const { board } = gameState;
  const boss = alive.find((e) => e.rank === 'boss');
  const danger = alive.some((e) => e.progress >= 0.75) || !!boss;
  const atWall = alive.filter((e) => e.progress >= 1).length;
  const cells = () => Array.from({ length: board.rows * board.cols }, (_, i) => ({ i, row: Math.floor(i / board.cols), col: i % board.cols }));
  // 방벽: 모래시계와 같은 순간(성벽에 적 2마리 또는 보스가 성벽 도착).
  if (can('barrier') && (atWall >= 2 || (boss && boss.progress >= 1))) return { id: 'barrier' };
  // 분노의 북: 보스가 살아 있거나 살아 있는 적 4마리 이상.
  if (can('drum') && (boss || alive.length >= 4)) return { id: 'drum' };
  if (gameState.resolutions.length > 0) return null; // 아래는 보드가 멈춰 있을 때만
  // 교환 장갑: 붙어 있는 특수 잼 두 개를 강제로 바꿔 조합 발동(위험할 때). 없으면 안 씀.
  if (can('glove') && danger) {
    for (const { i, row, col } of cells()) {
      if (!board.specials[i] || board.occupants[i]) continue;
      for (const [r2, c2] of [[row, col + 1], [row + 1, col]]) {
        if (!board.inBounds(r2, c2)) continue;
        const j = board.index(r2, c2);
        if (board.specials[j] && !board.occupants[j]) return { id: 'glove', target: { a: { row, col }, b: { row: r2, col: c2 } } };
      }
    }
  }
  // 무지개 결정: 보스가 살아 있을 때, 일반 잼 중 가운데에 가장 가까운 칸을 무지개 잼으로(터뜨리는 건 이후 봇 스왑).
  if (can('rainbow') && boss) {
    const mid = (board.rows - 1) / 2;
    const pick = cells().filter(({ i }) => board.grid[i] >= 0 && !board.specials[i] && !board.occupants[i] && !board.attachments[i])
      .sort((x, y) => Math.abs(x.row - mid) + Math.abs(x.col - mid) - (Math.abs(y.row - mid) + Math.abs(y.col - mid)))[0];
    if (pick) return { id: 'rainbow', target: { row: pick.row, col: pick.col } };
  }
  // 염료: 위험할 때, 한 칸을 바꿔 가로·세로로 가장 길게 이어지는 색(3 이상)으로.
  if (can('dye') && danger) {
    let best = null;
    const runAt = (row, col, color) => {
      const same = (r, c) => board.inBounds(r, c) && board.grid[board.index(r, c)] === color && !board.occupants[board.index(r, c)];
      let h = 1;
      for (let c = col - 1; same(row, c); c--) h++;
      for (let c = col + 1; same(row, c); c++) h++;
      let v = 1;
      for (let r = row - 1; same(r, col); r--) v++;
      for (let r = row + 1; same(r, col); r++) v++;
      return Math.max(h, v);
    };
    for (const { i, row, col } of cells()) {
      if (board.grid[i] < 0 || board.occupants[i]) continue;
      for (let color = 0; color < board.typeCount; color++) {
        if (color === board.grid[i]) continue;
        const run = runAt(row, col, color);
        if (run >= 3 && (!best || run > best.run)) best = { run, row, col, color };
      }
    }
    if (best) return { id: 'dye', target: { row: best.row, col: best.col, color: best.color } };
  }
  // 섞기 부적: 위험할 때 둘 수 있는 수가 2개 이하면(0개면 게임이 자동 재배치).
  if (can('shuffle') && danger) {
    const n = findCandidateMoves(gameState).length;
    if (n > 0 && n <= 2) return { id: 'shuffle' };
  }
  return null;
}

// 층 시작 전 구매: 장착한 아이템을 층당 최대(perFloor, 망치는 HAMMER_STOCK)까지 채운다. 가격은 게임의
// itemPrice(최고 도달 층 기준) 그대로. 돌려주는 값 = 쓴 골드.
export function buyItems(configs, inventory, equipped, gold, maxFloor) {
  let spent = 0;
  for (const id of equipped) {
    const want = configs.items.items[id].perFloor ?? HAMMER_STOCK;
    const price = itemPrice(configs, configs.items, id, maxFloor);
    if (price == null) continue; // 다이아 전용.
    while ((inventory[id] ?? 0) < want && gold - spent >= price) {
      inventory[id] = (inventory[id] ?? 0) + 1;
      spent += price;
    }
  }
  return spent;
}
