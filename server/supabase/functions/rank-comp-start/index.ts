// POST /rank-comp-start -> { runId, seasonId, seed, endsAt }. 시즌은 서버가 정한다(시즌 경계에 걸친 판은 시작한 시즌으로).
import { fail, handle, isBanned, must } from "../_shared/http.ts";

handle("rank-comp-start", async ({ uid, db }) => {
  if (await isBanned(uid)) return fail("banned");
  return must(await db.rpc("comp_start", { p_player: uid }));
});
