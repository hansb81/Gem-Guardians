// 결제 확인 공통(docs/server.md §7). products.json = config/products.json 사본(tests/iap.test.js가 같은지 본다).
import products from "./products.json" with { type: "json" };

type Product = { type: string; grant: Record<string, unknown>; priceKRW: number; ids: Record<string, string | null> };
const PRODUCTS = products as unknown as Record<string, Product>;

export const STORES = ["play", "ios", "onestore", "toss", "dev"];
// purchases.store -> products.json ids 키
const IDS_KEY: Record<string, string> = { play: "android", ios: "ios", onestore: "onestore", toss: "toss" };
// RevenueCat 이벤트 store -> purchases.store
export const RC_STORE: Record<string, string> = { PLAY_STORE: "play", APP_STORE: "ios" };

export const product = (key: string): Product | null => (!key.startsWith("_") && PRODUCTS[key]) || null;
export const storeProductId = (key: string, store: string) => product(key)?.ids?.[IDS_KEY[store]] ?? null;
export const keyOfStoreProductId = (store: string, id: string) =>
  Object.keys(PRODUCTS).find((k) => storeProductId(k, store) === id) ?? null;
export const ADFREE_KEYS = Object.keys(PRODUCTS).filter((k) => product(k)?.grant?.adFree);

// RevenueCat GET /v1/subscribers 응답에서 non_subscriptions[상품 id] 중 주문 id가 맞는 거래.
// 기기 orderId = SDK transactionIdentifier(= store_transaction_id), 혹시 RevenueCat 거래 id여도 찾는다.
export function findRcTx(subscriber: unknown, storeProductId: string, orderId: string) {
  // deno-lint-ignore no-explicit-any
  const list = (subscriber as any)?.subscriber?.non_subscriptions?.[storeProductId];
  if (!Array.isArray(list)) return null;
  return list.find((t) => t?.store_transaction_id === orderId || t?.id === orderId) ?? null;
}

const LABEL: Record<string, string> = { play: "Play", ios: "iOS", onestore: "원스토어", toss: "토스", dev: "Dev" };
export const notifyText = (store: string, key: string, price: number | null, playerId: string | null) =>
  `[${LABEL[store] ?? store}] ${key} ₩${(price ?? 0).toLocaleString("en-US")} · 플레이어 ${playerId?.slice(0, 8) ?? "?"}`;

// 결제 알림 한 줄. NOTIFY_URL = 디스코드 웹훅 또는 텔레그램 sendMessage?chat_id=… (둘 다 받게 content·text 같이). 실패는 무시.
export async function notify(text: string) {
  const url = Deno.env.get("NOTIFY_URL");
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* 알림 실패는 결제와 무관 */ }
}
