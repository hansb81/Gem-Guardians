// S3·S4 테스트(PGlite, s1/s2와 같은 방식): 원스토어·토스 판정, 환불 표시, 경쟁 랭킹·정산·보상, 광고 보상·SSV 서명.
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { onestorePayloadOk, tossStatus } from "../functions/_shared/stores.ts";
import { derToRaw, importKeys, verifySsv } from "../functions/_shared/ads.ts";
import { compScoreOk, pctOf, RANKING, tierOf } from "../functions/_shared/ranking.ts";
import FLOOR_GOLD from "../functions/_shared/floor_gold.json" with { type: "json" };

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
const C = "00000000-0000-0000-0000-00000000000c";

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await db.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const [id, nick] of [[A, "에이"], [B, "비"], [C, null]]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.players (id, nickname) values ($1, $2)", [id, nick]);
  }
  return db;
}

type R = Record<string, unknown>;
const one = async (db: PGlite, sql: string, args: unknown[] = []) => (await db.query<{ r: R }>(sql, args)).rows[0].r;
const record = (db: PGlite, who: string, store: string, order: string, status: string) =>
  one(db, "select public.iap_record($1, $2, 'dia.0', 'gg_dia_0', $3, null, 1200, $4, '{}') r", [who, store, order, status]);
const status = async (db: PGlite, order: string) =>
  (await db.query<{ status: string }>("select status from public.purchases where order_id = $1", [order])).rows[0]?.status;

// ---------- C1·C2 결제 ----------
Deno.test("원스토어 developerPayload: 상품|플레이어 앞 8자, 로그인 전(빈 칸)도 통과", () => {
  assert(onestorePayloadOk(`dia.0|${A.slice(0, 8)}`, "dia.0", A));
  assert(onestorePayloadOk("dia.0|", "dia.0", A));
  assert(!onestorePayloadOk(`dia.0|${A.slice(0, 8)}`, "dia.1", A)); // 싼 상품 결제로 비싼 상품 받기
  assert(!onestorePayloadOk("dia.0|zzzzzzzz", "dia.0", A)); // 남의 결제
  assert(onestorePayloadOk("dia.0", "dia.0", A)); // 예전 형식(상품만) = 상품 칸만 맞으면 통과
  assert(!onestorePayloadOk(null, "dia.0", A));
  assert(new TextEncoder().encode(`pack.adfree|${A.slice(0, 8)}`).length <= 200);
});

Deno.test("토스 주문 상태 -> status, FAIL·ERROR는 던짐(다시 묻기)", () => {
  const ok = (status: string, sku = "gg_dia_0") => tossStatus({ resultType: "SUCCESS", success: { status, sku } }, "gg_dia_0").status;
  assertEquals([ok("PURCHASED"), ok("PAYMENT_COMPLETED"), ok("REFUNDED"), ok("ORDER_IN_PROGRESS")],
    ["verified", "verified", "refunded", "pending"]);
  assertEquals([ok("NOT_FOUND"), ok("MINIAPP_MISMATCH"), ok("FAILED")], ["invalid", "invalid", "invalid"]);
  assertEquals(ok("PURCHASED", "gg_dia_9"), "invalid"); // 다른 상품 주문
  assertThrows(() => tossStatus({ resultType: "FAIL", error: { errorCode: "4095" } }, null));
  assertThrows(() => tossStatus({ resultType: "SUCCESS", success: { status: "ERROR" } }, null));
});

Deno.test("iap_record: refunded·invalid 기록, invalid는 다시 물으면 바뀜, refunded는 고정", async () => {
  const db = await setup();
  assertEquals((await record(db, A, "onestore", "T1", "invalid")).reason, "invalid");
  const r = await record(db, A, "onestore", "T1", "verified");
  assertEquals([r.ok, r.fresh], [true, true]);
  assertEquals((await record(db, A, "toss", "O1", "refunded")).reason, "refunded");
  const row = (await db.query<R>("select refunded_at from public.purchases where order_id = 'O1'")).rows[0];
  assert(row.refunded_at);
  assertEquals((await record(db, A, "toss", "O1", "verified")).reason, "refunded");
});

