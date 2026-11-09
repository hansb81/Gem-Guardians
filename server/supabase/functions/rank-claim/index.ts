// POST /rank-claim {seasonId} -> claims 'rank:{seasonId}' 한 번 { ok, txId, bundle }. 지급은 기기 inventory.grant + claims-granted.
// config/ranking.json rewardsEnabled가 false면 'disabled'(보상 켜는 건 쑹이 정할 때).
import { fail, handle, must } from "../_shared/http.ts";
import { RANKING } from "../_shared/ranking.ts";

handle("rank-claim", async ({ uid, body, db }) => {
  const seasonId = body.seasonId;
  if (typeof seasonId !== "string" || !/^\d{4}-W\d{2}$/.test(seasonId)) return fail("badRequest");
  if (!RANKING.rewardsEnabled) return fail("disabled");
  return must(await db.rpc("rank_claim", { p_player: uid, p_season: seasonId }));
});
