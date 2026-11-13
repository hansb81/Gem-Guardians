// 계정 합치기(docs/auth.md §4-3) - 20261114000000_account.sql. s1_test와 같은 PGlite 방식.
// linkIdentity 자체는 Google이 필요해 대상 아님. auth.users A 삭제는 account-merge가 관리자 API로 하는 것을 delete로 흉내.
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals } from "jsr:@std/assert@1";

const dir = new URL("../migrations/", import.meta.url);
const STUB = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const A = "00000000-0000-0000-0000-00000000000a"; // 게스트(이 기기)
const B = "00000000-0000-0000-0000-00000000000b"; // Google 연결된 기존 계정
const C = "00000000-0000-0000-0000-00000000000c";

async function setup() {
  const pg = new PGlite();
  await pg.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await pg.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const id of [A, B, C]) {
    await pg.query("insert into auth.users values ($1)", [id]);
    await pg.query("insert into public.players (id, platform) values ($1, 'android')", [id]);
  }
  return pg;
}
type R = Record<string, unknown>;
const one = async (pg: PGlite, sql: string, args: unknown[] = []) => ((await pg.query<{ r: R }>(sql, args)).rows[0]?.r ?? null) as R;
const rows = async (pg: PGlite, sql: string, args: unknown[] = []) => (await pg.query(sql, args)).rows as R[];
const ticket = async (pg: PGlite, who: string) => one(pg, "select public.merge_ticket_new($1) r", [who]);
const redeem = (pg: PGlite, t: unknown, to: string, keep = "server") =>
  one(pg, "select public.merge_ticket_redeem($1, $2, $3) r", [t, to, keep]);