Deno.test("iap_mark_refunded: 그 마켓 주문만, 이미 환불은 다시 안 셈", async () => {
  const db = await setup();
  await record(db, A, "onestore", "T2", "verified");
  await record(db, A, "toss", "T2", "verified");
  const n = async () => (await db.query<{ n: number }>("select public.iap_mark_refunded('onestore', array['T2','없음']) n")).rows[0].n;
  assertEquals(await n(), 1);
  assertEquals(await n(), 0);
  assertEquals((await db.query<R>("select store, status from public.purchases order by store")).rows,
    [{ store: "onestore", status: "refunded" }, { store: "toss", status: "verified" }]);
});

// ---------- C3 경쟁 랭킹 ----------
Deno.test("시즌 id·끝 시각 = KST ISO 주차, 월 00:00 KST", async () => {
  const db = await setup();
  const q = async (sql: string) => (await db.query<{ v: unknown }>(sql)).rows[0].v;
  assertEquals(await q("select public.comp_season('2026-11-08T14:59:59Z') v"), "2026-W45"); // 일 23:59 KST
  assertEquals(await q("select public.comp_season('2026-11-08T15:00:00Z') v"), "2026-W46"); // 월 00:00 KST
  assertEquals((await q("select public.comp_season_end('2026-W45') v") as Date).toISOString(), "2026-11-08T15:00:00.000Z");
});

Deno.test("경쟁: 시작 -> 끝, 최고 1판만, 끝난 판 다시 못 냄, 남의 판 못 냄", async () => {
  const db = await setup();
  const s = await one(db, "select public.comp_start($1) r", [A]);
  const s2 = await one(db, "select public.comp_start($1) r", [A]);
  assertEquals(s.seed, s2.seed); // 같은 주 = 같은 시드
  const fin = (who: string, run: unknown, pts: number, ok = true) =>
    one(db, "select public.comp_finish($1, $2, $3, 10, null, $4) r", [who, run, pts, ok]);
  assertEquals((await fin(B, s.runId, 500)).reason, "notFound");
  assertEquals((await fin(A, s.runId, 500)).updated, true);
  assertEquals((await fin(A, s.runId, 900)).reason, "already");
  assertEquals((await fin(A, s2.runId, 300)).updated, false); // 더 낮음
  const s3 = await one(db, "select public.comp_start($1) r", [A]);
  assertEquals((await fin(A, s3.runId, 99999, false)).reason, "held"); // 상한 넘음 -> 순위 X
  assertEquals((await db.query<R>("select points from public.comp_best")).rows, [{ points: 500 }]);
});

Deno.test("경쟁: 시즌 끝 30분 지난 판은 seasonClosed", async () => {
  const db = await setup();
  await db.query("insert into public.comp_runs (run_id, season_id, player_id, seed) values ('00000000-0000-0000-0000-0000000000f1', '2026-W40', $1, 1)", [A]);
  assertEquals((await one(db, "select public.comp_finish($1, '00000000-0000-0000-0000-0000000000f1', 100, 5, null, true) r", [A])).reason, "seasonClosed");
});

