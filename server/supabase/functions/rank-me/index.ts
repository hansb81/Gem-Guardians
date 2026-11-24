// POST /rank-me {mode?, seasonId?} -> 내 기록 { me: {...} | null }.
// normal = { value, at, rank, total } / comp = { value(포인트), sub(도달 웨이브), at, rank, total, pct, tierId } + left(오늘 남은 입장).
// 관리자가 랭킹 숨김(players.rank_hidden)한 본인은 hidden: true - 순위표에는 안 나오고 내 기록만 보인다(docs/admin.md §5-1).
import { fail, handle, must } from "../_shared/http.ts";
import { pctOf, RANKING, tierOf } from "../_shared/ranking.ts";

handle("rank-me", async ({ uid, body, db }) => {
  const hidden = !!must(await db.from("players").select("rank_hidden").eq("id", uid).maybeSingle())?.rank_hidden;
  if (body.mode === "comp") {
    const seasonId = body.seasonId ?? must(await db.rpc("comp_season", { p_at: new Date().toISOString() }));
    if (typeof seasonId !== "string" || !/^\d{4}-W\d{2}$/.test(seasonId)) return fail("badRequest");
    const r = must(await db.rpc("comp_board", { p_season: seasonId }).eq("player_id", uid).maybeSingle()) as
      { points: number; floor: number; at: string; rank: number; total: number } | null;
    // left = 오늘(KST) 남은 경쟁 입장 횟수(ranking.json comp.dailyEntries).
    const left = Math.max(0, RANKING.comp.dailyEntries - Number(must(await db.rpc("comp_used_today", { p_player: uid }))));
    if (!r) return { ok: true, seasonId, left, me: null, ...(hidden && { hidden }) };
    const rank = Number(r.rank);
    const total = Number(r.total);
    return {
      ok: true, seasonId, left,
      me: { value: r.points, sub: r.floor, at: Date.parse(r.at), rank, total, pct: pctOf(rank, total), tierId: tierOf(rank, total)?.id ?? null },
      ...(hidden && { hidden }),
    };
  }
  const me = must(await db.rpc("rank_normal_me", { p_player: uid })) as
    { value: number; at: string; rank: number; total: number } | null;
  return { ok: true, me: me && { ...me, at: Date.parse(me.at) }, ...(hidden && { hidden }) };
});
