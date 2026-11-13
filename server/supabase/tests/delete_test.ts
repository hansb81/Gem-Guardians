// 계정 삭제(docs/auth.md §6) - _shared/account.ts deleteAccount(me-delete 본문) + anon_cleanup cron. PGlite 방식.
// auth.users 삭제(관리자 API)와 토큰 확인(getUser)은 같은 auth.users 표를 보는 가짜로 흉내 낸다.
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { deleteAccount } from "../functions/_shared/account.ts";

const dir = new URL("../migrations/", import.meta.url);
const STUB = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key, is_anonymous boolean not null default true);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const D = "00000000-0000-0000-0000-00000000000d";

async function setup() {
  const pg = new PGlite();
  await pg.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await pg.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const id of [A, B, C, D]) {
    await pg.query("insert into auth.users (id) values ($1)", [id]);
    await pg.query("insert into public.players (id, platform, last_seen_at) values ($1, 'android', now())", [id]);
  }
  return pg;
}
const rows = async (pg: PGlite, sql: string, args: unknown[] = []) => (await pg.query(sql, args)).rows as Record<string, unknown>[];

// supabase-js 흉내(이 함수가 쓰는 것만). getUser(token) = 토큰이 가리키는 사용자가 아직 있는지(handle의 로그인 확인).
function fakeDb(pg: PGlite, { deleteFails = false } = {}) {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const r = await pg.query<{ r: unknown }>(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) r`, names.map((n) => args[n]));
      return { data: r.rows[0].r, error: null };
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        await pg.query(`insert into public.${table} (source, level, body) values ($1, $2, $3)`, [row.source, row.level, row.body]);
        return { error: null };
      },
    }),
    auth: {
      admin: {
        async deleteUser(id: string) {
          if (deleteFails) return { error: { message: "boom" } };
          await pg.query("delete from auth.users where id = $1", [id]);
          return { error: null };
        },
      },
      async getUser(token: string) {
        const r = await pg.query("select id from auth.users where id = $1", [token]);
        return r.rows.length ? { data: { user: r.rows[0] }, error: null } : { data: { user: null }, error: { message: "user not found" } };
      },
    },
  };
}

Deno.test("계정 삭제: 기록·사용자 삭제, purchases 줄은 남고 player_id null, 같은 토큰으로 hello -> auth 실패", async () => {
  const pg = await setup();
  await pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id) values ($1, 'play', 'dia.3', 'GPA.1', 'granted', 'iap:dia.3:GPA.1')`, [A]);
  await pg.query(`insert into public.saves (player_id, data, save_version, rev, summary) values ($1, '{}', 3, 1, '{}')`, [A]);
  await pg.query("insert into public.coupon_tries (player_id, ok) values ($1, false)", [A]);
  await pg.query("select public.merge_ticket_new($1)", [A]);
  const db = fakeDb(pg);
  const calls: string[] = [];
  const res = await deleteAccount(db, A, {
    rcSecret: "sk_test",
    fetchFn: (async (url: string, init: RequestInit) => (calls.push(`${init.method} ${url}`), new Response("{}", { status: 200 }))) as typeof fetch,
  });
  assertEquals(res, { ok: true });
  assertEquals(calls, [`DELETE https://api.revenuecat.com/v1/subscribers/${A}`]);
  const p = await rows(pg, "select player_id from public.purchases where order_id = 'GPA.1'");
  assertEquals(p.length, 1, "결제 기록 5년 보관");
  assertEquals(p[0].player_id, null);
  for (const t of ["players"]) assertEquals((await rows(pg, `select 1 from public.${t} where id = $1`, [A])).length, 0);
  for (const t of ["saves", "coupon_tries"]) assertEquals((await rows(pg, `select 1 from public.${t} where player_id = $1`, [A])).length, 0, t);
  assertEquals((await rows(pg, "select 1 from public.merge_tickets where from_player = $1", [A])).length, 0);
  assertEquals((await db.auth.getUser(A)).data.user, null, "삭제 뒤 같은 토큰 = 로그인 실패(handle이 401 auth)");
  const [log] = await rows(pg, "select level, body from public.server_log where source = 'me-delete'");
  assertEquals((log.body as { revenuecat: string }).revenuecat, "ok");
});

Deno.test("RevenueCat 실패·키 없음이어도 계속, 사용자 삭제 실패면 ok:false(기기는 데이터 유지·다시 시도)", async () => {
  const pg = await setup();
  const r1 = await deleteAccount(fakeDb(pg), A, { rcSecret: "sk", fetchFn: (async () => { throw new Error("net"); }) as typeof fetch });
  assertEquals(r1.ok, true);
  const r2 = await deleteAccount(fakeDb(pg), B, { rcSecret: "" });
  assertEquals(r2.ok, true);
  const logs = (await rows(pg, "select level, body from public.server_log where source = 'me-delete' order by id"))
    .map((l) => [(l.body as { revenuecat: string }).revenuecat.split(":")[0], l.level]);
  assertEquals(logs, [["error", "warn"], ["skip", "info"]]);
  const r3 = await deleteAccount(fakeDb(pg, { deleteFails: true }), C);
  assertEquals(r3, { ok: false, reason: "error" });
  assertEquals((await rows(pg, "select 1 from auth.users where id = $1", [C])).length, 1);
});

Deno.test("anon-cleanup: 180일 미접속 + 결제 0건 익명만, 결제 있는 익명·최근 접속·연결 계정은 남김, 최대 p_limit명, server_log", async () => {
  const pg = await setup();
  await pg.query("update public.players set last_seen_at = now() - interval '200 days' where id = any($1::uuid[])", [[A, B, C]]);
  await pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id) values ($1, 'play', 'dia.0', 'GPA.7', 'refunded', 'iap:dia.0:GPA.7')`, [B]);
  await pg.query("update auth.users set is_anonymous = false where id = $1", [C]); // Google 연결된 계정
  // D = 익명이지만 최근 접속
  assertEquals((await pg.query<{ n: number }>("select public.anon_cleanup(500) n")).rows[0].n, 1);
  const left = (await rows(pg, "select id from auth.users order by id")).map((r) => r.id);
  assertEquals(left, [B, C, D]);
  const [log] = await rows(pg, "select body from public.server_log where source = 'anon-cleanup'");
  assertEquals(log.body, { deleted: 1 });
  // 한도
  for (const id of [B, D]) await pg.query("update public.players set last_seen_at = now() - interval '300 days' where id = $1", [id]);
  await pg.query("delete from public.purchases");
  assertEquals((await pg.query<{ n: number }>("select public.anon_cleanup(1) n")).rows[0].n, 1);
  assert((await rows(pg, "select 1 from auth.users")).length === 2);
});
