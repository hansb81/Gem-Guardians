// POST /iap-verify 본문(입구는 functions/iap-verify/index.ts). 테스트가 가짜 db로 부르려고 여기 둔다(tests/iap_verify_test.ts).
// {store, productKey, orderId, purchaseToken?} -> 마켓 확인 -> purchases 기록 -> { ok, txId, bundle }.
// play|ios = RevenueCat REST(app_user_id = 이 플레이어 id, 기기가 Purchases.logIn으로 맞춤). 못 찾으면 pending + notFound
// (반영 지연 - 기기가 10초 뒤 한 번 더). onestore = 원스토어 V7 구매 조회 + developerPayload, toss = 주문 상태 조회(mTLS).
// 같은 주문을 다른 플레이어가 보내면 owner + server_log warn.
import type { Ctx } from "./http.ts";
import { fail, must } from "./result.ts";
import { findRcTx, notify, notifyText, product, STORES, storeProductId } from "./iap.ts";
import { onestorePayloadOk, verifyOneStore, verifyToss } from "./stores.ts";

const RC_API = "https://api.revenuecat.com/v1/subscribers/";

export async function iapVerify({ uid, body, db }: Pick<Ctx, "uid" | "body" | "db">) {
  const { store, productKey, orderId } = body as Record<string, string>;
  const token = typeof body.purchaseToken === "string" ? body.purchaseToken.slice(0, 2000) : null;
  const prod = typeof productKey === "string" ? product(productKey) : null;
  if (!STORES.includes(store) || !prod || typeof orderId !== "string" || !orderId || orderId.length > 200) {
    return fail("badRequest");
  }
  const txId = `iap:${productKey}:${orderId}`;
  const bundle = prod.grant;

  // 이미 확인된 내 주문(복원·미지급 복구가 매번 다시 부름) -> 마켓 다시 안 묻고 ok.
  // 기록된 상품과 요청 상품이 같아야 한다 - 싼 주문 id에 비싼 productKey를 붙여 그 bundle을 받는 것 방지.
  const had = must(await db.from("purchases").select("player_id, status, product_key").eq("store", store).eq("order_id", orderId).maybeSingle());
  if (had && had.product_key !== productKey) return fail("productMismatch");
  if (had?.player_id === uid && (had.status === "verified" || had.status === "granted")) return { ok: true, txId, bundle };
  if (had?.player_id === uid && had.status === "refunded") return fail("refunded", { txId });

  let status = "pending";
  let raw: unknown = null;
  const spid = storeProductId(productKey, store);
  if (store === "dev") {
    if (Deno.env.get("DEV_IAP") !== "true") return fail("badStore");
    status = "verified";
  } else if (store === "onestore") {
    // 원스토어 어댑터는 purchaseToken을 orderId로 보낸다. 조회와 기록을 같은 값(orderId)으로 - 진짜 토큰 하나에
    // orderId만 바꿔 붙여 가짜 verified 줄을 무한히 만드는 것 방지(purchases unique(store, order_id)가 이 값을 막는다).
    if (token !== null && token !== orderId) return fail("badRequest");
    if (!spid) return fail("unknownProduct");
    const r = await verifyOneStore(spid, orderId);
    ({ status, raw } = r);
    // deno-lint-ignore no-explicit-any
    if (status === "verified" && !onestorePayloadOk((raw as any)?.developerPayload, productKey, uid)) {
      status = "invalid";
      await db.from("server_log").insert({ source: "iap-verify", level: "warn", body: { uid, store, orderId, reason: "payload", raw } });
    }
  } else if (store === "toss") {
    // 상품 id가 없으면 tossStatus가 sku를 비교하지 못해 싼 주문 하나로 아무 상품이나 verified가 된다.
    if (!spid) return fail("unknownProduct");
    ({ status, raw } = await verifyToss(orderId, spid));
  } else {
    if (!spid) return fail("unknownProduct");
    const res = await fetch(RC_API + encodeURIComponent(uid), {
      headers: { Authorization: `Bearer ${Deno.env.get("REVENUECAT_SECRET_KEY")}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`revenuecat ${res.status}`);
    raw = findRcTx(await res.json(), spid, orderId);
    if (raw) status = "verified";
  }

  const r = must(await db.rpc("iap_record", {
    p_player: uid, p_store: store, p_product_key: productKey, p_store_product_id: spid, p_order_id: orderId,
    p_token: token, p_price: prod.priceKRW, p_status: status, p_raw: raw,
  })) as { ok: boolean; reason?: string; fresh?: boolean; txId?: string };
  if (r.reason === "owner") {
    await db.from("server_log").insert({ source: "iap-verify", level: "warn", body: { uid, store, orderId, reason: "owner" } });
  }
  if (r.fresh) await notify(notifyText(store, productKey, prod.priceKRW, uid));
  // 위 확인과 이 기록 사이에 다른 상품으로 들어온 줄(웹훅 등)이면 iap_record의 txId가 다르다.
  if (r.ok && r.txId !== txId) return fail("productMismatch");
  return r.ok ? { ok: true, txId, bundle } : fail(r.reason ?? "error", { txId });
}
