// 쿠폰(docs/coupon.md §3) 마이그레이션 테스트 - s1_test와 같은 PGlite 방식. 실행: deno test -A server/supabase/tests
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals, assertMatch, assertRejects } from "jsr:@std/assert@1";
import { ITEM_IDS } from "../functions/_shared/coupon.ts";

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
const BUNDLE = { diamonds: 100, items: { hammer: 3 } };
const TOMORROW = () => new Date(Date.now() + 86400e3).toISOString();

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await db.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const id of [A, B]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.players (id, platform) values ($1, 'android')", [id]);
  }
  return db;
}

type R = { ok: boolean; reason?: string; txId?: string; bundle?: unknown; title?: { ko: string; en: string } };
const redeem = async (db: PGlite, who: string, code: string) =>
  (await db.query<{ r: R }>("select public.coupon_redeem($1, $2) r", [who, code])).rows[0].r;

// 이름 붙인 인자만 넘긴다(나머지는 함수 기본값).
async function create(db: PGlite, code: string, extra: Record<string, unknown> = {}) {
  const args: Record<string, unknown> = { p_code: code, p_title_ko: "시험", p_title_en: "Test", p_bundle: BUNDLE, p_ends_at: TOMORROW(), ...extra };
  const names = Object.keys(args);
  const sql = `select public.coupon_create(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) r`;
  const vals = names.map((n) => (n === "p_bundle" ? JSON.stringify(args[n]) : args[n]));
  return (await db.query<{ r: { code: string; campaign: string } }>(sql, vals)).rows[0].r;
}

const uses = async (db: PGlite, code: string) =>
  (await db.query<{ n: number }>("select uses n from public.coupons where code = $1", [code])).rows[0].n;

Deno.test("공용 쿠폰: 성공 -> 같은 계정 already, 다른 계정 성공, uses 2", async () => {
  const db = await setup();
  assertEquals((await create(db, "GEMS-OPEN")).campaign, "GEMSOPEN");
  const r = await redeem(db, A, "GEMSOPEN");
  assertEquals([r.ok, r.txId], [true, "coupon:GEMSOPEN"]);
  assertEquals(r.bundle, BUNDLE);
  assertEquals(r.title, { ko: "시험", en: "Test" });
  assertEquals((await redeem(db, A, "GEMSOPEN")).reason, "already");
  assertEquals((await redeem(db, B, "GEMSOPEN")).ok, true);
  assertEquals(await uses(db, "GEMSOPEN"), 2);
});

Deno.test("정규화: gems-open, GEMS OPEN, 전각 문자 모두 같은 쿠폰", async () => {
  const db = await setup();
  await create(db, "GEMSOPEN");
  for (const s of ["gems-open", "GEMS OPEN", "ＧＥＭＳＯＰＥＮ"]) {
    const n = (await db.query<{ v: string }>("select public.coupon_normalize($1) v", [s])).rows[0].v;
    assertEquals(n, "GEMSOPEN");
  }
  assertEquals((await redeem(db, A, "ＧＥＭＳ－ＯＰＥＮ")).ok, true);
  assertEquals((await redeem(db, A, "gems open")).reason, "already");
  for (const s of ["abc", "A".repeat(21), "한글만", ""]) {
    assertEquals((await db.query<{ v: string | null }>("select public.coupon_normalize($1) v", [s])).rows[0].v, null);
  }
});

Deno.test("선착순 max_uses=1: 두 계정 동시에 -> 하나만 ok, 나머지 soldOut", async () => {
  const db = await setup();
  await create(db, "FIRST1", { p_max_uses: 1 });
  // PGlite는 연결이 하나라 실제로는 차례로 돈다(실서버에서는 for update가 줄 세움).
  const rs = await Promise.all([redeem(db, A, "FIRST1"), redeem(db, B, "FIRST1")]);
  assertEquals(rs.filter((r) => r.ok).length, 1);
  assertEquals(rs.find((r) => !r.ok)?.reason, "soldOut");
  assertEquals(await uses(db, "FIRST1"), 1);
});

