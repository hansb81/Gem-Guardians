// 원스토어·토스 서버 조회(docs/server.md §7-2, §7-3). 결과 status = verified|refunded|invalid|pending + raw(마켓 응답).
// 연결·인증 실패는 던진다 -> iap-verify가 'error'로 답하고 기기는 pendingVerify로 다시 묻는다.

export type StoreResult = { status: string; raw?: unknown };

// ---------- 원스토어 (API V7, SDK V21) ----------
// Secrets: ONESTORE_CLIENT_ID, ONESTORE_CLIENT_SECRET, ONESTORE_ENV = test(sbpp, 검증용) | prod.
const ONE_HOST: Record<string, string> = { test: "https://sbpp.onestore.net", prod: "https://iap-apis.onestore.net" };
const ONE_MARKET = { "x-market-code": "MKT_ONE" };
const oneTokens: Record<string, { token: string; exp: number }> = {}; // 환경별(테스트/운영 토큰은 따로 발급)

function oneEnv() {
  const env = Deno.env.get("ONESTORE_ENV") === "prod" ? "prod" : "test";
  const clientId = Deno.env.get("ONESTORE_CLIENT_ID");
  const secret = Deno.env.get("ONESTORE_CLIENT_SECRET");
  if (!clientId || !secret) throw new Error("onestore secrets missing");
  return { env, host: ONE_HOST[env], clientId, secret };
}

// 토큰 1시간짜리. 10분 넘게 남았으면 재사용(원스토어 안내: 600초 미만이면 새로 발급).
async function oneToken(e: ReturnType<typeof oneEnv>) {
  const c = oneTokens[e.env];
  if (c && c.exp - Date.now() > 600e3) return c.token;
  const res = await fetch(`${e.host}/v7/oauth/token`, {
    method: "POST",
    headers: { ...ONE_MARKET, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: e.clientId, client_secret: e.secret }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`onestore token ${res.status}`);
  const j = await res.json();
  oneTokens[e.env] = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return j.access_token as string;
}

async function oneGet(path: string) {
  const e = oneEnv();
  const res = await fetch(`${e.host}/v7/apps/${encodeURIComponent(e.clientId)}${path}`, {
    headers: { ...ONE_MARKET, "Content-Type": "application/json", Authorization: `Bearer ${await oneToken(e)}` },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401) delete oneTokens[e.env]; // 만료·폐기 -> 다음 호출 때 새로
  return { status: res.status, body: await res.json().catch(() => null) };
}

// 앱 developerPayload = `${productKey}|${플레이어 id 앞 8자}`(src/platform/capacitor/iap/onestore.js, 200byte 제한).
// 서버 로그인 전에 산 것은 `${productKey}|`(플레이어 칸 빔) - 상품만 맞으면 통과.
export function onestorePayloadOk(payload: unknown, productKey: string, uid: string) {
  if (typeof payload !== "string") return false;
  const [key, who = ""] = payload.split("|");
  return key === productKey && (who === "" || who === uid.slice(0, 8));
}

// GET .../purchases/inapp/products/{productId}/{purchaseToken}: purchaseState 0 = 구매완료, 1 = 취소(환불).
// 404 NoSuchData = 없는 토큰(또는 테스트/운영 환경 착오) -> invalid.
export async function verifyOneStore(productId: string, purchaseToken: string): Promise<StoreResult> {
  const r = await oneGet(`/purchases/inapp/products/${encodeURIComponent(productId)}/${encodeURIComponent(purchaseToken)}`);
  if (r.status === 404 || (r.status === 400 && r.body?.error?.code === "NoSuchData")) return { status: "invalid", raw: r.body };
  if (r.status !== 200 || !r.body) throw new Error(`onestore purchase ${r.status} ${JSON.stringify(r.body)}`);
  return { status: r.body.purchaseState === 0 ? "verified" : r.body.purchaseState === 1 ? "refunded" : "invalid", raw: r.body };
}

// 환불(취소) 목록: GET .../voided-purchases?startTime&endTime (최대 과거 1개월), continuationKey로 이어 받기.
// 돌려주는 값 = purchaseToken 목록(= 우리 purchases.order_id, 원스토어 어댑터가 토큰을 주문 번호로 쓴다).
export async function onestoreVoided(sinceMs: number, untilMs = Date.now()): Promise<string[]> {
  const out: string[] = [];
  let key = "";
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ startTime: String(sinceMs), endTime: String(untilMs), maxResults: "100" });
    if (key) q.set("continuationKey", key);
    const r = await oneGet(`/voided-purchases?${q}`);
    if (r.status !== 200 || !r.body) throw new Error(`onestore voided ${r.status} ${JSON.stringify(r.body)}`);
    // 문서 예시 키에 공백이 붙어 있다("voidedPurchaseList ") - 둘 다 받는다.
    const list = r.body.voidedPurchaseList ?? r.body["voidedPurchaseList "] ?? [];
    for (const v of list) if (typeof v?.purchaseToken === "string") out.push(v.purchaseToken);
    key = r.body.continuationKey ?? "";
    if (!key) break;
  }
  return out;
}

// ---------- 토스 (앱인토스 서버 API, mTLS) ----------
// Secrets: TOSS_MTLS_CERT, TOSS_MTLS_KEY (콘솔 개발 > mTLS 인증서의 _public.crt / _private.key PEM 내용 그대로).
// Edge Runtime의 Deno.createHttpClient 클라이언트 인증서가 실제로 붙는 것 확인함(2026-11-09) -> §7-4 Worker 우회 불필요.
const TOSS_API = "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/order/get-order-status";
// deno-lint-ignore no-explicit-any
let tossClient: any = null;

function tossHttp() {
  if (tossClient) return tossClient;
  const cert = Deno.env.get("TOSS_MTLS_CERT");
  const key = Deno.env.get("TOSS_MTLS_KEY");
  if (!cert || !key) throw new Error("toss mTLS secrets missing");
  // deno-lint-ignore no-explicit-any
  tossClient = (Deno as any).createHttpClient({ cert, key });
  return tossClient;
}

// 주문 상태 -> 우리 status. resultType이 SUCCESS가 아니면(실패도 HTTP 200) 던진다 - 한도 초과(4095) 포함.
// sku가 우리 상품과 다르면 invalid(다른 상품 주문으로 비싼 상품 받기 방지).
// deno-lint-ignore no-explicit-any
export function tossStatus(body: any, sku: string | null): StoreResult {
  if (body?.resultType !== "SUCCESS") throw new Error(`toss ${body?.resultType} ${JSON.stringify(body?.error ?? null)}`);
  const s = body.success ?? {};
  if (s.status === "ERROR") throw new Error(`toss status ERROR ${s.reason ?? ""}`);
  if (sku && s.sku && s.sku !== sku) return { status: "invalid", raw: s };
  const status = s.status === "PURCHASED" || s.status === "PAYMENT_COMPLETED" ? "verified"
    : s.status === "REFUNDED" ? "refunded"
    : s.status === "ORDER_IN_PROGRESS" ? "pending"
    : "invalid"; // NOT_FOUND, MINIAPP_MISMATCH, FAILED
  return { status, raw: s };
}

export async function verifyToss(orderId: string, sku: string | null): Promise<StoreResult> {
  const res = await fetch(TOSS_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
    client: tossHttp(),
    signal: AbortSignal.timeout(8000),
  } as RequestInit);
  if (res.status >= 500) throw new Error(`toss http ${res.status}`);
  return tossStatus(await res.json().catch(() => null), sku);
}
