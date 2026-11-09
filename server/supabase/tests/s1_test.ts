// S1 마이그레이션 테스트. Docker 없이 돌도록 PGlite(WASM Postgres)에 Supabase의 auth 스키마·역할만 흉내 내고
// migrations/*.sql 을 그대로 실행한다. 실행: deno test -A server/supabase/tests
// (Docker가 있으면 supabase start 후 실제 DB에도 같은 SQL이 올라간다 - 이 테스트는 SQL 규칙만 본다.)
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ATTENDANCE_DAYS } from "../functions/_shared/attendance.ts";
import { kstDate } from "../functions/_shared/kst.ts";
import { hasBadword } from "../functions/_shared/badwords.ts";

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

const claim = async (db: PGlite, who: string, day: string) =>
  (await db.query<{ r: Record<string, unknown> }>("select public.att_claim($1, $2::date, $3::jsonb) r",
    [who, day, JSON.stringify(ATTENDANCE_DAYS)])).rows[0].r;

Deno.test("출석: 같은 날 2번 -> already, 날짜 넘기면 다음 칸, 빠진 날은 그냥 다음 칸", async () => {
  const db = await setup();
  const r1 = await claim(db, A, "2026-11-09");
  assertEquals([r1.ok, r1.day, r1.txId], [true, 1, "att:2026-11-09"]);
  assertEquals(r1.bundle, ATTENDANCE_DAYS[0]);
  assertEquals((await claim(db, A, "2026-11-09")).reason, "already");
  assertEquals((await claim(db, A, "2026-11-08")).reason, "already"); // 날짜가 뒤로 가도 못 받음
  assertEquals((await claim(db, A, "2026-11-10")).day, 2);
  assertEquals((await claim(db, A, "2026-11-15")).day, 3); // 5일 빠져도 끊기지 않음
  const n = (await db.query<{ n: number }>("select count(*)::int n from public.claims where player_id = $1", [A])).rows[0].n;
  assertEquals(n, 3);
});

Deno.test("출석: 7일 후 새 판 1일로", async () => {
  const db = await setup();
  for (let d = 1; d <= 7; d++) assertEquals((await claim(db, A, `2026-12-0${d}`)).day, d);
  const r = await claim(db, A, "2026-12-08");
  assertEquals([r.day, r.cycleId], [1, "c2"]);
  assertEquals((await claim(db, A, "2026-12-08")).reason, "already");
});

Deno.test("claims: 같은 tx_id 중복 insert 거절", async () => {
  const db = await setup();
  await db.query("insert into public.claims (player_id, tx_id, kind, bundle) values ($1, 'x:1', 'mail', '{}')", [A]);
  await assertRejects(() =>
    db.query("insert into public.claims (player_id, tx_id, kind, bundle) values ($1, 'x:1', 'mail', '{}')", [A]));
  // 다른 플레이어는 같은 tx_id 가능
  await db.query("insert into public.claims (player_id, tx_id, kind, bundle) values ($1, 'x:1', 'mail', '{}')", [B]);
});

Deno.test("RLS/GRANT: 본인 행만 select, 직접 쓰기·anon·함수 실행 불가", async () => {
  const db = await setup();
  await claim(db, A, "2026-11-09");
  await claim(db, B, "2026-11-09");
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${A}';`);
  const rows = (await db.query<{ player_id: string }>("select player_id from public.claims")).rows;
  assertEquals(rows.map((r) => r.player_id), [A]);
  assertEquals((await db.query("select * from public.players")).rows.length, 1);
  await assertRejects(() => db.query("insert into public.claims (player_id, tx_id, kind, bundle) values ($1,'y','att','{}')", [A]));
  await assertRejects(() => db.query("update public.attendance set days = 0"));
  await assertRejects(() => db.query("select * from public.normal_best"));
  await assertRejects(() => db.query("select * from public.mail"));
  await assertRejects(() => db.query("select public.att_claim($1, '2026-11-10', '[]')", [A]));
  await db.exec("reset role; set role anon;");
  await assertRejects(() => db.query("select * from public.players"));
  await assertRejects(() => db.query("select * from public.claims"));
  await db.exec("reset role;");
});

Deno.test("랭킹: 더 높을 때만 갱신, 순위·동점은 먼저 닿은 사람", async () => {
  const db = await setup();
  const sub = async (who: string, f: number) =>
    (await db.query<{ r: { updated: boolean } }>("select public.rank_normal_submit($1, $2) r", [who, f])).rows[0].r.updated;
  await db.query("update public.players set nickname = 'Alpha' where id = $1", [A]);
  await db.query("update public.players set nickname = 'Beta' where id = $1", [B]);
  assertEquals(await sub(A, 5), true);
  assertEquals(await sub(A, 3), false);
  assertEquals(await sub(A, 5), false);
  assertEquals(await sub(B, 5), true);
  const top = (await db.query<{ nickname: string; rank: number }>("select nickname, rank::int from public.rank_normal_top(10)")).rows;
  assertEquals(top.map((r) => r.nickname), ["Alpha", "Beta"]);
  const me = (await db.query<{ r: { rank: number; total: number } }>("select public.rank_normal_me($1) r", [B])).rows[0].r;
  assertEquals([me.rank, me.total], [2, 2]);
  await assertRejects(() => db.query("update public.players set nickname = 'Alpha' where id = $1", [B])); // taken
});

Deno.test("우편: 한 번만, 남의 우편·지난 우편은 notFound", async () => {
  const db = await setup();
  await db.query(`insert into public.mail (player_id, bundle) values (null, '{"diamonds":5}'), ($1, '{"gold":1}'),
                  (null, '{"gold":2}')`, [B]);
  await db.query("update public.mail set expires_at = now() - interval '1 day' where id = 3");
  const mc = async (who: string, id: number) =>
    (await db.query<{ r: Record<string, unknown> }>("select public.mail_claim($1, $2) r", [who, id])).rows[0].r;
  assertEquals((await mc(A, 1)).txId, "mail:1");
  assertEquals((await mc(A, 1)).reason, "already");
  assertEquals((await mc(A, 2)).reason, "notFound");
  assertEquals((await mc(A, 3)).reason, "notFound");
});

Deno.test("me_delete: 기록 삭제, 닉네임 비움, deleted_at", async () => {
  const db = await setup();
  await claim(db, A, "2026-11-09");
  await db.query("update public.players set nickname = 'Alpha' where id = $1", [A]);
  await db.query("select public.rank_normal_submit($1, 4)", [A]);
  await db.query("select public.me_delete($1)", [A]);
  const p = (await db.query<{ nickname: string | null; deleted_at: string | null }>(
    "select nickname, deleted_at from public.players where id = $1", [A])).rows[0];
  assertEquals(p.nickname, null);
  assert(p.deleted_at);
  for (const t of ["claims", "attendance", "normal_best"]) {
    assertEquals((await db.query(`select 1 from public.${t} where player_id = $1`, [A])).rows.length, 0);
  }
});

Deno.test("KST 날짜: UTC 15:00 = 다음 날 0시", () => {
  assertEquals(kstDate(Date.UTC(2026, 10, 9, 14, 59, 59)), "2026-11-09");
  assertEquals(kstDate(Date.UTC(2026, 10, 9, 15, 0, 0)), "2026-11-10");
});

Deno.test("금칙어", () => {
  assert(hasBadword("Fuck123"));
  assert(hasBadword("운영자야"));
  assert(!hasBadword("젬수호자"));
});