Deno.test("정산: 구간·보상, 닉네임 없는 사람 제외, 한 번만, 보상 받기 한 번", async () => {
  const db = await setup();
  for (const [who, pts, at] of [[A, 800, "2026-10-01"], [B, 800, "2026-10-02"], [C, 999, "2026-10-01"]]) {
    await db.query("insert into public.comp_best values ('2026-W40', $1, $2, 12, $3, null)", [who, pts, at]);
  }
  const tiers = JSON.stringify(RANKING.tiers);
  const gold = JSON.stringify(FLOOR_GOLD.gold);
  const res = await one(db, "select public.comp_settle_due($1, $2) r", [tiers, gold]);
  assertEquals(res.settled, ["2026-W40"]);
  assertEquals((await one(db, "select public.comp_settle_due($1, $2) r", [tiers, gold])).settled, []);
  const rows = (await db.query<R>("select player_id, rank, pct, tier_id, rewards from public.season_results order by rank")).rows;
  assertEquals(rows.map((r) => [r.player_id, r.rank, r.pct, r.tier_id]), [[A, 1, 50, "r1"], [B, 2, 100, "r2"]]); // 동점 = 먼저 낸 A
  assertEquals(rows[0].rewards, { diamonds: 500, items: { rainbow: 5 } });
  const c1 = await one(db, "select public.rank_claim($1, '2026-W40') r", [A]);
  assertEquals([c1.ok, c1.txId], [true, "rank:2026-W40"]);
  assertEquals((await one(db, "select public.rank_claim($1, '2026-W40') r", [A])).reason, "already");
  assertEquals((await one(db, "select public.rank_claim($1, '2026-W40') r", [C])).reason, "none");
  assertEquals((await db.query<R>("select kind, bundle from public.claims")).rows, [{ kind: "rank", bundle: { diamonds: 500, items: { rainbow: 5 } } }]);
});

Deno.test("구간 계산: TS tierOf == SQL comp_tier, 참여 구간 골드 배수는 서버 bundle에서 빠짐", async () => {
  const db = await setup();
  const tiers = JSON.stringify(RANKING.tiers);
  for (const [rank, total] of [[1, 1], [4, 1000], [51, 1000], [10, 1000], [11, 1000], [300, 1000], [999, 1000]]) {
    const sql = (await db.query<{ id: string }>("select public.comp_tier($1, $2, $3) ->> 'id' id", [tiers, rank, total])).rows[0].id;
    assertEquals(sql, tierOf(rank, total)?.id, `${rank}/${total}`);
  }
  assertEquals(pctOf(7, 100), 7);
  assert(compScoreOk(5000, 10, 600) && !compScoreOk(5000, 10, 10) && !compScoreOk(10_000_000, 3, 600));
});

Deno.test("정산 참여 보상 골드 = goldFloorMul x 층 기준가(그 판 층, 표보다 높으면 마지막 값)", async () => {
  const db = await setup();
  await db.query("insert into public.comp_best values ('2026-W40', $1, 900, 12, '2026-10-01', null), ('2026-W40', $2, 500, 999, '2026-10-01', null)", [A, B]);
  const tiers = JSON.stringify([{ id: "part", pct: 100, rewards: { diamonds: 10, goldFloorMul: 3 } }]);
  await one(db, "select public.comp_settle_due($1, $2) r", [tiers, JSON.stringify(FLOOR_GOLD.gold)]);
  const rows = (await db.query<R>("select rewards from public.season_results order by rank")).rows;
  assertEquals(rows[0].rewards, { diamonds: 10, gold: Math.round(3 * FLOOR_GOLD.gold[11]) });
  assertEquals(rows[1].rewards, { diamonds: 10, gold: Math.round(3 * FLOOR_GOLD.gold.at(-1)!) });
});

Deno.test("store_order_ref: 원스토어 = purchaseId(raw), 그 밖 = 주문번호, 최근 결제 뷰에 보임", async () => {
  const db = await setup();
  await db.query("select public.iap_record($1, 'onestore', 'dia.0', 'os_dia', 'TOKEN1', null, 1200, 'verified', $2)",
    [A, { purchaseId: "17070421461015116878", purchaseState: 0 }]);
  await record(db, A, "toss", "ORDER-1", "verified");
  await record(db, A, "onestore", "TOKEN2", "invalid"); // 마켓 응답에 purchaseId 없음
  const rows = (await db.query<R>("select order_id, store_order_ref from public.v_purchases_recent order by id")).rows;
  assertEquals(rows, [
    { order_id: "TOKEN1", store_order_ref: "17070421461015116878" },
    { order_id: "ORDER-1", store_order_ref: "ORDER-1" },
    { order_id: "TOKEN2", store_order_ref: null },
  ]);
});