Deno.test("notStarted / expired / platform / enabled=false -> notFound", async () => {
  const db = await setup();
  await create(db, "LATER1", { p_starts_at: TOMORROW() });
  await create(db, "OLD1", { p_starts_at: new Date(Date.now() - 2 * 86400e3).toISOString(), p_ends_at: new Date(Date.now() - 1000).toISOString() });
  await create(db, "STORE1", { p_platforms: ["onestore"] });
  await create(db, "OFF1");
  await db.query("update public.coupons set enabled = false where code = 'OFF1'");
  assertEquals((await redeem(db, A, "LATER1")).reason, "notStarted");
  assertEquals((await redeem(db, A, "OLD1")).reason, "expired");
  assertEquals((await redeem(db, A, "STORE1")).reason, "platform");
  assertEquals((await redeem(db, A, "OFF1")).reason, "notFound");
  await db.query("update public.players set platform = 'onestore' where id = $1", [B]);
  assertEquals((await redeem(db, B, "STORE1")).ok, true);
  // 진짜 코드 실패(5~8)는 tries에 실패로 안 센다 - notFound(OFF1) 1번만.
  const bad = (await db.query<{ n: number }>("select count(*)::int n from public.coupon_tries where player_id = $1 and not ok", [A])).rows[0].n;
  assertEquals(bad, 1);
});

Deno.test("1회용 묶음: 한 계정이 같은 캠페인 코드 2장 -> 두 번째 already, 쓴 코드는 남이 써도 soldOut", async () => {
  const db = await setup();
  const codes = (await db.query<{ code: string }>(
    "select code from public.coupon_batch('stream-1', 3, '방송', 'Stream', '{\"diamonds\":300}', $1)", [TOMORROW()])).rows.map((r) => r.code);
  const r1 = await redeem(db, A, codes[0]);
  assertEquals([r1.ok, r1.txId], [true, "coupon:stream-1"]);
  assertEquals((await redeem(db, A, codes[1])).reason, "already");
  assertEquals((await redeem(db, B, codes[0])).reason, "soldOut");
  assertEquals((await redeem(db, B, codes[1])).ok, true);
});

Deno.test("tooMany: 없는 코드 5번 -> 6번째는 진짜 코드여도 tooMany", async () => {
  const db = await setup();
  await create(db, "REAL1");
  for (let i = 0; i < 5; i++) assertEquals((await redeem(db, A, `NOPE${i}`)).reason, "notFound");
  assertEquals((await redeem(db, A, "REAL1")).reason, "tooMany");
  assertEquals((await redeem(db, B, "REAL1")).ok, true); // 다른 계정은 상관없음
  // 10분 지나면 풀림
  await db.query("update public.coupon_tries set at = at - interval '11 minutes' where player_id = $1", [A]);
  assertEquals((await redeem(db, A, "REAL1")).ok, true);
});

Deno.test("badCode도 실패로 세고, banned면 banned", async () => {
  const db = await setup();
  assertEquals((await redeem(db, A, "!!")).reason, "badCode");
  await db.query("update public.players set banned = true where id = $1", [B]);
  assertEquals((await redeem(db, B, "ANY1")).reason, "banned");
});

Deno.test("bundle 검사: flags, skills, 모르는 아이템, 음수, 소수, 상한 초과, 빈 묶음 -> coupon_create 에러", async () => {
  const db = await setup();
  const bad = [
    { flags: ["adFree"] }, { skills: { red: 1 } }, { items: { sword: 1 } }, { diamonds: -1 }, { gold: 1.5 },
    { diamonds: 5001 }, { gold: 1000001 }, { items: { hammer: 100 } }, { diamond: 100 }, {}, { items: {} }, { diamonds: "10" },
  ];
  for (const [i, b] of bad.entries()) await assertRejects(() => create(db, `BAD${i}X`, { p_bundle: b }), Error, undefined, JSON.stringify(b));
  await assertRejects(() => create(db, "ab")); // 정규화 실패
  await create(db, "GOOD1", { p_bundle: { diamonds: 5000, gold: 1000000, items: { revive: 99 } } });
  await assertRejects(() => create(db, "good-1"), Error, "이미 있는");
  // 표에 직접 넣어도 check 제약이 막는다.
  await assertRejects(() => db.query(
    "insert into public.coupons (code, campaign, title_ko, title_en, bundle) values ('DIRECT1', 'x', 'a', 'b', '{\"flags\":[\"adFree\"]}')"));
});

