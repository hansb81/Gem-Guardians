// POST /rank-top {mode?, seasonId?, limit} -> 1~limit위 { entries, total, settling? }. 다른 사람 id는 내보내지 않는다.
// mode 'normal'(기본) = 최고 층 / 'comp' = 시즌(기본 이번 주) 최고 1판 포인트 + 구간·테두리.
import { fail, handle, must } from "../_shared/http.ts";
import { hasEntries, tierOf } from "../_shared/ranking.ts";

type Row = { player_id: string; nickname: string; statue: string; best_floor: number; reached_at: string; rank: number; total: number };
type CompRow = { player_id: string; nickname: string; statue: string; points: number; floor: number; at: string; rank: number; total: number };

handle("rank-top", async ({ uid, body, db }) => {
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 100));
  if (body.mode === "comp") {
    const seasonId = body.seasonId ?? must(await db.rpc("comp_season", { p_at: new Date().toISOString() }));
    if (typeof seasonId !== "string" || !/^\d{4}-W\d{2}$/.test(seasonId)) return fail("badRequest");
    const rows = (must(await db.rpc("comp_board", { p_season: seasonId }).order("rank").limit(limit)) ?? []) as CompRow[];
    const total = Number(rows[0]?.total ?? 0);
    const ended = Date.parse(must(await db.rpc("comp_season_end", { p_season: seasonId })) as string) <= Date.now();
    const settled = ended && !!must(await db.from("seasons_settled").select("season_id").eq("season_id", seasonId).maybeSingle());
    return {
      ok: true, seasonId, total, settling: ended && !settled && await hasEntries(db, seasonId),
      entries: rows.map((r) => {
        const t = tierOf(Number(r.rank), total);
        return {
          playerId: null, nickname: r.nickname, statue: r.statue, value: r.points, sub: r.floor, at: Date.parse(r.at),
          rank: Number(r.rank), tierId: t?.id ?? null, frame: t?.frame ?? null, me: r.player_id === uid,
        };
      }),
    };
  }
  const rows = (must(await db.rpc("rank_normal_top", { p_limit: limit })) ?? []) as Row[];
  return {
    ok: true,
    total: Number(rows[0]?.total ?? 0),
    entries: rows.map((r) => ({
      playerId: null, nickname: r.nickname, statue: r.statue, value: r.best_floor, sub: null,
      at: Date.parse(r.reached_at), rank: Number(r.rank), me: r.player_id === uid,
    })),
  };
});
