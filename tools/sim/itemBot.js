// T6 아이템 봇(docs/items.md 4장 "아이템 사용 봇"). 사용 제한·실행은 게임의 ItemController를 그대로
// 쓰고, 여기서는 "언제 어떤 아이템을 쓸지"와 "층 시작 전에 무엇을 살지"만 정한다.
// 봇이 쓰는 아이템 = 기본 장착 3개(가로 낫, 망치, 수리 망치) + 20층 보스 뒤 4번째 슬롯(모래시계).
// 무지개 결정·교환 장갑·세로 낫은 봇이 쓰지 않는다(판단 규칙이 복잡해 효과를 과소평가할 수 있음 - 보고).
import { itemPrice } from '../../src/core/economy/economy.js';

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

  if (can('scythe_h') && alive.some((e) => e.progress >= 0.75 || e.rank === 'boss')) {
    let bestRow = 0;
    let bestScore = -1;
    for (let r = 0; r < board.rows; r++) {
      const colors = {};
      let score = 0;
      for (let c = 0; c < board.cols; c++) {
        const i = board.index(r, c);
        if (board.grid[i] >= 0) colors[board.grid[i]] = (colors[board.grid[i]] ?? 0) + 1;
        if (board.specials[i]) score += 3;
        if (board.attachments[i]?.type === 'timeBomb') score += 3;
      }
      score += Math.max(0, ...Object.values(colors));
      if (score > bestScore) {
        bestScore = score;
        bestRow = r;
      }
    }
    return { id: 'scythe_h', target: { row: bestRow } };
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
