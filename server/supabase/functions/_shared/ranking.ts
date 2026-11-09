// 경쟁 랭킹 공통. ranking.json = config/ranking.json 사본(tests/ranking-server.test.js가 같은지 본다).
// 구간 규칙은 src/ranking/tiers.js와 같다(SQL comp_tier도 같은 규칙).
import ranking from "./ranking.json" with { type: "json" };

type Tier = { id: string; rank?: number; pct?: number; rewards: Record<string, unknown>; frame?: string };
export const RANKING = ranking as unknown as { rewardsEnabled: boolean; topLimit: number; tiers: Tier[] };

export const pctOf = (rank: number, total: number) => Math.max(1, Math.ceil((rank * 100) / total));
export function tierOf(rank: number, total: number): Tier | null {
  if (!(rank >= 1) || !(total >= rank)) return null;
  return RANKING.tiers.find((t) => (t.rank != null ? rank <= t.rank : rank <= Math.ceil((total * t.pct!) / 100))) ?? null;
}

// shortcut: 경쟁 모드 점수 규칙이 아직 없어(docs/ranking.md §5-2 가정) 상한은 임시 값 - 넘으면 순위에 안 넣고 보류(verified=false).
// 경쟁 모드 기획이 정해지면 층·시간 대비 점수 표로 바꾼다.
export const COMP_LIMIT = { maxPoints: 10_000_000, maxPointsPerFloor: 100_000, minSecPerFloor: 5 };
export const compScoreOk = (points: number, floor: number, elapsedSec: number) =>
  points <= COMP_LIMIT.maxPointsPerFloor * Math.max(1, floor) && elapsedSec >= COMP_LIMIT.minSecPerFloor * floor;

// 정산할 기록이 있는 시즌인지(comp_settle_due는 comp_best가 있는 시즌만 정산 - 빈 시즌을 "정산 중"으로 두지 않게).
// deno-lint-ignore no-explicit-any
export async function hasEntries(db: any, seasonId: string) {
  const { count } = await db.from("comp_best").select("player_id", { count: "exact", head: true }).eq("season_id", seasonId);
  return (count ?? 0) > 0;
}
