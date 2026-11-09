// POST /rank-me -> 내 일반 모드 { me: { value, at, rank, total } | null }.
import { handle, must } from "../_shared/http.ts";

handle("rank-me", async ({ uid, db }) => {
  const me = must(await db.rpc("rank_normal_me", { p_player: uid })) as
    { value: number; at: string; rank: number; total: number } | null;
  return { ok: true, me: me && { ...me, at: Date.parse(me.at) } };
});