const buy = (pg: PGlite, who: string, order: string) =>
  pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id)
    values ($1, 'play', 'dia.3', $2, 'granted', 'iap:dia.3:' || $2)`, [who, order]);
const claimRow = (pg: PGlite, who: string, tx: string, granted: boolean) =>
  pg.query(`insert into public.claims (player_id, tx_id, kind, bundle, granted_at) values ($1, $2, split_part($2, ':', 1), '{"diamonds":5}', $3)`,
    [who, tx, granted ? new Date().toISOString() : null]);

Deno.test("ticket: 결제 수 포함, 한 번만, 10분 지나면 expired, 없는 표·자기 자신 거부", async () => {
  const pg = await setup();
  await buy(pg, A, "GPA.1");
  const t = await ticket(pg, A);
  assertEquals(t.ok, true);
  assertEquals(Number(t.purchases), 1);
  assert(typeof t.ticket === "string" && (t.ticket as string).length >= 24);
  assertEquals((await redeem(pg, "nope", B)).reason, "badTicket");
  assertEquals((await redeem(pg, t.ticket, A)).reason, "self", "A가 자기 표로 자기에게 합치기");
  assertEquals((await redeem(pg, t.ticket, B)).ok, true);
  assertEquals((await redeem(pg, t.ticket, B)).reason, "used", "재사용");
  const t2 = await ticket(pg, C);
  await pg.query("update public.merge_tickets set expires_at = now() - interval '1 second' where ticket = $1", [t2.ticket]);
  assertEquals((await redeem(pg, t2.ticket, B)).reason, "expired");
  assertEquals((await redeem(pg, (await ticket(pg, C)).ticket, B, "both")).reason, "badRequest");
});

Deno.test("merge 후 purchases가 B로, A 사용자 삭제(players cascade) 뒤에도 결제는 B에 남음", async () => {
  const pg = await setup();
  await buy(pg, A, "GPA.1");
  await buy(pg, A, "GPA.2");
  await buy(pg, B, "GPA.3");
  await pg.query(`insert into public.saves (player_id, data, save_version, rev, summary) values ($1, '{}', 3, 4, '{}')`, [A]);
  const r = await redeem(pg, (await ticket(pg, A)).ticket, B);
  assertEquals(r.ok, true);
  assertEquals(r.movedPurchases, 2);
  assertEquals(r.from, A);
  await pg.query("delete from auth.users where id = $1", [A]); // account-merge의 auth.admin.deleteUser
  assertEquals((await rows(pg, "select 1 from public.players where id = $1", [A])).length, 0);
  assertEquals((await rows(pg, "select 1 from public.purchases where player_id = $1", [B])).length, 3);
  assertEquals((await rows(pg, "select 1 from public.saves where player_id = $1", [A])).length, 0);
});

Deno.test("쿠폰 claim이 B로 옮겨져 같은 캠페인을 B에서 쓰면 already, B에 이미 있으면 A 것 버림", async () => {
  const pg = await setup();
  await pg.query(`select public.coupon_create(p_code => 'WELCOME1', p_title_ko => '환영', p_title_en => 'Hi',
    p_bundle => '{"diamonds":10}'::jsonb, p_ends_at => now() + interval '1 day')`);
  assertEquals((await one(pg, "select public.coupon_redeem($1, 'WELCOME1') r", [A])).ok, true);
  await claimRow(pg, A, "rank:2026-W45", true);
  await claimRow(pg, B, "rank:2026-W45", true);
  await redeem(pg, (await ticket(pg, A)).ticket, B);
  assertEquals((await one(pg, "select public.coupon_redeem($1, 'WELCOME1') r", [B])).reason, "already");
  assertEquals((await rows(pg, "select 1 from public.claims where player_id = $1 and tx_id = 'rank:2026-W45'", [B])).length, 1);
  assertEquals((await rows(pg, "select 1 from public.claims where player_id = $1", [A])).length, 0);
});

Deno.test("미지급 claims: keep device면 B로(다시 내려줌), server면 버림 / normal_best는 device이고 A가 더 높을 때만", async () => {
  for (const keep of ["device", "server"]) {
    const pg = await setup();
    await claimRow(pg, A, "mail:7", false); // 미지급
    await claimRow(pg, A, "att:2026-11-10", true); // 지급됨 - 어느 쪽이든 버림
    await pg.query("select public.rank_normal_submit($1, 30)", [A]);
    await pg.query("select public.rank_normal_submit($1, 12)", [B]);
    await redeem(pg, (await ticket(pg, A)).ticket, B, keep);
    const b = (await rows(pg, "select tx_id from public.claims where player_id = $1 order by tx_id", [B])).map((x) => x.tx_id);
    assertEquals(b, keep === "device" ? ["mail:7"] : []);
    const best = (await rows(pg, "select best_floor from public.normal_best where player_id = $1", [B]))[0].best_floor;
    assertEquals(best, keep === "device" ? 30 : 12);
    assertEquals((await rows(pg, "select 1 from public.normal_best where player_id = $1", [A])).length, 0);
  }
});

Deno.test("웹훅이 A id로 와도 B에 기록(player_resolve가 합쳐진 id를 따라감, 두 번 합쳐져도)", async () => {
  const pg = await setup();
  await redeem(pg, (await ticket(pg, A)).ticket, B);
  await pg.query("delete from auth.users where id = $1", [A]);
  const p = (await pg.query<{ p: string }>("select public.player_resolve($1::uuid[]) p", [[A]])).rows[0].p;
  assertEquals(p, B);
  const w = await one(pg, `select public.iap_webhook('ev1', 'NON_RENEWING_PURCHASE', 'play', 'GPA.9', $1, 'dia.3', 'dia_3', 3300, '{}'::jsonb) r`, [p]);
  assert(w);
  assertEquals((await rows(pg, "select player_id from public.purchases where order_id = 'GPA.9'"))[0].player_id, B);
  // B도 C로 합쳐지면 A -> C
  await redeem(pg, (await ticket(pg, B)).ticket, C);
  assertEquals((await pg.query<{ p: string }>("select public.player_resolve($1::uuid[]) p", [[A]])).rows[0].p, C);
  assertEquals((await pg.query<{ p: string }>("select public.player_resolve($1::uuid[]) p", [[C]])).rows[0].p, C);
});

Deno.test("앱 JWT·anon은 표·합치기 함수를 못 부름, me_delete는 merge_tickets도 지움", async () => {
  const pg = await setup();
  const t = await ticket(pg, A);
  await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`);
  let denied = 0;
  for (const sql of ["select * from public.merge_tickets", "select * from public.player_merges",
    `select public.merge_ticket_redeem('${t.ticket}', '${B}', 'server')`, `select public.merge_ticket_new('${A}')`]) {
    try {
      await pg.query(sql);
    } catch {
      denied++;
    }
  }
  await pg.exec("reset role");
  assertEquals(denied, 4);
  await pg.query("select public.me_delete($1)", [A]);
  assertEquals((await rows(pg, "select 1 from public.merge_tickets where from_player = $1", [A])).length, 0);
});
