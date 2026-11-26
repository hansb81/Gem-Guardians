// iap-verify 본문(_shared/iap_verify.ts) 분기 - 가짜 db, 네트워크 없음. 감사 3·4번(결제 우회) 회귀 방지.
// 실행: deno test -A server/supabase/tests/iap_verify_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { iapVerify } from "../functions/_shared/iap_verify.ts";
import { product, storeProductId } from "../functions/_shared/iap.ts";
import PRODUCTS from "../functions/_shared/products.json" with { type: "json" };

const A = "00000000-0000-0000-0000-00000000000a";
type R = Record<string, unknown>;
const keys = Object.keys(PRODUCTS).filter((k) => !k.startsWith("_"));

// purchases 조회는 had, iap_record는 record를 돌려주는 가짜 db.
function fakeDb(had: R | null, record: R = { ok: true }) {
  const rpc: unknown[] = [];
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: () => Promise.resolve({ data: had, error: null }),
    insert: () => Promise.resolve({ error: null }),
  };
  const db = { from: () => q, rpc: (name: string, args: R) => (rpc.push([name, args]), Promise.resolve({ data: record, error: null })) };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, rpc };
}
const call = (db: unknown, body: R) => iapVerify({ uid: A, body, db: db as never }) as Promise<R>;

// 마켓을 부르면 안 되는 경로 - 부르면 테스트 실패.
globalThis.fetch = () => Promise.reject(new Error("network must not be called"));

Deno.test("원스토어: purchaseToken과 orderId가 다르면 badRequest(진짜 토큰 하나로 가짜 주문 만들기 방지)", async () => {
  const { db, rpc } = fakeDb(null);
  const r = await call(db, { store: "onestore", productKey: "dia.0", orderId: "fake-1", purchaseToken: "real-token" });
  assertEquals(r.reason, "badRequest");
  assertEquals(rpc.length, 0);
});

Deno.test("이미 확인된 내 주문이라도 요청 productKey가 기록과 다르면 productMismatch", async () => {
  const [cheap, dear] = ["dia.0", "dia.5"];
  const { db } = fakeDb({ player_id: A, status: "verified", product_key: cheap });
  const r = await call(db, { store: "play", productKey: dear, orderId: "GPA.1" });
  assertEquals(r, { ok: false, reason: "productMismatch" });
});

Deno.test("이미 확인된 내 주문 + 같은 상품 -> ok, 그 상품 bundle", async () => {
  const { db, rpc } = fakeDb({ player_id: A, status: "verified", product_key: "dia.0" });
  const r = await call(db, { store: "play", productKey: "dia.0", orderId: "GPA.2" });
  assertEquals(r, { ok: true, txId: "iap:dia.0:GPA.2", bundle: product("dia.0")!.grant });
  assertEquals(rpc.length, 0);
});

Deno.test("토스: 상품 id(spid)가 없으면 unknownProduct - sku 비교 없이 verified 되는 것 방지", async () => {
  const key = keys.find((k) => !storeProductId(k, "toss"));
  if (!key) return;
  const { db, rpc } = fakeDb(null);
  const r = await call(db, { store: "toss", productKey: key, orderId: "toss-1" });
  assertEquals(r.reason, "unknownProduct");
  assertEquals(rpc.length, 0);
});

Deno.test("iap_record가 다른 상품 줄(txId)을 돌려주면 productMismatch", async () => {
  Deno.env.set("DEV_IAP", "true");
  try {
    const { db } = fakeDb(null, { ok: true, txId: "iap:dia.0:dev-1" });
    const r = await call(db, { store: "dev", productKey: "dia.5", orderId: "dev-1" });
    assertEquals(r.reason, "productMismatch");
    const ok = await call(fakeDb(null, { ok: true, txId: "iap:dia.5:dev-2" }).db, { store: "dev", productKey: "dia.5", orderId: "dev-2" });
    assertEquals(ok.ok, true);
  } finally {
    Deno.env.delete("DEV_IAP");
  }
});
