// POST /rank-me {mode?, seasonId?} -> 내 기록 { me: {...} | null }.
// normal = { value, at, rank, total } / comp = { value(포인트), sub(층), at, rank, total, pct, tierId }.
import { fail, handle, must } from "../_shared/http.ts";
import { pctOf, tierOf } from "../_shared/ranking.ts";

handle("rank-me", async ({ uid, body, db }) => {
  if (body.mode === "comp") {
    const seasonId = body.seasonId ?? must(await db.rpc("comp_season", { p_at: new Date().toISOString() }));
    if (typeof seasonId !== "string" || !/^\d{4}-W\d{2}$/.test(seasonId)) return fail("badRequest");
    const r = must(await db.rpc("comp_board", { p_season: seasonId }).eq("player_id", uid).maybeSingle()) as
      { points: number; floor: number; at: string; rank: number; total: number } | null;
    if (!r) return { ok: true, seasonId, me: null };
    const rank = Number(r.rank);
    const total = Number(r.total);
    return {
      ok: true, seasonId,
      me: { value: r.points, sub: r.floor, at: Date.parse(r.at), rank, total, pct: pctOf(rank, total), tierId: tierOf(rank, total)?.id ?? null },
    };
  }
  const me = must(await db.rpc("rank_normal_me", { p_player: uid })) as
    { value: number; at: string; rank: number; total: number } | null;
  return { ok: true, me: me && { ...me, at: Date.parse(me.at) } };
});
