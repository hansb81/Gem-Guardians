// POST /webhook-revenuecat (RevenueCat이 부름, JWT 없음 - config.toml verify_jwt=false).
// Authorization 헤더 == REVENUECAT_WEBHOOK_AUTH 확인 -> 이벤트 id로 중복 제거 -> NON_RENEWING_PURCHASE = verified 기록,
// CANCELLATION = 환불 표시, 그 밖 = server_log 기록만. RevenueCat은 60초 안에 200을 기다린다(알림은 5초 제한).
import { db } from "../_shared/auth.ts";
import { keyOfStoreProductId, notify, notifyText, product, RC_STORE } from "../_shared/iap.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_AUTH");
  if (!secret || req.headers.get("Authorization") !== secret) return new Response("unauthorized", { status: 401 });
  // deno-lint-ignore no-explicit-any
  let ev: any;
  try {
    ev = (await req.json())?.event;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!ev?.id) return new Response("no event", { status: 400 });
  try {
    const store = RC_STORE[ev.store] ?? String(ev.store ?? "").toLowerCase();
    const key = ev.product_id ? keyOfStoreProductId(store, ev.product_id) : null;
    // app_user_id = Purchases.logIn 한 서버 플레이어 id. 로그인 전 결제($RCAnonymousID)면 aliases에서 찾는다.
    const ids = [ev.app_user_id, ...(ev.aliases ?? [])].filter((s) => typeof s === "string" && UUID.test(s));
    let player: string | null = null;
    if (ids.length) {
      const { data } = await db.from("players").select("id").in("id", ids).limit(1);
      player = data?.[0]?.id ?? null;
    }
    const { data, error } = await db.rpc("iap_webhook", {
      p_event_id: ev.id, p_type: ev.type, p_store: store, p_order_id: ev.transaction_id ?? null, p_player: player,
      p_product_key: key, p_store_product_id: ev.product_id ?? null, p_price: key ? product(key)!.priceKRW : null, p_raw: ev,
    });
    if (error) throw new Error(JSON.stringify(error));
    if (ev.product_id && !key) {
      await db.from("server_log").insert({ source: "webhook-revenuecat-warn", level: "warn", body: { msg: "unknownProduct", product: ev.product_id, id: ev.id } });
    }
    if (data?.fresh) await notify(notifyText(store, key!, product(key!)!.priceKRW, player));
    return new Response("ok");
  } catch (e) {
    await db.from("server_log").insert({ source: "webhook-revenuecat-error", level: "error", body: { msg: String(e), eventId: ev.id } });
    return new Response("error", { status: 500 }); // 500이면 RevenueCat이 다시 보낸다
  }
});