// ---------- C3 광고 ----------
Deno.test("광고 보상: SSV 기다림 -> 받기 -> 같은 nonce 다시 X, 하루 한도, 토스 기기 판정", async () => {
  const db = await setup();
  const claim = (who: string, nonce: string | null, via: string) =>
    one(db, "select public.ad_claim($1, 'chest', $2, $3, '2026-11-09', '{\"diamonds\":5}', 2) r", [who, nonce, via]);
  assertEquals((await claim(A, "n1", "ssv")).reason, "notFound");
  await db.query("insert into public.ad_nonces (nonce, player_id, placement) values ('n1', $1, 'chest'), ('n2', $1, 'chest'), ('n3', $1, 'chest')", [A]);
  assertEquals((await claim(B, "n1", "ssv")).reason, "notFound"); // 남의 nonce
  assertEquals((await claim(A, "n1", "ssv")).reason, "notYet");
  await db.query("insert into public.ad_views (transaction_id, player_id, nonce) values ('t1', $1, 'n1'), ('t2', $1, 'n2'), ('t3', $1, 'n3')", [A]);
  const r = await claim(A, "n1", "ssv");
  assertEquals([r.ok, r.txId, r.left], [true, "ad:chest:2026-11-09:1", 1]);
  assertEquals((await claim(A, "n1", "ssv")).reason, "already");
  assertEquals((await claim(A, "n2", "ssv")).ok, true);
  assertEquals((await claim(A, "n3", "ssv")).reason, "limit");
  assertEquals((await claim(B, null, "device")).txId, "ad:chest:2026-11-09:1");
});

// 테스트용: WebCrypto 서명(r||s) -> DER.
function rawToDer(raw: Uint8Array) {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.subarray(i);
    return v[0] & 0x80 ? [0x02, v.length + 1, 0, ...v] : [0x02, v.length, ...v];
  };
  const body = [...int(raw.subarray(0, 32)), ...int(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

Deno.test("AdMob SSV 서명: 맞으면 파라미터, 바꾸면 null, 공개키 JSON 읽기", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const keys = await importKeys({ keys: [{ keyId: 3335741209, base64: btoa(String.fromCharCode(...spki)) }] });
  const msg = `ad_network=5450213213286189855&ad_unit=1234&custom_data=n1&reward_amount=1&reward_item=Reward&timestamp=1700000000000&transaction_id=tx1&user_id=${A}`;
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, new TextEncoder().encode(msg)));
  assertEquals(derToRaw(rawToDer(raw)), raw);
  const q = `${msg}&signature=${b64url(rawToDer(raw))}&key_id=3335741209`;
  const getKey = (id: string) => Promise.resolve(keys.get(id) ?? null);
  assertEquals((await verifySsv(q, getKey))?.get("custom_data"), "n1");
  assertEquals(await verifySsv(q.replace("reward_amount=1", "reward_amount=9"), getKey), null);
  assertEquals(await verifySsv(q.replace("key_id=3335741209", "key_id=1"), getKey), null);
  assertEquals(await verifySsv(msg, getKey), null);
});

Deno.test("me_delete: 경쟁 기록·광고 nonce 지움, ad_views는 연결만 끊음", async () => {
  const db = await setup();
  await one(db, "select public.comp_start($1) r", [A]);
  await db.query("insert into public.ad_nonces (nonce, player_id, placement) values ('n9', $1, 'chest')", [A]);
  await db.query("insert into public.ad_views (transaction_id, player_id, nonce) values ('t9', $1, 'n9')", [A]);
  await db.query("select public.me_delete($1)", [A]);
  assertEquals((await db.query("select 1 from public.comp_runs")).rows.length, 0);
  assertEquals((await db.query("select 1 from public.ad_nonces")).rows.length, 0);
  assertEquals((await db.query<R>("select player_id from public.ad_views")).rows, [{ player_id: null }]);
});
