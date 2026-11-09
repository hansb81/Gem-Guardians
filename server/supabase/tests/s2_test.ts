// S2 결제 기록 테스트(PGlite, s1_test.ts와 같은 방식). 실행: deno test -A server/supabase/tests
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { findRcTx, keyOfStoreProductId, notifyText } from "../functions/_shared/iap.ts";

const dir = new URL("../migrations/", import.meta.url);
const STUB = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await db.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const id of [A, B]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.players (id) values ($1)", [id]);
  }
  return db;
}

type R = Record<string, unknown>;
const record = async (db: PGlite, who: string, order: string, status = "verified", key = "dia.0") =>
  (await db.query<{ r: R }>("select public.iap_record($1, 'play', $2, 'gg_dia_0', $3, null, 1200, $4, '{}') r",
    [who, key, order, status])).rows[0].r;
const hook = async (db: PGlite, eventId: string, type: string, order: string, who: string | null = A, key = "dia.0") =>
  (await db.query<{ r: R }>("select public.iap_webhook($1, $2, 'play', $3, $4, $5, 'gg_dia_0', 1200, '{}') r",
    [eventId, type, order, who, key])).rows[0].r;
const row = async (db: PGlite, order: string) =>
  (await db.query<R>("select * from public.purchases where order_id = $1", [order])).rows[0];

Deno.test("verify: 같은 주문 두 번 -> 줄 하나, 두 번째는 fresh 아님", async () => {
  const db = await setup();
  const r1 = await record(db, A, "GPA.1");
  assertEquals([r1.ok, r1.txId, r1.fresh], [true, "iap:dia.0:GPA.1", true]);
  const r2 = await record(db, A, "GPA.1");
  assertEquals([r2.ok, r2.fresh], [true, false]);
  assertEquals((await db.query("select 1 from public.purchases")).rows.length, 1);
});

Deno.test("verify: 다른 플레이어가 같은 주문 -> owner, 원래 주인 그대로", async () => {
  const db = await setup();
  await record(db, A, "GPA.2");
  assertEquals((await record(db, B, "GPA.2")).reason, "owner");
  assertEquals((await row(db, "GPA.2")).player_id, A);
});

Deno.test("verify: 못 찾음(pending) -> notFound, 다음 확인 때 verified로 올라감", async () => {
  const db = await setup();
  assertEquals((await record(db, A, "GPA.3", "pending")).reason, "notFound");
  const r = await record(db, A, "GPA.3", "verified");
  assertEquals([r.ok, r.fresh], [true, true]);
  assertEquals((await row(db, "GPA.3")).status, "verified");
});

Deno.test("granted: granted_at 기록, 남의 것은 안 바뀜", async () => {
  const db = await setup();
  await record(db, A, "GPA.4");
  const got = { diamonds: 120 }; // 첫 구매 2배
  await db.query("select public.iap_granted($1, $2, $3)", [B, "iap:dia.0:GPA.4", got]);
  assertEquals((await row(db, "GPA.4")).granted_at, null);
  await db.query("select public.iap_granted($1, $2, $3)", [A, "iap:dia.0:GPA.4", got]);
  const p = await row(db, "GPA.4");
  assertEquals(p.status, "granted");
  assertEquals(p.granted_bundle, got);
  assert(p.granted_at);
});

Deno.test("웹훅: 같은 이벤트 두 번 -> duplicate, 기기 verify와 합쳐도 줄 하나·알림 한 번", async () => {
  const db = await setup();
  assertEquals((await hook(db, "ev1", "NON_RENEWING_PURCHASE", "GPA.5")).fresh, true);
  assertEquals((await hook(db, "ev1", "NON_RENEWING_PURCHASE", "GPA.5")).duplicate, true);
  const r = await record(db, A, "GPA.5");
  assertEquals([r.ok, r.fresh], [true, false]);
  assertEquals((await db.query("select 1 from public.purchases")).rows.length, 1);
  // 모르는 타입은 기록만
  assertEquals((await hook(db, "ev2", "TEST", "GPA.5")).ok, true);
  assertEquals((await db.query("select 1 from public.server_log where source = 'webhook-revenuecat'")).rows.length, 2);
});

Deno.test("웹훅: 주인 모르는 결제 -> 기기 verify가 주인을 붙임", async () => {
  const db = await setup();
  await hook(db, "ev3", "NON_RENEWING_PURCHASE", "GPA.6", null);
  assertEquals((await record(db, B, "GPA.6")).ok, true);
  assertEquals((await row(db, "GPA.6")).player_id, B);
});