Deno.test("SQL 아이템 목록 == _shared/coupon.ts ITEM_IDS", async () => {
  const db = await setup();
  for (const id of ITEM_IDS) {
    const ok = (await db.query<{ v: boolean }>("select public.coupon_bundle_ok($1::jsonb) v", [JSON.stringify({ items: { [id]: 1 } })])).rows[0].v;
    assert(ok, id);
  }
  const sql = await Deno.readTextFile(new URL("20261112000000_coupons.sql", dir));
  const list = sql.slice(sql.indexOf("item_ids constant text[] := array["), sql.indexOf("];", sql.indexOf("item_ids constant")));
  assertEquals([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), ITEM_IDS);
});

Deno.test("성공 claims는 claims-pending에 나오고 claims-granted 후 사라짐", async () => {
  const db = await setup();
  await create(db, "PEND1");
  await redeem(db, A, "PEND1");
  // claims-pending / claims-granted 함수가 하는 쿼리 그대로
  const pending = async () => (await db.query<{ tx_id: string; kind: string }>(
    "select tx_id, kind from public.claims where player_id = $1 and granted_at is null", [A])).rows;
  assertEquals(await pending(), [{ tx_id: "coupon:PEND1", kind: "coupon" }]);
  await db.query("update public.claims set granted_at = now() where player_id = $1 and tx_id = any($2) and granted_at is null", [A, ["coupon:PEND1"]]);
  assertEquals(await pending(), []);
  const s = (await db.query<{ uses: number; granted: number }>(
    "select uses::int, granted::int from public.v_coupon_stats where campaign = 'PEND1'")).rows[0];
  assertEquals([s.uses, s.granted], [1, 1]);
});

Deno.test("coupon_batch 20개: XXXX-XXXX-XXXX, 헷갈리는 글자 없음, 서로 다름, max_uses 1", async () => {
  const db = await setup();
  const codes = (await db.query<{ code: string }>(
    "select code from public.coupon_batch('ev', 20, '이벤트', 'Event', '{\"gold\":1000}', $1)", [TOMORROW()])).rows.map((r) => r.code);
  assertEquals(codes.length, 20);
  for (const c of codes) assertMatch(c, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){2}$/);
  for (const c of codes) assert(!/[OIL01]/.test(c), c);
  assertEquals(new Set(codes).size, 20);
  const m = (await db.query<{ n: number }>("select count(*)::int n from public.coupons where campaign = 'ev' and max_uses = 1")).rows[0].n;
  assertEquals(m, 20);
  await assertRejects(() => db.query("select * from public.coupon_batch('ev2', 0, 'a', 'b', '{\"gold\":1}', null)"));
  await assertRejects(() => db.query("select * from public.coupon_batch('ev2', 5001, 'a', 'b', '{\"gold\":1}', null)"));
});

Deno.test("앱(익명 사용자 JWT)·anon은 쿠폰 표·운영 함수·판정 함수를 못 부름", async () => {
  const db = await setup();
  await create(db, "SECRET1");
  for (const role of [`authenticated; set request.jwt.claim.sub = '${A}'`, "anon"]) {
    await db.exec(`set role ${role};`);
    await assertRejects(() => db.query("select * from public.coupons"));
    await assertRejects(() => db.query("select * from public.coupon_tries"));
    await assertRejects(() => db.query("select * from public.v_coupon_stats"));
    await assertRejects(() => db.query(`select public.coupon_create('HACK1', 'a', 'b', '{"diamonds":5000}', null)`));
    await assertRejects(() => db.query(`select * from public.coupon_batch('h', 1, 'a', 'b', '{"diamonds":1}', null)`));
    await assertRejects(() => db.query("select public.coupon_redeem($1, 'SECRET1')", [A]));
    await db.exec("reset role;");
  }
  // service_role(Edge Function)은 판정 함수만
  await db.exec("set role service_role;");
  assertEquals((await redeem(db, A, "SECRET1")).ok, true);
  await assertRejects(() => db.query(`select public.coupon_create('HACK2', 'a', 'b', '{"diamonds":1}', null)`));
  await db.exec("reset role;");
});

Deno.test("me_delete: coupon_tries도 지움, 쿠폰 uses는 그대로", async () => {
  const db = await setup();
  await create(db, "DEL1");
  await redeem(db, A, "NOPE1");
  await redeem(db, A, "DEL1");
  await db.query("select public.me_delete($1)", [A]);
  assertEquals((await db.query("select 1 from public.coupon_tries where player_id = $1", [A])).rows.length, 0);
  assertEquals(await uses(db, "DEL1"), 1);
});
