// 보상 구간(docs/ranking.md 5-3, config/ranking.json tiers). 순수 계산.
// tier = { id, rank?, pct?, rewards: { diamonds?, items?, goldFloorMul? }, frame? } - 표는 좋은 순서.

// 순위 정렬: 값 큰 순, 같으면 먼저 낸 사람(at 작은 쪽)이 위.
export const compareEntries = (a, b) => b.value - a.value || a.at - b.at;

export const pctOf = (rank, total) => Math.max(1, Math.ceil((rank * 100) / total));

// 순위 구간과 비율 구간이 겹치면 더 좋은 쪽 하나만 = 표 위쪽부터 처음 맞는 것.
export function tierOf(tiers, rank, total) {
  if (!(rank >= 1) || !(total >= rank)) return null;
  return tiers.find((t) => (t.rank != null ? rank <= t.rank : rank <= Math.ceil((total * t.pct) / 100))) ?? null;
}

// 바로 위 구간의 마지막 사람을 넘기려면 몇 점 필요한지. values = 나를 포함해 정렬된 전체 값.
// 동점이면 먼저 낸 사람이 위라서 같은 점수로는 못 넘는다 -> 차이 + step(점수 단위).
// 1위거나 위 구간이 없으면 null.
export function nextTierGap(tiers, values, myRank, step = 10) {
  const total = values.length;
  const cur = tierOf(tiers, myRank, total);
  for (let r = myRank - 1; r >= 1; r--) {
    const t = tierOf(tiers, r, total);
    if (t !== cur) return { tierId: t.id, gap: values[r - 1] - values[myRank - 1] + step };
  }
  return null;
}

// 구간 보상 -> inventory.grant 번들. goldFloorMul은 층 기준가(floorGold) 배수.
export function rewardBundle(tier, floorGold = 0) {
  const r = tier?.rewards ?? {};
  const out = {};
  if (r.diamonds) out.diamonds = r.diamonds;
  if (r.goldFloorMul) out.gold = Math.round(r.goldFloorMul * floorGold);
  if (r.items) out.items = { ...r.items };
  return out;
}
