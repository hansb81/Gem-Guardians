// 연속 출석 보너스(migrations/20261121000000_att_streak.sql, docs/server.md §8-1). 실행: deno test -A server/supabase/tests
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assertEquals } from "jsr:@std/assert@1";
import { ATTENDANCE_DAYS, ATTENDANCE_STREAK } from "../functions/_shared/attendance.ts";
import { attStatus } from "../functions/_shared/start.ts";
import { kstDate } from "../functions/_shared/kst.ts";

const dir = new URL("../migrations/", import.meta.url);
const STUB = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create schema storage; create table storage.buckets (id text primary key, name text, public boolean); -- 20261119 threads_media
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const STREAK_SQL = "20261121000000_att_streak.sql";
const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();

// only(f) = 실행할 마이그레이션 고르기(되채우기 테스트가 연속 마이그레이션 앞에서 멈췄다가 이어서 돌린다).
async function migrate(db: PGlite, only: (f: string) => boolean = () => true) {
  for (const f of files.filter(only)) await db.exec(await Deno.readTextFile(new URL(f, dir)));
}
async function setup(only?: (f: string) => boolean) {
  const db = new PGlite();
  await db.exec(STUB);
  await migrate(db, only);
  for (const id of [A, B]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into public.players (id) values ($1)", [id]);
  }
  return db;
}
type R = { ok: boolean; reason?: string; day: number; txId: string; bundle: unknown; streak: number; streakBonus: unknown };
const claim = async (db: PGlite, who: string, day: string) =>
  (await db.query<{ r: R }>("select public.att_claim($1, $2::date, $3::jsonb, $4::jsonb) r",
    [who, day, JSON.stringify(ATTENDANCE_DAYS), JSON.stringify(ATTENDANCE_STREAK)])).rows[0].r;
const day = (n: number) => new Date(Date.UTC(2026, 11, n)).toISOString().slice(0, 10); // 2026-12-01 + (n-1), 달을 넘겨도 이어짐
const ago = (n: number) => kstDate(Date.now() - n * 86400e3);
const row = async (db: PGlite, who: string) =>
  (await db.query<{ days: number; streak: number; best_streak: number; streak_bonuses: number }>(
    "select days, streak, best_streak, streak_bonuses from public.attendance where player_id = $1", [who])).rows[0];
const BONUS = ATTENDANCE_STREAK.bonus;
const DAY7_PLUS = { diamonds: 50 + BONUS.diamonds, items: { rainbow: 1, revive: 1 }, spiritStones: 10 }; // 정령석 = 7일째 5 + 연속 보너스 5

Deno.test("bundle_add: 숫자는 더하고 items는 id별로 더함, null·없는 키 안전", async () => {
  const db = await setup();
  const add = async (a: unknown, b: unknown) =>
    (await db.query<{ r: unknown }>("select public.bundle_add($1::jsonb, $2::jsonb) r",
      [a === undefined ? null : JSON.stringify(a), b === undefined ? null : JSON.stringify(b)])).rows[0].r;
  assertEquals(await add(ATTENDANCE_DAYS[6], BONUS), DAY7_PLUS);
  assertEquals(await add({ items: { revive: 2, dye: 1 } }, { gold: 5, items: { revive: 1 } }), { gold: 5, items: { revive: 3, dye: 1 } });
  assertEquals(await add({ diamonds: 10 }, undefined), { diamonds: 10 });
  assertEquals(await add(undefined, { gold: 3 }), { gold: 3 });
  assertEquals(await add(null, { items: null }), {});
  assertEquals(await add({ spiritStones: 5 }, { spiritStones: 5, diamonds: 1 }), { spiritStones: 10, diamonds: 1 }, "정령석도 더한다");
  assertEquals(await add({ spiritStones: 5 }, undefined), { spiritStones: 5 });
});

Deno.test("연속 1: 7일 연속 -> 7일째 bundle = 판 7일 + 보너스, 그 전엔 보너스 없음", async () => {
  const db = await setup();
  for (let d = 1; d <= 6; d++) {
    const r = await claim(db, A, day(d));
    assertEquals([r.day, r.streak, r.streakBonus, r.bundle], [d, d, null, ATTENDANCE_DAYS[d - 1]]);
  }
  const r = await claim(db, A, day(7));
  assertEquals([r.day, r.streak, r.txId], [7, 7, `att:${day(7)}`]);
  assertEquals(r.streakBonus, BONUS);
  assertEquals(r.bundle, DAY7_PLUS);
  const c = (await db.query<{ bundle: unknown }>("select bundle from public.claims where player_id = $1 and tx_id = $2", [A, r.txId])).rows;
  assertEquals(c, [{ bundle: DAY7_PLUS }], "claims에는 합친 bundle 하나");
  assertEquals(await row(db, A), { days: 7, streak: 7, best_streak: 7, streak_bonuses: 1 });
});

