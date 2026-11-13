// POST /hello {platform, appVersion, legacyId, tossKey?} -> players 생성/갱신, 서버 시각·KST 날짜, 받을 것 개수, features,
// 시작 정보(docs/auth.md §1-E 1번): save 메타, att(att-status 응답), mail(mail-list 응답), claims(claims-pending 응답).
// mail은 예전엔 안 받은 우편 개수(숫자)였다 - 옛 앱은 시작 때 mail-list를 따로 불러 목록으로 덮으므로 배지만 잠깐 늦다.
import { handle, must } from "../_shared/http.ts";
import { kstDate } from "../_shared/kst.ts";
import { startInfo } from "../_shared/start.ts";
import { ADFREE_KEYS } from "../_shared/iap.ts";

const PLATFORMS = ["web", "toss", "android", "onestore", "ios"];
// 기본 켜진 기능(배포 없이 끄기: supabase secrets set FEATURES='{"cloudSave":false}').
const FEATURES = { cloudSave: true };

handle("hello", async ({ uid, user, body, db }) => {
  const row: Record<string, unknown> = { id: uid, last_seen_at: new Date().toISOString() };
  if (PLATFORMS.includes(body.platform as string)) row.platform = body.platform;
  if (typeof body.legacyId === "string" && body.legacyId.length <= 64) row.legacy_id = body.legacyId;
  // 연결된 로그인 수단(docs/auth.md §5-1 4번) - 익명 표시는 빼고.
  row.linked = [...new Set((user.identities ?? []).map((i) => i.provider).filter((p) => p && p !== "anonymous"))];
  // 토스: getAnonymousKey 값은 해시로만 보관(같은 토스 사용자 찾기·문의 대응용, §5).
  if (body.platform === "toss" && typeof body.tossKey === "string" && body.tossKey && body.tossKey.length <= 256) {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.tossKey));
    row.toss_key_hash = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  must(await db.from("players").upsert(row));
  const start = await startInfo(db, uid);
  let features = {};
  try {
    // 배포 없이 기능 끄기: supabase secrets set FEATURES='{"mail":false}'
    features = JSON.parse(Deno.env.get("FEATURES") ?? "{}");
  } catch { /* 잘못된 값이면 무시 */ }
  // 환불 회수(§7-1): 광고 제거만. 환불된 adFree 주문이 있고 살아 있는 adFree 주문이 없을 때.
  // revokeOrders = 기기가 그 주문(iap:{key}:{orderId})으로 받은 경우에만 회수하게 주문 목록도 준다.
  const adfree = must(await db.from("purchases").select("product_key, order_id, status")
    .eq("player_id", uid).in("product_key", ADFREE_KEYS)) ?? [];
  const refunded = adfree.filter((p) => p.status === "refunded");
  const live = adfree.some((p) => p.status === "verified" || p.status === "granted");
  const revokeOrders = live ? [] : refunded.map((p) => ({ productKey: p.product_key, orderId: p.order_id }));
  const now = Date.now();
  return {
    ok: true, now, today: kstDate(now), pending: start.claims.claims.length, features: { ...FEATURES, ...features },
    revoke: revokeOrders.length ? ["adFree"] : [], revokeOrders, ...start,
  };
});
