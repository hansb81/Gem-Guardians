// 클라우드 저장(docs/auth.md §3) - saves 마이그레이션 + _shared/save.ts(save-get·save-put 본문) + hello 시작 정보.
// s1_test와 같은 PGlite 방식. save.ts는 supabase-js 대신 아래 pgdb(필요한 메서드만 흉내)로 돌린다.
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { saveGet, savePut } from "../functions/_shared/save.ts";
import { attStatus, claimsPending, mailList, startInfo } from "../functions/_shared/start.ts";

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
  const pg = new PGlite();
  await pg.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await pg.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const id of [A, B]) {
    await pg.query("insert into auth.users values ($1)", [id]);
    await pg.query("insert into public.players (id, platform) values ($1, 'android')", [id]);
  }
  return pg;
}

// supabase-js 흉내: rpc(이름 붙인 인자), from(t).select(c).eq(k, v)....maybeSingle(). save.ts·ranking.ts가 쓰는 만큼만.
function pgdb(pg: PGlite) {
  return {
    async rpc(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      try {
        const r = await pg.query<{ r: unknown }>(
          `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) r`, names.map((n) => args[n]));
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: String(e) };
      }
    },
    from(table: string) {
      return {
        select(cols: string) {
          const where: [string, unknown][] = [];
          const q = {
            eq(c: string, v: unknown) {
              where.push([c, v]);
              return q;
            },
            async maybeSingle() {
              const w = where.map(([c], i) => `${c} = $${i + 1}`).join(" and ");
              const r = await pg.query(`select ${cols} from public.${table} where ${w} limit 1`, where.map(([, v]) => v));
              return { data: r.rows[0] ?? null, error: null };
            },
          };
          return q;
        },
      };
    },
  };
}

const DATA = { saveVersion: 3, gold: 120, diamonds: 50, floor: 7, bestFloor: 8, towerLevels: [3, 2, 2, 1, 1], tutorial: { done: true, version: 1 } };
type Res = { ok: boolean; reason?: string; rev?: number; server?: { rev: number; summary: unknown } | null; rank?: { ok: boolean; reason?: string } };
const put = (pg: PGlite, who: string, body: Record<string, unknown>) =>
  savePut(pgdb(pg), who, { deviceId: "dev-1", appVersion: "0.1.0", data: DATA, ...body }) as Promise<Res>;
const rows = async (pg: PGlite, sql: string, args: unknown[] = []) => (await pg.query(sql, args)).rows as Record<string, unknown>[];

Deno.test("처음 put(baseRev 0) -> rev 1, get이 같은 data", async () => {
  const pg = await setup();
  assertEquals(await put(pg, A, { baseRev: 0 }), { ok: true, rev: 1 });
  const g = await saveGet(pgdb(pg), A);
  assertEquals(g.save?.rev, 1);
  assertEquals(g.save?.data, DATA);
  assertEquals(g.save?.deviceId, "dev-1");
  assertEquals(g.save?.platform, "android"); // players.platform(기기가 보낸 값 아님)
  assert(typeof g.save?.updatedAt === "number");
});

Deno.test("baseRev 1 -> rev 2, 다시 baseRev 1 -> conflict + server.rev 2, 없는 save에 baseRev 3 -> conflict", async () => {
  const pg = await setup();
  await put(pg, A, { baseRev: 0 });
  assertEquals((await put(pg, A, { baseRev: 1 })).rev, 2);
  const c = await put(pg, A, { baseRev: 1, data: { ...DATA, gold: 1 } });
  assertEquals(c.reason, "conflict");
  assertEquals(c.server?.rev, 2);
  assertEquals((c.server?.summary as { bestFloor: number }).bestFloor, 8);
  assertEquals((await put(pg, B, { baseRev: 3 })).reason, "conflict");
  assertEquals((await saveGet(pgdb(pg), A)).save?.data, DATA, "충돌한 data는 안 들어감");
});

Deno.test("force -> 성공 + save_backups overwrite 1줄, 백업은 사람당 최근 3개", async () => {
  const pg = await setup();
  await put(pg, A, { baseRev: 0 });
  await put(pg, A, { baseRev: 1 }); // 하루 첫 덮어쓰기 -> daily 1줄
  const f = await put(pg, A, { baseRev: 0, force: true, data: { ...DATA, bestFloor: 3 } });
  assertEquals(f, { ok: true, rev: 3 });
  assertEquals((await rows(pg, "select reason, rev from public.save_backups where player_id = $1 and reason = 'overwrite'", [A])).length, 1);
  assertEquals((await rows(pg, "select 1 from public.save_backups where player_id = $1 and reason = 'daily'", [A])).length, 1);
  await put(pg, A, { baseRev: 3 }); // 같은 날 두 번째 일반 저장 -> 백업 없음
  assertEquals((await rows(pg, "select 1 from public.save_backups where player_id = $1", [A])).length, 2);
  for (let i = 0; i < 3; i++) await put(pg, A, { baseRev: 0, force: true });
  assertEquals((await rows(pg, "select 1 from public.save_backups where player_id = $1", [A])).length, 3);
});

