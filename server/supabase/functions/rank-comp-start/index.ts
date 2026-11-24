// POST /rank-comp-start -> { runId, seasonId, seed, endsAt, left, modifier } | reason 'dailyLimit'(left 0) | 'banned'.
// 시즌·시드는 서버가 정한다(시즌 경계에 걸친 판은 시작한 시즌으로). 하루 입장 = ranking.json comp.dailyEntries(KST 자정 초기화).
// modifier = 이번 시즌 주간 변주(ranking.json comp.modifier, 기본 null - 필드만, 게임 적용은 아직 없음).
import { fail, handle, isBanned, must } from "../_shared/http.ts";
import { RANKING } from "../_shared/ranking.ts";

handle("rank-comp-start", async ({ uid, db }) => {
  if (await isBanned(uid)) return fail("banned");
  const r = must(await db.rpc("comp_start", { p_player: uid, p_daily: RANKING.comp.dailyEntries }));
  return r.ok ? { ...r, modifier: RANKING.comp.modifier ?? null } : r;
});
