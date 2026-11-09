// POST /rank-normal {floor} -> 이전보다 높을 때만 갱신 { ok, updated }. 도달 시각은 서버 시각.
// shortcut: 층 상승 속도 상한(docs/server.md §9 hidden)은 없음 - 서버 랭킹을 일반 사용자에게 공개하기 전에 추가(쑹 2026-11-09).
import { fail, handle, isBanned, must } from "../_shared/http.ts";

handle("rank-normal", async ({ uid, body, db }) => {
  const floor = Number(body.floor);
  if (!Number.isInteger(floor) || floor < 1 || floor > 9999) return fail("badRequest");
  if (await isBanned(uid)) return fail("banned");
  return must(await db.rpc("rank_normal_submit", { p_player: uid, p_floor: floor }));
});
