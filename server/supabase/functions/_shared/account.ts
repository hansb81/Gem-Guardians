// 계정 삭제(docs/auth.md §6) - me-delete 본문. 테스트가 가짜 db·fetch로 부른다.
import { fail, must } from "./result.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

// 순서: me_delete rpc(기록 삭제 + 결제 익명화 - saves·save_backups·merge_tickets·coupon_tries·rate_calls 포함)
// -> RevenueCat 고객 삭제(비밀 키 있을 때만, 실패해도 계속) -> auth.users 삭제(players는 cascade, purchases는 set null).
// 결제 익명화(player_id null)가 auth.users 삭제보다 먼저 끝난다.
export async function deleteAccount(db: Db, uid: string, { rcSecret = "", fetchFn = fetch }: { rcSecret?: string; fetchFn?: typeof fetch } = {}) {
  must(await db.rpc("me_delete", { p_player: uid }));
  let revenuecat = "skip";
  if (rcSecret) {
    try {
      const r = await fetchFn(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${rcSecret}` },
      });
      revenuecat = r.ok ? "ok" : `http${r.status}`;
    } catch (e) {
      revenuecat = `error:${String(e).slice(0, 80)}`;
    }
  }
  // L4: Apple 로그인 연결이면 여기서 Apple 토큰 취소(appleid.apple.com/auth/revoke, docs/auth.md §7-3).
  const { error } = await db.auth.admin.deleteUser(uid);
  await db.from("server_log").insert({
    source: "me-delete", level: error || (revenuecat !== "ok" && revenuecat !== "skip") ? "warn" : "info",
    body: { uid, revenuecat, deleteError: error ? String(error.message ?? error) : null },
  });
  // 사용자 삭제가 실패하면 기기는 데이터를 남긴 채 다시 시도한다(me_delete는 여러 번 해도 같음).
  return error ? fail("error") : { ok: true };
}
