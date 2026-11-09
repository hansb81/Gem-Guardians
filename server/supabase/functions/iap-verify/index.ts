// POST /iap-verify {store, productKey, orderId, purchaseToken?} -> 마켓 확인 -> purchases 기록 -> { ok, txId, bundle }.
// play|ios = RevenueCat REST(app_user_id = 이 플레이어 id, 기기가 Purchases.logIn으로 맞춤). 못 찾으면 pending + notFound
// (반영 지연 - 기기가 10초 뒤 한 번 더). 같은 주문을 다른 플레이어가 보내면 owner + server_log warn.
import { fail, handle, must } from "../_shared/http.ts";
import { findRcTx, notify, notifyText, product, STORES, storeProductId } from "../_shared/iap.ts";
import { verifyOneStore, verifyToss } from "../_shared/stores.ts";

const RC_API = "https://api.revenuecat.com/v1/subscribers/";

handle("iap-verify", async ({ uid, body, db }) => {
  const { store, productKey, orderId } = body as Record<string, string>;
  const token = typeof body.purchaseToken === "string" ? body.purchaseToken.slice(0, 2000) : null;
  const prod = typeof productKey === "string" ? product(productKey) : null;
  if (!STORES.includes(store) || !prod || typeof orderId !== "string" || !orderId || orderId.length > 200) {
    return fail("badRequest");
  }
  const txId = `iap:${productKey}:${orderId}`;
  const bundle = prod.grant;

  // 이미 확인된 내 주문(복원·미지급 복구가 매번 다시 부름) -> 마켓 다시 안 묻고 ok.
  const had = must(await db.from("purchases").select("player_id, status").eq("store", store).eq("order_id", orderId).maybeSingle());
  if (had?.player_id === uid && (had.status === "verified" || had.status === "granted")) return { ok: true, txId, bundle };
  if (had?.player_id === uid && had.status === "refunded") return fail("refunded", { txId });

  let status = "pending";
  let raw: unknown = null;
  const spid = storeProductId(productKey, store);
  if (store === "dev") {
    if (Deno.env.get("DEV_IAP") !== "true") return fail("badStore");
    status = "verified";
  } else if (store === "onestore" || store === "toss") {
    const r = store === "onestore" ? await verifyOneStore(spid ?? "", token ?? orderId) : await verifyToss(orderId);
    if (r.status === "notImplemented") return fail("notImplemented");
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
  })) as { ok: boolean; reason?: string; fresh?: boolean };
  if (r.reason === "owner") {
    await db.from("server_log").insert({ source: "iap-verify", level: "warn", body: { uid, store, orderId, reason: "owner" } });
  }
  if (r.fresh) await notify(notifyText(store, productKey, prod.priceKRW, uid));
  return r.ok ? { ok: true, txId, bundle } : fail(r.reason ?? "error", { txId });
});