Deno.test("rewind(force + reason rewind): 덮기 전 save_backups(rewind), server_log save-rewind {serverRev, localRev}", async () => {
  const pg = await setup();
  await put(pg, A, { baseRev: 0 });
  await put(pg, A, { baseRev: 1 }); // rev 2 (daily 백업 1줄)
  const r = await put(pg, A, { baseRev: 7, force: true, reason: "rewind", localRev: 7, data: { ...DATA, bestFloor: 20 } });
  assertEquals(r, { ok: true, rev: 3 });
  assertEquals((await rows(pg, "select rev from public.save_backups where player_id = $1 and reason = 'rewind'", [A])).map((x) => Number(x.rev)), [2]);
  const [log] = await rows(pg, "select level, body from public.server_log where source = 'save-rewind'");
  assertEquals(log.level, "warn");
  assertEquals((log.body as { serverRev: number; localRev: number }), { uid: A, serverRev: 2, localRev: 7 });
  assertEquals((await put(pg, A, { baseRev: 3, reason: "other" })).reason, "badRequest");
});

Deno.test("260KB -> tooBig, saveVersion 없음·소수 -> badData, 타입이 틀리면 badRequest", async () => {
  const pg = await setup();
  assertEquals((await put(pg, A, { baseRev: 0, data: { ...DATA, pad: "x".repeat(260 * 1024) } })).reason, "tooBig");
  const { saveVersion: _, ...noVer } = DATA;
  assertEquals((await put(pg, A, { baseRev: 0, data: noVer })).reason, "badData");
  assertEquals((await put(pg, A, { baseRev: 0, data: { ...DATA, saveVersion: 2.5 } })).reason, "badData");
  assertEquals((await put(pg, A, { baseRev: "0" })).reason, "badRequest");
  assertEquals((await put(pg, A, { baseRev: 0, data: [1] })).reason, "badRequest");
  assertEquals((await put(pg, A, { baseRev: 0, force: "yes" })).reason, "badRequest");
  assertEquals((await rows(pg, "select 1 from public.saves")).length, 0);
});

Deno.test("summary는 서버가 계산(기기가 보낸 summary 무시), 이상한 값은 0", async () => {
  const pg = await setup();
  await put(pg, A, { baseRev: 0, data: { ...DATA, summary: { bestFloor: 999 } }, summary: { bestFloor: 999 } });
  const [s] = await rows(pg, "select summary from public.saves where player_id = $1", [A]);
  assertEquals(s.summary, { bestFloor: 8, floor: 7, diamonds: 50, gold: 120, towerSum: 9, tutorialDone: true });
  const [z] = await rows(pg, `select public.save_summary('{"bestFloor":"9","diamonds":-5,"towerLevels":[1,"x",2]}'::jsonb) s`);
  assertEquals(z.s, { bestFloor: 0, floor: 0, diamonds: 0, gold: 0, towerSum: 3, tutorialDone: false });
});

