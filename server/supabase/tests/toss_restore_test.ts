// 토스 재설치 복구(20261128000000_toss_restore.sql) - account_test와 같은 PGlite 방식.
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assertEquals } from "jsr:@std/assert@1";

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
const O = "00000000-0000-0000-0000-00000000000a"; // 옛 계정(토스, 진행 있음)
const N = "00000000-0000-0000-0000-00000000000b"; // 다시 깐 기기의 새 계정
const X = "00000000-0000-0000-0000-00000000000c"; // 다른 토스 사용자
const H = "hash-1";

async function setup() {
  const pg = new PGlite();
  await pg.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await pg.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const [id, h] of [[O, H], [N, H], [X, "hash-2"]]) {
    await pg.query("insert into auth.users values ($1)", [id]);
    await pg.query("insert into public.players (id, platform, toss_key_hash) values ($1, 'toss', $2)", [id, h]);
  }
  await pg.query("update public.players set nickname = '수호자', banned = true where id = $1", [O]);
  await pg.query(`insert into public.saves (player_id, data, save_version, rev, summary) values ($1, '{"floor":40}', 3, 12, '{}')`, [O]);
  await pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id)
    values ($1, 'toss', 'dia.3', 'T.1', 'granted', 'iap:dia.3:T.1')`, [O]);
  await pg.query(`insert into public.normal_best (player_id, best_floor, reached_at) values ($1, 40, now())`, [O]);
  return pg;
}
type R = Record<string, unknown>;
const restore = async (pg: PGlite, to: string, h: string) =>
  ((await pg.query<{ r: R }>("select public.toss_restore($1, $2) r", [to, h])).rows[0].r);
const val = async (pg: PGlite, sql: string, args: unknown[]) => (await pg.query<R>(sql, args)).rows[0] ?? null;

Deno.test("새 계정 N에 옛 계정 O의 save·결제·최고 층·닉네임·밴이 옮겨지고 O는 삭제 표시 + player_merges", async () => {
  const pg = await setup();
  const r = await restore(pg, N, H);
  assertEquals(r, { ok: true, from: O });
  assertEquals((await val(pg, "select rev from public.saves where player_id = $1", [N]))?.rev, 12);
  assertEquals((await val(pg, "select count(*)::int c from public.purchases where player_id = $1", [N]))?.c, 1);
  assertEquals((await val(pg, "select best_floor from public.normal_best where player_id = $1", [N]))?.best_floor, 40);
  const n = await val(pg, "select nickname, banned from public.players where id = $1", [N]);
  assertEquals(n, { nickname: "수호자", banned: true });
  const o = await val(pg, "select nickname, toss_key_hash, deleted_at is not null d from public.players where id = $1", [O]);
  assertEquals(o, { nickname: null, toss_key_hash: null, d: true });
  assertEquals((await val(pg, "select public.player_resolve(array[$1]::uuid[]) id", [O]))?.id, N);
  // hello가 O auth 사용자를 지움 - 남은 기록 없음
  await pg.query("delete from auth.users where id = $1", [O]);
  assertEquals((await val(pg, "select count(*)::int c from public.purchases where player_id = $1", [N]))?.c, 1);
});

Deno.test("N에 이미 save나 결제가 있으면 notFresh, 같은 해시 없거나 키 없으면 none·noKey", async () => {
  const pg = await setup();
  await pg.query(`insert into public.saves (player_id, data, save_version, rev, summary) values ($1, '{}', 3, 1, '{}')`, [N]);
  assertEquals((await restore(pg, N, H)).reason, "notFresh");
  assertEquals((await restore(pg, X, "hash-2")).reason, "none", "같은 해시의 다른 계정 없음");
  assertEquals((await restore(pg, X, "")).reason, "noKey");
});

Deno.test("삭제 요청한 계정·Google 연결 계정은 가져오지 않음", async () => {
  const pg = await setup();
  await pg.query("update public.players set linked = array['google'] where id = $1", [O]);
  assertEquals((await restore(pg, N, H)).reason, "none");
  await pg.query("update public.players set linked = null, deleted_at = now() where id = $1", [O]);
  assertEquals((await restore(pg, N, H)).reason, "none");
});
