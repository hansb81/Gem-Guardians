// POST /account-merge { ticket, keep:'server'|'device' } -> { ok, movedPurchases } (docs/auth.md §4-3).
// 지금 사용자 = B(Google 연결된 계정, 익명이면 거절). 표 확인 + A 기록 옮기기는 SQL 한 트랜잭션(merge_ticket_redeem),
// 그 뒤 auth.users A 삭제(players A는 cascade). 삭제가 실패해도 합치기는 끝났으므로 ok(server_log에 남김).
import { fail, handle, must } from "../_shared/http.ts";

handle("account-merge", async ({ uid, user, body, db }) => {
  const { ticket, keep } = body;
  if (typeof ticket !== "string" || ticket.length > 64 || (keep !== "server" && keep !== "device")) return fail("badRequest");
  if (user.is_anonymous) return fail("guest");
  const r = must(await db.rpc("merge_ticket_redeem", { p_ticket: ticket, p_to: uid, p_keep: keep })) as
    { ok: boolean; from?: string; movedPurchases?: number; reason?: string };
  if (!r.ok) return r;
  const { error } = await db.auth.admin.deleteUser(r.from!);
  await db.from("server_log").insert({
    source: "account-merge", level: error ? "error" : "info",
    body: { from: r.from, to: uid, keep, movedPurchases: r.movedPurchases, deleteError: error ? String(error.message ?? error) : null },
  });
  return { ok: true, movedPurchases: r.movedPurchases ?? 0 };
});
