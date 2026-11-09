// POST /rank-result {seasonId?} -> 지난 시즌(기본) 내 결과 + 최근 8주 기록.
// { ok, seasonId, settling, result: { rank, pct, tierId, points, rewards, claimed } | null, history: [...] }
// settling = 시즌은 끝났는데 정산 전(끝난 뒤 30분 + cron) - 화면에 "정산 중". 기록이 하나도 없던 시즌은 정산할 게 없어 false.
import { fail, handle, must } from "../_shared/http.ts";
import { hasEntries } from "../_shared/ranking.ts";

const SEASON = /^\d{4}-W\d{2}$/;

handle("rank-result", async ({ uid, body, db }) => {
  let seasonId = body.seasonId as string | undefined;
  if (seasonId != null && (typeof seasonId !== "string" || !SEASON.test(seasonId))) return fail("badRequest");
  seasonId ??= must(await db.rpc("comp_season", { p_at: new Date(Date.now() - 7 * 86400e3).toISOString() })) as string;
  const settled = must(await db.from("seasons_settled").select("season_id").eq("season_id", seasonId).maybeSingle());
  const ended = Date.parse(must(await db.rpc("comp_season_end", { p_season: seasonId })) as string) <= Date.now();
  const rows = must(await db.from("season_results").select("season_id, rank, pct, tier_id, points, rewards, claimed_at")
    .eq("player_id", uid).order("season_id", { ascending: false }).limit(8)) ?? [];
  const shape = (r: (typeof rows)[number]) => ({
    seasonId: r.season_id, rank: r.rank, pct: r.pct, tierId: r.tier_id, points: r.points, rewards: r.rewards, claimed: !!r.claimed_at,
  });
  const mine = rows.find((r) => r.season_id === seasonId);
  return { ok: true, seasonId, settling: ended && !settled && await hasEntries(db, seasonId), result: mine ? shape(mine) : null, history: rows.map(shape) };
});