Deno.test("다른 플레이어 save는 못 읽음(save-get은 내 것만, 앱 JWT는 표 직접 못 읽음)", async () => {
  const pg = await setup();
  await put(pg, A, { baseRev: 0 });
  assertEquals((await saveGet(pgdb(pg), B)).save, null);
  await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`);
  let denied = 0;
  for (const t of ["saves", "save_backups"]) {
    try {
      await pg.query(`select * from public.${t}`);
    } catch {
      denied++;
    }
  }
  try {
    await pg.query("select public.save_put($1, 0, '{\"saveVersion\":3}'::jsonb, null, null, null)", [A]);
  } catch {
    denied++;
  }
  await pg.exec("reset role");
  assertEquals(denied, 3);
});

Deno.test("me_delete 후 saves·save_backups 0줄", async () => {
  const pg = await setup();
  await put(pg, A, { baseRev: 0 });
  await put(pg, A, { baseRev: 1 });
  await put(pg, B, { baseRev: 0 });
  await pg.query("select public.me_delete($1)", [A]);
  assertEquals((await rows(pg, "select 1 from public.saves where player_id = $1", [A])).length, 0);
  assertEquals((await rows(pg, "select 1 from public.save_backups where player_id = $1", [A])).length, 0);
  assertEquals((await rows(pg, "select 1 from public.saves where player_id = $1", [B])).length, 1, "남의 것은 그대로");
});

Deno.test("rank 실어 보낸 save-put -> normal_best 갱신, 상한 넘는 값은 rank.ok:false(save는 저장됨)", async () => {
  const pg = await setup();
  const r1 = await put(pg, A, { baseRev: 0, rank: { bestFloor: 8, reachedAt: 1 } });
  assertEquals(r1, { ok: true, rev: 1, rank: { ok: true } });
  assertEquals((await rows(pg, "select best_floor from public.normal_best where player_id = $1", [A]))[0].best_floor, 8);
  const r2 = await put(pg, A, { baseRev: 1, rank: { bestFloor: 10000, reachedAt: 1 } });
  assertEquals(r2.ok, true);
  assertEquals(r2.rev, 2);
  assertEquals(r2.rank, { ok: false, reason: "badRequest" });
  assertEquals((await rows(pg, "select best_floor from public.normal_best where player_id = $1", [A]))[0].best_floor, 8);
  await pg.query("update public.players set banned = true where id = $1", [A]);
  assertEquals((await put(pg, A, { baseRev: 2, rank: { bestFloor: 9 } })).rank, { ok: false, reason: "banned" });
});

Deno.test("이상치 기록(막지 않음): 다이아 +5000 넘게, 최고 층이 랭킹 기록 +50 넘게", async () => {
  const pg = await setup();
  await put(pg, A, { baseRev: 0 }); // bestFloor 8 > 0 + 50? 아님
  assertEquals((await rows(pg, "select 1 from public.server_log where source = 'save-put'")).length, 0);
  // 다이아 묶음 결제가 확인됐으면 그만큼은 이상치 아님.
  await pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id, verified_at)
    values ($1, 'play', 'dia.5', 'GPA.1', 'verified', 'iap:dia.5:GPA.1', now() + interval '1 second')`, [A]);
  const r = await put(pg, A, { baseRev: 1, data: { ...DATA, diamonds: 5040 } });
  assertEquals(r.ok, true);
  assertEquals((await rows(pg, "select 1 from public.server_log where source = 'save-put'")).length, 0, "결제 상한 안");
  await put(pg, A, { baseRev: 2, data: { ...DATA, diamonds: 50000, bestFloor: 70 } });
  const logs = await rows(pg, "select level, body from public.server_log where source = 'save-put' order by id");
  assertEquals(logs.map((l) => (l.body as { kind: string }).kind).sort(), ["bestFloor", "diamonds"]);
  assert(logs.every((l) => l.level === "warn"));
  assertEquals((await saveGet(pgdb(pg), A)).save?.rev, 3, "기록만, 저장은 됨");
});

// hello가 붙이는 att·mail·claims = 각 함수(att-status·mail-list·claims-pending) 응답과 같은 값.
// 가짜 db: 어떤 체인이든 표마다 정해 둔 rows로 끝난다(maybeSingle은 첫 줄).
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const chain = (rows: Record<string, unknown>[]): unknown =>
    new Proxy({}, {
      get(_, k) {
        if (k === "then") return (res: (v: unknown) => void) => res({ data: rows, error: null });
        if (k === "maybeSingle") return () => Promise.resolve({ data: rows[0] ?? null, error: null });
        return () => chain(rows);
      },
    });
  return { from: (t: string) => chain(tables[t] ?? []) };
}

Deno.test("hello 시작 정보: att·mail·claims가 각 함수 응답과 같음, save는 메타만", async () => {
  const db = fakeDb({
    attendance: [{ days: 3, last_date: "2026-11-01" }],
    mail: [{ id: 7, title_ko: "선물", title_en: "Gift", bundle: { diamonds: 5 }, expires_at: null, created_at: "2026-11-10T00:00:00Z" }],
    claims: [{ tx_id: "mail:7", kind: "mail", bundle: { diamonds: 5 } }],
    saves: [{ rev: 4, updated_at: "2026-11-12T09:20:00Z", device_id: "dev-1" }],
  });
  const s = await startInfo(db, A);
  assertEquals(s.att, await attStatus(db, A));
  assertEquals(s.mail, await mailList(db, A));
  assertEquals(s.claims, await claimsPending(db, A));
  assertEquals(s.mail.mail[0].claimed, true);
  assertEquals(s.claims.claims, [{ txId: "mail:7", kind: "mail", bundle: { diamonds: 5 } }]);
  assertEquals(s.save, { rev: 4, updatedAt: Date.parse("2026-11-12T09:20:00Z"), deviceId: "dev-1" });
});
