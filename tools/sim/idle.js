// --idle: 방치 광산(docs/mine.md) 골드를 T4 진행에 얹는 측정 전용 모델. 규칙(해금·수확·주머니 비용/횟수·레벨 상한·가격)은
// src/core/mine/mine.js 함수를 그대로 부른다. 여기서 정하는 것은 "하루에 무엇을 어떤 순서로 하나"뿐이다.
// shortcut: 보관 상한·광고/다이아 가속·월간 패스·아이템 정제·창고 강화는 없다, 그 영향을 볼 때 추가.
import { defaultMine, syncUnlocks, ratePerHour, harvest, refineGold, upgradeVein, veinCost, maxVeinLevel } from '../../src/core/mine/mine.js';

export const VISIT_HOURS = 8; // 접속 1번 = 8시간 분량 수확
const WALLET = { grant: () => ({ ok: true }) }; // 골드는 호출부(T4)가 더한다

export const newIdleMine = (cfg) => defaultMine(cfg.veins.length);

// 하루 정산: 해금 -> 생산(열린 광맥 시간당 합 x 8 x visits) -> 골드 주머니(살 수 있는 만큼, 먼저) -> 가장 싼 광맥부터 레벨업.
// 남은 원석은 mine.ore에 남아 이월된다. 돌려주는 값 = 그날 받은 골드와 주머니 수.
export function mineDay(cfg, mine, { day, clearedFloor, bestFloor, R, visits }) {
  syncUnlocks(cfg, mine, clearedFloor, 0);
  if (!mine.unlocked) return { gold: 0, pouches: 0 };
  mine.cart += ratePerHour(cfg, mine) * VISIT_HOURS * visits;
  harvest(cfg, mine, { now: 0 });
  const ctx = { now: 0, today: `sim-${day}`, R, bestFloor, inventory: WALLET };
  let gold = 0;
  let pouches = 0;
  for (let r; (r = refineGold(cfg, mine, ctx)).ok; pouches++) gold += r.gold;
  const maxLv = maxVeinLevel(cfg, bestFloor);
  for (;;) {
    let i = -1;
    mine.veins.forEach((lv, k) => {
      if (lv > 0 && lv < maxLv && (i < 0 || veinCost(cfg, lv) < veinCost(cfg, mine.veins[i]))) i = k;
    });
    if (i < 0 || !upgradeVein(cfg, mine, i, ctx).ok) break;
  }
  return { gold, pouches };
}