Deno.test("연속 2: 3일 받고 하루 빠짐 -> streak 1, 판은 4일째 칸", async () => {
  const db = await setup();
  for (let d = 1; d <= 3; d++) await claim(db, A, day(d));
  const r = await claim(db, A, day(5));
  assertEquals([r.day, r.streak, r.streakBonus, r.bundle], [4, 1, null, ATTENDANCE_DAYS[3]]);
  assertEquals(await row(db, A), { days: 4, streak: 1, best_streak: 3, streak_bonuses: 0 });
});

Deno.test("연속 3: 14일 연속 -> 보너스 2번(7·14일)", async () => {
  const db = await setup();
  const got: number[] = [];
  for (let d = 1; d <= 14; d++) if ((await claim(db, A, day(d))).streakBonus) got.push(d);
  assertEquals(got, [7, 14]);
  assertEquals(await row(db, A), { days: 7, streak: 14, best_streak: 14, streak_bonuses: 2 });
});

Deno.test("연속 4: 같은 날 두 번 -> already(현재 streak 포함), 보너스 중복 없음", async () => {
  const db = await setup();
  for (let d = 1; d <= 7; d++) await claim(db, A, day(d));
  const r = await claim(db, A, day(7));
  assertEquals([r.ok, r.reason, r.streak], [false, "already", 7]);
  assertEquals((await row(db, A)).streak_bonuses, 1);
  const n = (await db.query<{ n: number }>("select count(*)::int n from public.claims where player_id = $1", [A])).rows[0].n;
  assertEquals(n, 7);
});

Deno.test("연속 5: 빠진 뒤 다시 7일 연속 -> 판 칸과 어긋나도 7번째 날 보너스", async () => {
  const db = await setup();
  await claim(db, A, day(1));
  await claim(db, A, day(2)); // 3일을 빠짐
  let r = await claim(db, A, day(4));
  for (let d = 5; d <= 10; d++) r = await claim(db, A, day(d));
  // 판: 1·2일, 4~8일 = 3~7칸, 9·10일 = 새 판 1·2칸 / 연속: 4일부터 세어 10일이 7일째
  assertEquals([r.day, r.streak], [2, 7]);
  assertEquals(r.streakBonus, BONUS);
  assertEquals(r.bundle, { diamonds: BONUS.diamonds, items: { repair: 1, revive: 1 }, spiritStones: BONUS.spiritStones }, "판 7일째와 안 겹치면 보너스 정령석만(5)");
  assertEquals((await row(db, A)).streak_bonuses, 1);
});

Deno.test("연속 6: 되채우기 - claims의 연속 날짜 -> streak·best_streak, 끊긴 사람은 0, 배포 뒤 첫 수령이 이어짐", async () => {
  const db = await setup((f) => f < STREAK_SQL);
  const old = (who: string, d: string) =>
    db.query("select public.att_claim($1, $2::date, $3::jsonb)", [who, d, JSON.stringify(ATTENDANCE_DAYS)]);
  // A: 예전에 4일 연속, 이틀 빠지고 어제까지 3일 연속. B: 5일 연속이었지만 그저께 이전에 끊김.
  for (const n of [9, 8, 7, 6, 3, 2, 1]) await old(A, ago(n));
  for (const n of [10, 9, 8, 7, 6]) await old(B, ago(n));
  await migrate(db, (f) => f >= STREAK_SQL);
  assertEquals(await row(db, A), { days: 7, streak: 3, best_streak: 4, streak_bonuses: 0 });
  assertEquals(await row(db, B), { days: 5, streak: 0, best_streak: 5, streak_bonuses: 0 });
  const r = await claim(db, A, ago(0));
  assertEquals([r.day, r.streak, r.streakBonus], [1, 4, null]);
  assertEquals((await claim(db, B, ago(0))).streak, 1);
});

Deno.test("연속 7: attStatus - 그저께 이전이면 streak 0 + streakBroken, 어제·오늘이면 저장값", async () => {
  const st = (a: Record<string, unknown> | null) =>
    attStatus({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: a, error: null }) }) }) }) }, A);
  const broken = await st({ days: 3, last_date: ago(2), streak: 3 });
  assertEquals([broken.streak, broken.streakBroken, broken.days, broken.claimedToday], [0, true, 3, false]);
  assertEquals([broken.streakGoal, broken.streakBonus], [ATTENDANCE_STREAK.goal, BONUS]);
  const yesterday = await st({ days: 3, last_date: ago(1), streak: 3 });
  assertEquals([yesterday.streak, yesterday.streakBroken], [3, false]);
  const today = await st({ days: 4, last_date: ago(0), streak: 4 });
  assertEquals([today.streak, today.streakBroken, today.claimedToday], [4, false, true]);
  const fresh = await st(null);
  assertEquals([fresh.streak, fresh.streakBroken], [0, false]);
});