Deno.test("환불: CANCELLATION -> refunded, 다시 verify 해도 refunded, 뷰에 보임", async () => {
  const db = await setup();
  await record(db, A, "GPA.7", "verified", "pack.adfree");
  await hook(db, "ev4", "CANCELLATION", "GPA.7", A, "pack.adfree");
  const p = await row(db, "GPA.7");
  assertEquals(p.status, "refunded");
  assert(p.refunded_at);
  assertEquals((await record(db, A, "GPA.7", "verified", "pack.adfree")).reason, "refunded");
  assertEquals((await db.query("select * from public.v_refunds")).rows.length, 1);
  await record(db, A, "GPA.8");
  const sales = (await db.query<{ n: number; krw: number }>("select n::int, krw::int from public.v_sales_daily")).rows;
  assertEquals(sales, [{ n: 1, krw: 1200 }]); // 환불 건은 매출에서 빠짐
  // 기록 없던 주문의 환불도 줄로 남는다
  await hook(db, "ev5", "CANCELLATION", "GPA.9");
  assertEquals((await row(db, "GPA.9")).status, "refunded");
});

Deno.test("분당 호출 제한: 한도 넘으면 false, 함수·플레이어별 따로", async () => {
  const db = await setup();
  const hit = async (who: string, fn: string) =>
    (await db.query<{ r: boolean }>("select public.rate_hit($1, $2, 3) r", [who, fn])).rows[0].r;
  for (let i = 0; i < 3; i++) assertEquals(await hit(A, "iap-verify"), true);
  assertEquals(await hit(A, "iap-verify"), false);
  assertEquals(await hit(A, "hello"), true);
  assertEquals(await hit(B, "iap-verify"), true);
});

Deno.test("me_delete: purchases는 남기고 연결만 끊음", async () => {
  const db = await setup();
  await record(db, A, "GPA.10");
  await db.query("select public.me_delete($1)", [A]);
  assertEquals((await row(db, "GPA.10")).player_id, null);
});

Deno.test("권한: 클라이언트는 purchases·뷰·결제 함수 못 씀", async () => {
  const db = await setup();
  await record(db, A, "GPA.11");
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';`);
  await assertRejects(() => db.query("select * from public.purchases"));
  await assertRejects(() => db.query("select * from public.v_sales_daily"));
  await assertRejects(() => db.query("select public.iap_record($1,'dev','dia.0',null,'x',null,0,'verified','{}')", [A]));
  await db.exec("reset role;");
});

Deno.test("RevenueCat 응답에서 거래 찾기", () => {
  const sub = { subscriber: { non_subscriptions: { gg_dia_0: [{ id: "rc1", store_transaction_id: "GPA.1" }] } } };
  assertEquals(findRcTx(sub, "gg_dia_0", "GPA.1")?.id, "rc1");
  assertEquals(findRcTx(sub, "gg_dia_0", "rc1")?.id, "rc1");
  assertEquals(findRcTx(sub, "gg_dia_0", "GPA.2"), null);
  assertEquals(findRcTx(sub, "other", "GPA.1"), null);
  assertEquals(findRcTx({}, "gg_dia_0", "GPA.1"), null);
});

Deno.test("알림 문구 / 스토어 상품 id 역매핑", () => {
  assertEquals(notifyText("play", "dia.0", 1200, A), "[Play] dia.0 ₩1,200 · 플레이어 00000000");
  assertEquals(keyOfStoreProductId("play", "없는상품"), null);
});

Deno.test("ping: IP당 분당 10회, 다른 IP는 따로", async () => {
  const db = await setup();
  const hit = async (ip: string) => (await db.query<{ r: boolean }>("select public.ping_hit($1) r", [ip])).rows[0].r;
  for (let i = 0; i < 10; i++) assertEquals(await hit("1.2.3.4"), true);
  assertEquals(await hit("1.2.3.4"), false);
  assertEquals(await hit("5.6.7.8"), true);
});

Deno.test("gh-keepalive 익명 사용자 삭제(마이그레이션 다시 실행)", async () => {
  const db = await setup();
  const K = "00000000-0000-0000-0000-0000000000cc";
  await db.query("insert into auth.users values ($1)", [K]);
  await db.query("insert into public.players (id, legacy_id) values ($1, 'gh-keepalive')", [K]);
  await db.exec("delete from auth.users where id in (select id from public.players where legacy_id = 'gh-keepalive');");
  assertEquals((await db.query("select 1 from public.players where id = $1", [K])).rows.length, 0);
  assertEquals((await db.query("select 1 from public.players")).rows.length, 2); // A, B는 그대로
});
