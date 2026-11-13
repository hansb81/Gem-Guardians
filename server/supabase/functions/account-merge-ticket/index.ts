// POST /account-merge-ticket -> { ok, ticket, purchases } (docs/auth.md §4-3). 게스트(익명) A가 Google 로그인으로 B가 되기 직전에
// 받아 두는 10분짜리 1회용 표. 연결된 계정이면 notGuest. purchases = A 결제 수(빈 게스트 판정·충돌 화면).
import { fail, handle, must } from "../_shared/http.ts";

handle("account-merge-ticket", async ({ uid, user, db }) => {
  if (!user.is_anonymous) return fail("notGuest");
  return must(await db.rpc("merge_ticket_new", { p_player: uid }));
});
