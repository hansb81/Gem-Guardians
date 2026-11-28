// 이벤트(docs/events.md) 마이그레이션 테스트 - coupon_test와 같은 PGlite 방식. 실행: deno test -A server/supabase/tests
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assertEquals, assertRejects } from "jsr:@std/assert@1";

const dir = new URL("../migrations/", import.meta.url);
const STUB = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const BUNDLE = { diamonds: 100, items: { hammer: 3, scythe_h: 3, revive: 1 }, spiritStones: 10 };
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const DAY = 86400e3;

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await db.exec(await Deno.readTextFile(new URL(f, dir)));
  await db.query("insert into auth.users values ($1), ($2)", [A, B]);
  await db.query("insert into public.players (id, platform) values ($1, 'android'), ($2, 'toss')", [A, B]);
  return db;
}

type R = { ok: boolean; reason?: string; txId?: string; bundle?: unknown; title?: { ko: string; en: string } };
const claim = async (db: PGlite, who: string, id: string) =>
  (await db.query<{ r: R }>("select public.event_claim($1, $2) r", [who, id])).rows[0].r;
const list = async (db: PGlite, who: string) =>
  (await db.query<{ r: { id: string; claimed: boolean; startsAt: number }[] }>("select public.event_list($1) r", [who])).rows[0].r;

async function create(db: PGlite, id: string, extra: Record<string, unknown> = {}, on = true) {
  const args: Record<string, unknown> = {
    p_id: id, p_title_ko: "출시 기념 선물", p_title_en: "Launch Gift", p_body_ko: "설명", p_body_en: "Body",
    p_bundle: BUNDLE, p_starts_at: iso(-DAY), p_ends_at: iso(DAY), ...extra,
  };
  const names = Object.keys(args);
  const sql = `select public.event_create(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) r`;
  const r = (await db.query<{ r: { enabled: boolean } }>(sql, names.map((n) => (n === "p_bundle" ? JSON.stringify(args[n]) : args[n])))).rows[0].r;
  assertEquals(r.enabled, false, "꺼진 상태로 만들어진다");
  if (on) await db.query("select public.event_set_enabled($1, true)", [id]);
}

Deno.test("성공 -> 같은 계정 already, 다른 계정 성공, claims kind event", async () => {
  const db = await setup();
  await create(db, "launch2026", { p_banner: "launch" });
  const r = await claim(db, A, "launch2026");
  assertEquals([r.ok, r.txId, r.bundle, r.title], [true, "event:launch2026", BUNDLE, { ko: "출시 기념 선물", en: "Launch Gift" }]);
  assertEquals((await claim(db, A, "launch2026")).reason, "already");
  assertEquals((await claim(db, B, "launch2026")).ok, true);
  const k = await db.query<{ kind: string }>("select kind from public.claims where tx_id = 'event:launch2026'");
  assertEquals(k.rows.map((x) => x.kind), ["event", "event"]);
});

Deno.test("꺼짐·없음·notice = notFound, 켜기/끄기 반영", async () => {
  const db = await setup();
  await create(db, "off", {}, false);
  assertEquals((await claim(db, A, "off")).reason, "notFound");
  assertEquals((await claim(db, A, "nope")).reason, "notFound");
  assertEquals(await list(db, A), []);
  await db.query("select public.event_set_enabled('off', true)");
  assertEquals((await list(db, A)).length, 1);
  await db.query("update public.events set kind = 'notice' where id = 'off'");
  assertEquals((await claim(db, A, "off")).reason, "notFound");
  await assertRejects(() => db.query("select public.event_set_enabled('nope', true)"));
});

Deno.test("기간: notStarted / expired, 목록에서도 빠짐", async () => {
  const db = await setup();
  await create(db, "later", { p_starts_at: iso(DAY), p_ends_at: iso(2 * DAY) });
  await create(db, "past", { p_starts_at: iso(-2 * DAY), p_ends_at: iso(-DAY) });
  assertEquals((await claim(db, A, "later")).reason, "notStarted");
  assertEquals((await claim(db, A, "past")).reason, "expired");
  assertEquals(await list(db, A), []);
});

Deno.test("플랫폼: 맞지 않으면 platform, 목록에서도 빠짐", async () => {
  const db = await setup();
  await create(db, "toss", { p_platforms: ["toss"] });
  assertEquals((await claim(db, A, "toss")).reason, "platform");
  assertEquals((await list(db, A)).length, 0);
  assertEquals((await list(db, B)).length, 1);
  assertEquals((await claim(db, B, "toss")).ok, true);
});

Deno.test("순서: banned가 먼저, already는 기간보다 뒤", async () => {
  const db = await setup();
  await create(db, "e1");
  assertEquals((await claim(db, A, "e1")).ok, true);
  await db.query("update public.events set ends_at = now() - interval '1 second', starts_at = now() - interval '1 day' where id = 'e1'");
  assertEquals((await claim(db, A, "e1")).reason, "expired");
  await db.query("update public.players set banned = true where id = $1", [A]);
  assertEquals((await claim(db, A, "nope")).reason, "banned");
});

Deno.test("목록: sort 순, claimed 표시", async () => {
  const db = await setup();
  await create(db, "b", { p_sort: 2 });
  await create(db, "a", { p_sort: 1 });
  await claim(db, A, "b");
  const l = await list(db, A);
  assertEquals(l.map((e) => [e.id, e.claimed]), [["a", false], ["b", true]]);
  assertEquals(typeof l[0].startsAt, "number");
});

Deno.test("event_create 검사: 번들·id·기간·중복", async () => {
  const db = await setup();
  for (const b of [{}, { spiritStones: 0 }, { spiritStones: 1001 }, { flags: ["adFree"] }, { diamonds: 5001 }, { items: { nope: 1 } }]) {
    await assertRejects(() => create(db, "x", { p_bundle: b }), Error, undefined, JSON.stringify(b));
  }
  await assertRejects(() => create(db, "bad id"));
  await assertRejects(() => create(db, "x", { p_starts_at: iso(DAY), p_ends_at: iso(-DAY) }));
  await create(db, "ok", { p_bundle: { spiritStones: 10 } });
  await assertRejects(() => create(db, "ok"));
  // 표 check: claim인데 번들이 잘못되면 직접 insert도 막힘(관리자 함수가 표를 직접 쓸 때)
  await assertRejects(() => db.query("insert into public.events (id, bundle) values ('raw', '{\"gold\":0}')"));
  await db.query("insert into public.events (id, kind) values ('note', 'notice')");
});

Deno.test("운영 함수는 service_role에 없음, 판정·목록은 있음", async () => {
  const db = await setup();
  const can = async (fn: string) =>
    (await db.query<{ v: boolean }>("select has_function_privilege('service_role', $1, 'execute') v", [fn])).rows[0].v;
  assertEquals(await can("public.event_claim(uuid, text)"), true);
  assertEquals(await can("public.event_list(uuid)"), true);
  assertEquals(await can("public.event_set_enabled(text, boolean)"), false);
});
