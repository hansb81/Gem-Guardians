// POST /rank-top {limit} -> 일반 모드 1~limit위 { entries, total }. 다른 사람 id는 내보내지 않는다.
import { handle, must } from "../_shared/http.ts";

type Row = { player_id: string; nickname: string; statue: string; best_floor: number; reached_at: string; rank: number; total: number };

handle("rank-top", async ({ uid, body, db }) => {
  const limit = Math.min(100, Math.max(1, Number(body.limit) || 100));
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
