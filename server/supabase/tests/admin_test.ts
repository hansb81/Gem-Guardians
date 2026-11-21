// 관리자 A단계(docs/admin.md §5) - migrations 전부 + _shared/admin.ts adminRun + admin/actions.ts. PGlite 방식(s1_test 참고).
// supabase-js는 이 기능들이 쓰는 만큼만 SQL로 옮기는 가짜(fakeDb)로 흉내 낸다 - 기기 쪽 mail-list(visibleMail)·claims-pending도
// 진짜 _shared/start.ts 코드가 이 가짜를 거쳐 같은 DB를 본다. getClaims는 토큰 -> claims 표.
// 실행: deno test -A server/supabase/tests
import { PGlite } from "npm:@electric-sql/pglite@0.3";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { adminCors, adminOrigins, adminRun } from "../functions/_shared/admin.ts";
import { ACTIONS, bundleOfProduct, DIA_BONUS, firstBuyExtra } from "../functions/admin/actions.ts";
import { claimsPending, mailList } from "../functions/_shared/start.ts";
import { ITEM_IDS } from "../functions/_shared/coupon.ts";

const dir = new URL("../migrations/", import.meta.url);
const cfg = new URL("../../../config/", import.meta.url);
const STUB = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  create schema storage; create table storage.buckets (id text primary key, name text, public boolean); -- 20261119 threads_media
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const C = "00000000-0000-0000-0000-00000000000c";
const OWNER = "00000000-0000-0000-0000-0000000000f1";
const VIEWER = "00000000-0000-0000-0000-0000000000f2";
const NOBODY = "00000000-0000-0000-0000-0000000000f3";
const MISSING = "00000000-0000-0000-0000-0000000000ee";

// 토큰 -> JWT claims
const TOKENS: Record<string, Record<string, unknown>> = {
  owner: { sub: OWNER, aal: "aal2", is_anonymous: false },
  ownerAal1: { sub: OWNER, aal: "aal1", is_anonymous: false },
  viewer: { sub: VIEWER, aal: "aal2", is_anonymous: false },
  nobody: { sub: NOBODY, aal: "aal2", is_anonymous: false },
  anon: { sub: A, aal: "aal1", is_anonymous: true },
};

async function setup() {
  const pg = new PGlite();
  await pg.exec(STUB);
  const files = [...Deno.readDirSync(dir)].map((f) => f.name).filter((n) => n.endsWith(".sql")).sort();
  for (const f of files) await pg.exec(await Deno.readTextFile(new URL(f, dir)));
  for (const id of [A, B, C]) {
    await pg.query("insert into auth.users (id, is_anonymous) values ($1, true)", [id]);
    await pg.query("insert into public.players (id, platform, last_seen_at) values ($1, 'android', now())", [id]);
  }
  for (const id of [OWNER, VIEWER, NOBODY]) await pg.query("insert into auth.users (id) values ($1)", [id]);
  await pg.query("insert into public.admins (user_id, role) values ($1, 'owner'), ($2, 'viewer')", [OWNER, VIEWER]);
  return pg;
}
const rows = async (pg: PGlite, sql: string, args: unknown[] = []) => (await pg.query(sql, args)).rows as Record<string, unknown>[];

// ---------- supabase-js 가짜: rpc + from() 체인 일부 -> SQL ----------
const SET_FNS = new Set(["admin_player_search", "admin_resolve_players", "coupon_batch", "rank_normal_top", "comp_board"]);
const col = (c: string) => c.includes("->>") ? c.replace(/^(\w+)->>(\w+)$/, "$1->>'$2'") : `"${c}"`;
const val = (v: unknown) => (v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v);

function splitOr(s: string) {
  const out: string[] = [];
  let cur = "", q = false;
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (ch === "," && !q) (out.push(cur), (cur = ""));
    else cur += ch;
  }
  return [...out, cur];
}

function fakeDb(pg: PGlite) {
  const types = new Map<string, Record<string, string>>();
  async function argTypes(fn: string) {
    if (!types.has(fn)) {
      const r = await pg.query<{ n: string[]; t: string[] }>(
        "select p.proargnames n, array(select format_type(x, null) from unnest(p.proargtypes) x) t from pg_proc p where proname = $1", [fn]);
      const { n, t } = r.rows[0];
      types.set(fn, Object.fromEntries(t.map((ty, i) => [n[i], ty])));
    }
    return types.get(fn)!;
  }
  const from = (table: string) => {
    const where: string[] = [];
    const args: unknown[] = [];
    let cols = "*", order = "", limit = "", op: "select" | "update" | "insert" = "select", patch: Record<string, unknown> = {};
    let returning = false;
    const p = (v: unknown) => (args.push(val(v)), `$${args.length}`);
    const sql = () => {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      if (op === "update") {
        const set = Object.entries(patch).map(([k, v]) => `${col(k)} = ${p(v)}`).join(", ");
        return `update public.${table} set ${set}${w}${returning ? ` returning ${cols}` : ""}`;
      }
      if (op === "insert") {
        const ks = Object.keys(patch);
        return `insert into public.${table} (${ks.map(col).join(", ")}) values (${ks.map((k) => p(patch[k])).join(", ")})`;
      }
      return `select ${cols} from public.${table}${w}${order}${limit}`;
    };
    const run = async () => {
      try {
        return { data: (await pg.query(sql(), args)).rows, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    };
    const b = {
      select(c = "*") {
        if (op === "update") returning = true;
        cols = c;
        return b;
      },
      eq: (c: string, v: unknown) => (where.push(`${col(c)} = ${p(v)}`), b),
      gte: (c: string, v: unknown) => (where.push(`${col(c)} >= ${p(v)}`), b),
      lt: (c: string, v: unknown) => (where.push(`${col(c)} < ${p(v)}`), b),
      is: (c: string, v: null) => (where.push(`${col(c)} is ${v === null ? "null" : String(v)}`), b),
      in: (c: string, v: unknown[]) => (where.push(`${col(c)} = any(${p(v)})`), b),
      or(s: string) {
        where.push("(" + splitOr(s).map((part) => {
          const [c, o, ...rest] = part.split(".");
          const v = rest.join(".").replace(/^"|"$/g, "");
          return o === "is" ? `${col(c)} is ${v}` : `${col(c)} ${{ eq: "=", gt: ">", lt: "<" }[o]} ${p(v)}`;
        }).join(" or ") + ")");
        return b;
      },
      order: (c: string, o: { ascending?: boolean } = {}) => ((order = ` order by ${col(c)} ${o.ascending === false ? "desc" : "asc"}`), b),
      limit: (n: number) => ((limit = ` limit ${Number(n)}`), b),
      update: (r: Record<string, unknown>) => ((op = "update"), (patch = r), b),
      insert: (r: Record<string, unknown>) => ((op = "insert"), (patch = r), run()),
      maybeSingle: async () => {
        const r = await run();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: (res: (v: unknown) => void, rej: (e: unknown) => void) => run().then(res, rej),
    };
    return b;
  };
  return {
    from,
    async rpc(fn: string, a: Record<string, unknown> = {}) {
      const ty = await argTypes(fn);
      const names = Object.keys(a);
      const list = names.map((n, i) => `${n} => $${i + 1}::${ty[n]}`).join(", ");
      // supabase-js는 본문을 JSON으로 보낸다 = jsonb 인자는 문자열·null도 JSON 값
      const vals = names.map((n) => (ty[n] === "jsonb" ? JSON.stringify(a[n] ?? null) : val(a[n])));
      try {
        if (SET_FNS.has(fn)) return { data: (await pg.query(`select * from public.${fn}(${list})`, vals)).rows, error: null };
        const r = await pg.query<{ r: unknown }>(`select public.${fn}(${list}) r`, vals);
        return { data: r.rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    },
    auth: {
      getClaims: (token: string) =>
        Promise.resolve(TOKENS[token] ? { data: { claims: TOKENS[token] }, error: null } : { data: null, error: { message: "bad jwt" } }),
      admin: { getUserById: () => Promise.resolve({ data: { user: null }, error: null }) },
    },
  };
}

async function call(pg: PGlite, token: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "1.2.3.4, 5.6.7.8" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await adminRun(new Request("http://x/admin", { method: "POST", headers, body: JSON.stringify(body) }), ACTIONS, fakeDb(pg));
  return { status: res.status, ...(await res.json()) } as Record<string, unknown> & { status: number };
}
const w = (extra: Record<string, unknown>) => ({ requestId: crypto.randomUUID(), reason: "테스트", ...extra });
const okBundle = (b: unknown) => async (pg: PGlite) =>
  (await pg.query<{ v: boolean }>("select public.admin_bundle_ok($1::jsonb) v", [JSON.stringify(b)])).rows[0].v;

// ---------- 입구 ----------
Deno.test("입구: 토큰 없음·관리자 아님·익명·aal1 거절, viewer는 조회만, owner는 됨", async () => {
  const pg = await setup();
  assertEquals((await call(pg, null, { action: "me" })).status, 401);
  assertEquals((await call(pg, "garbage", { action: "me" })).reason, "auth");
  const nb = await call(pg, "nobody", { action: "me" });
  assertEquals([nb.status, nb.reason], [403, "notAdmin"]);
  const an = await call(pg, "anon", { action: "me" });
  assertEquals([an.status, an.reason], [403, "anonymous"]);
  const a1 = await call(pg, "ownerAal1", { action: "me" });
  assertEquals([a1.status, a1.reason], [401, "mfa"]);
  const v = await call(pg, "viewer", { action: "me" });
  assertEquals([v.ok, v.role], [true, "viewer"]);
  assertEquals((await call(pg, "viewer", { action: "dashboard" })).ok, true);
  const vo = await call(pg, "viewer", w({ action: "grant.send", mode: "mail", players: [A], bundle: { diamonds: 1 } }));
  assertEquals([vo.status, vo.reason], [403, "role"]);
  assertEquals((await rows(pg, "select 1 from public.admin_grants")).length, 0);
  assertEquals((await call(pg, "owner", { action: "nope" })).reason, "badAction");
  // 쓰기는 requestId(uuid)·reason 필수
  assertEquals((await call(pg, "owner", { action: "player.ban", id: A, banned: true, reason: "x" })).reason, "badRequest");
  assertEquals((await call(pg, "owner", { action: "player.ban", id: A, banned: true, requestId: crypto.randomUUID() })).reason, "badRequest");
  const me = await call(pg, "owner", { action: "me" });
  assertEquals([me.ok, me.role, me.uid], [true, "owner", OWNER]);
});

Deno.test("CORS: 관리자 목록만(env + localhost:5180), 게임 주소는 안 됨", () => {
  const o = adminOrigins("https://gem-guardians-admin.x.workers.dev, ");
  assertEquals(adminCors("https://gem-guardians-admin.x.workers.dev", o)["Access-Control-Allow-Origin"], "https://gem-guardians-admin.x.workers.dev");
  assertEquals(adminCors("http://localhost:5180", o)["Access-Control-Allow-Origin"], "http://localhost:5180");
  assertEquals(adminCors("https://gem-guardians.pages.dev", o)["Access-Control-Allow-Origin"], undefined);
});

// ---------- 지급 ----------
Deno.test("grant.send mail·direct: 기기 mail-list·claims-pending에 보임, 같은 requestId 두 번 = 1번만", async () => {
  const pg = await setup();
  const db = fakeDb(pg);
  const req = w({ action: "grant.send", mode: "mail", players: [A, B, A], bundle: { diamonds: 500, items: { hammer: 5 } }, title: { ko: "사과", en: "Sorry" } });
  const r1 = await call(pg, "owner", req);
  assertEquals([r1.ok, r1.mode, r1.count], [true, "mail", 2]);
  const r2 = await call(pg, "owner", req);
  assertEquals(r2.grantId, r1.grantId, "재시도 = 처음 결과");
  assertEquals((await rows(pg, "select 1 from public.admin_grants")).length, 1);
  assertEquals((await rows(pg, "select 1 from public.mail")).length, 2);
  const ml = await mailList(db, A);
  assertEquals(ml.mail.map((m) => [m.title.ko, m.bundle, m.claimed]), [["사과", { diamonds: 500, items: { hammer: 5 } }, false]]);
  assert(ml.mail[0].expiresAt! > Date.now() + 29 * 86400e3, "만료 기본 30일");
  assertEquals((await mailList(db, C)).mail.length, 0);

  const d = await call(pg, "owner", w({ action: "grant.send", mode: "direct", players: [C], bundle: { gold: 1000, skills: { spike: "+1" }, flags: ["slot4"] } }));
  assertEquals(d.ok, true);
  assertEquals((await claimsPending(db, C)).claims, [{ txId: `admin:${d.grantId}`, kind: "admin", bundle: { gold: 1000, skills: { spike: "+1" }, flags: ["slot4"] } }]);
  const [audit] = await rows(pg, "select admin_id, action, target_player, ip from public.admin_audit where target = $1", [`grant:${d.grantId}`]);
  assertEquals(audit, { admin_id: OWNER, action: "grant.send", target_player: C, ip: "1.2.3.4" });
  assertEquals((await rows(pg, "select 1 from public.admin_audit")).length, 2);
});

Deno.test("grant.send 거절: 상한·모르는 키·빈 번들, 201명, 없는 id 섞이면 전체 거절", async () => {
  const pg = await setup();
  for (const bad of [{ diamonds: 50001 }, { gold: 100000001 }, { items: { hammer: 1000 } }, { itemz: { hammer: 1 } }, {}]) {
    const r = await call(pg, "owner", w({ action: "grant.send", mode: "mail", players: [A], bundle: bad }));
    assertEquals(r.reason, "badBundle", JSON.stringify(bad));
  }
  const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-0000-0001-${String(i).padStart(12, "0")}`);
  assertEquals((await call(pg, "owner", w({ action: "grant.send", mode: "mail", players: many, bundle: { gold: 1 } }))).reason, "badPlayers");
  const m = await call(pg, "owner", w({ action: "grant.send", mode: "direct", players: [A, MISSING], bundle: { gold: 1 } }));
  assertEquals([m.ok, m.reason, m.missing], [false, "missing", [MISSING]]);
  assertEquals((await rows(pg, "select 1 from public.admin_grants")).length, 0);
  assertEquals((await rows(pg, "select 1 from public.claims")).length, 0);
  // SQL 함수도 200명 넘으면 거절(입구 검사를 건너뛰어도)
  const r = await pg.query<{ r: { reason: string } }>("select public.admin_grant($1, $2, 'mail', $3::uuid[], '{\"gold\":1}', null, null, null, 'x', null) r",
    [OWNER, crypto.randomUUID(), many]);
  assertEquals(r.rows[0].r.reason, "badPlayers");
});

Deno.test("admin_bundle_ok: 키별 검사(skills·flags·levels), config 상수와 같음", async () => {
  const pg = await setup();
  const yes = [
    { diamonds: 50000, gold: 100000000 }, { items: { revive: 999 } }, { skills: { red: 5, ult: "+1", lava: 0 } },
    { flags: ["slot4", "adFree"] }, { levels: { towers: [null, 30, null, null, 200] } }, { levels: { floor: 300 } },
    { levels: { towers: [1, 1, 1, 1, 1], floor: 1 }, gold: 5 },
  ];
  const no = [
    { skills: { red: 6 } }, { skills: { pink: 1 } }, { skills: { red: "+2" } }, { skills: {} }, { flags: ["vip"] },
    { flags: ["slot4", "slot4"] }, { flags: [] }, { levels: {} }, { levels: { towers: [null, null, null, null, null] } },
    { levels: { towers: [1, 2, 3, 4] } }, { levels: { towers: [201, null, null, null, null] } }, { levels: { floor: 301 } },
    { levels: { floor: 0 } }, { levels: { floor: 5, best: 3 } }, { gold: 1.5 }, { diamonds: 0 }, { items: { hammer: 0 } },
  ];
  for (const b of yes) assertEquals(await okBundle(b)(pg), true, JSON.stringify(b));
  for (const b of no) assertEquals(await okBundle(b)(pg), false, JSON.stringify(b));
  // config와 같은 상수
  for (const id of ITEM_IDS) assert(await okBundle({ items: { [id]: 1 } })(pg), id);
  const shop = JSON.parse(await Deno.readTextFile(new URL("shop.json", cfg)));
  for (const k of [...Object.keys(shop.skills.color), ...Object.keys(shop.skills.special)]) assert(await okBundle({ skills: { [k]: 1 } })(pg), k);
  const sql = await Deno.readTextFile(new URL("20261116000000_admin.sql", dir));
  const skills = sql.slice(sql.indexOf("skill_ids constant"), sql.indexOf("];", sql.indexOf("skill_ids constant")));
  assertEquals([...skills.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), [...Object.keys(shop.skills.color), ...Object.keys(shop.skills.special)].sort());
  const items = sql.slice(sql.indexOf("item_ids constant"), sql.indexOf("];", sql.indexOf("item_ids constant")));
  assertEquals([...items.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), ITEM_IDS);
  const balance = JSON.parse(await Deno.readTextFile(new URL("balance.json", cfg)));
  const max = balance.tower.maxLevel;
  assertEquals(balance.tower.towers.map((t: { color: string }) => t.color), ["red", "blue", "yellow", "green", "purple"]);
  assert(await okBundle({ levels: { towers: [max, null, null, null, null] } })(pg));
  assertEquals(await okBundle({ levels: { towers: [max + 1, null, null, null, null] } })(pg), false);
});

Deno.test("grant.revoke: 받은 사람은 그대로, 안 받은 사람만 회수, 회수된 우편 mail_claim -> notFound", async () => {
  const pg = await setup();
  const db = fakeDb(pg);
  const g = await call(pg, "owner", w({ action: "grant.send", mode: "mail", players: [A, B], bundle: { diamonds: 10 } }));
  const mailOf = async (p: string) => (await rows(pg, "select id from public.mail where player_id = $1", [p]))[0].id as number;
  const mA = await mailOf(A), mB = await mailOf(B);
  assertEquals(((await db.rpc("mail_claim", { p_player: A, p_mail: mA })).data as { ok: boolean }).ok, true);
  const r = await call(pg, "owner", w({ action: "grant.revoke", grantId: g.grantId }));
  assertEquals([r.revoked, r.received], [1, 1]);
  assertEquals((await mailList(db, A)).mail.map((m) => m.claimed), [true], "받은 사람 우편함은 그대로");
  assertEquals((await mailList(db, B)).mail, [], "회수된 우편은 목록에서 빠짐");
  assertEquals(((await db.rpc("mail_claim", { p_player: B, p_mail: mB })).data as { reason: string }).reason, "notFound");
  assert((await rows(pg, "select revoked_at from public.admin_grants"))[0].revoked_at);

  // 바로 지급: 기기가 받은(granted_at) 사람은 그대로, 나머지 claims 삭제
  const d = await call(pg, "owner", w({ action: "grant.send", mode: "direct", players: [A, C], bundle: { gold: 5 } }));
  await pg.query("update public.claims set granted_at = now() where player_id = $1 and tx_id = $2", [A, `admin:${d.grantId}`]);
  const r2 = await call(pg, "owner", w({ action: "grant.revoke", grantId: d.grantId }));
  assertEquals([r2.revoked, r2.received], [1, 1]);
  assertEquals((await claimsPending(db, C)).claims, []);
  assertEquals((await rows(pg, "select player_id from public.claims where tx_id = $1", [`admin:${d.grantId}`])).map((x) => x.player_id), [A]);
});

Deno.test("grant.revoke player: 2명 지급 -> 1명 몫만 회수, 다른 1명은 받기 가능, 감사 대상 = 그 사람", async () => {
  const pg = await setup();
  const db = fakeDb(pg);
  const g = await call(pg, "owner", w({ action: "grant.send", mode: "mail", players: [A, B], bundle: { diamonds: 10 } }));
  const r = await call(pg, "owner", w({ action: "grant.revoke", grantId: g.grantId, player: A }));
  assertEquals([r.ok, r.revoked, r.received, r.player], [true, 1, 0, A]);
  assertEquals((await mailList(db, A)).mail, [], "A 우편은 회수");
  const mB = (await rows(pg, "select id from public.mail where player_id = $1", [B]))[0].id;
  assertEquals(((await db.rpc("mail_claim", { p_player: B, p_mail: mB })).data as { ok: boolean }).ok, true, "B는 받기 가능");
  assertEquals((await rows(pg, "select revoked_at from public.admin_grants"))[0].revoked_at, null, "묶음 전체는 회수 안 됨");
  const [audit] = await rows(pg, "select target_player, target from public.admin_audit where action = 'grant.revoke'");
  assertEquals(audit, { target_player: A, target: `grant:${g.grantId}` });
  // 지급에 없는 사람·잘못된 uid
  assertEquals((await call(pg, "owner", w({ action: "grant.revoke", grantId: g.grantId, player: C }))).reason, "notFound");
  assertEquals((await call(pg, "owner", w({ action: "grant.revoke", grantId: g.grantId, player: "x" }))).reason, "badRequest");

  // 바로 지급: C 몫만 삭제, B는 claims-pending에 그대로
  const d = await call(pg, "owner", w({ action: "grant.send", mode: "direct", players: [B, C], bundle: { gold: 5 } }));
  const r2 = await call(pg, "owner", w({ action: "grant.revoke", grantId: d.grantId, player: C }));
  assertEquals([r2.revoked, r2.received], [1, 0]);
  assertEquals((await claimsPending(db, C)).claims, []);
  assertEquals((await claimsPending(db, B)).claims.map((c) => c.txId).filter((t) => t.startsWith("admin:")), [`admin:${d.grantId}`]);

  // 전체 발송은 사람별 회수 불가
  const bc = await call(pg, "owner", w({ action: "mail.broadcast", bundle: { gold: 1 }, confirm: "전체 발송" }));
  assertEquals((await call(pg, "owner", w({ action: "grant.revoke", grantId: bc.grantId, player: A }))).reason, "badRequest");
});

Deno.test("mail.broadcast: confirm 없으면 거절, 하루 3회 넘으면 거절, 모두에게 보임", async () => {
  const pg = await setup();
  const db = fakeDb(pg);
  const base = { action: "mail.broadcast", bundle: { diamonds: 100 }, title: { ko: "점검 보상", en: "Maintenance" } };
  assertEquals((await call(pg, "owner", w({ ...base }))).reason, "confirm");
  assertEquals((await call(pg, "owner", w({ ...base, confirm: "전체발송" }))).reason, "confirm");
  for (let i = 0; i < 3; i++) assertEquals((await call(pg, "owner", w({ ...base, confirm: "전체 발송" }))).ok, true);
  assertEquals((await call(pg, "owner", w({ ...base, confirm: "전체 발송" }))).reason, "dailyLimit");
  assertEquals((await mailList(db, C)).mail.length, 3);
  // 어제 것은 세지 않음
  await pg.query("update public.admin_grants set at = now() - interval '1 day'");
  assertEquals((await call(pg, "owner", w({ ...base, confirm: "전체 발송" }))).ok, true);
});

Deno.test("purchase.regrant: verified·미지급만, 원래 tx_id로 claims(kind admin), 두 번 해도 1줄, 첫 구매 2배", async () => {
  const pg = await setup();
  await pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id)
    values ($1, 'play', 'dia.2', 'GPA.9', 'verified', 'iap:dia.2:GPA.9'), ($1, 'play', 'dia.0', 'GPA.8', 'granted', 'iap:dia.0:GPA.8')`, [A]);
  const [p9, p8] = (await rows(pg, "select id from public.purchases order by order_id desc")).map((r) => r.id);
  const r1 = await call(pg, "owner", w({ action: "purchase.regrant", id: p9 }));
  const r2 = await call(pg, "owner", w({ action: "purchase.regrant", id: p9 }));
  assertEquals([r1.ok, r1.created, r1.firstPurchaseBonus, r2.ok, r2.created], [true, true, true, true, false]);
  // dia.2: grant 690(기본 600 + 보너스 90) -> 첫 구매면 기본 600 더 = 1290 (기기 buyProduct와 같은 규칙)
  const dia = (bundleOfProduct("dia.2") as { diamonds: number }).diamonds;
  assertEquals(firstBuyExtra("dia.2"), dia - DIA_BONUS[2]);
  const c = await rows(pg, "select tx_id, kind, bundle from public.claims where player_id = $1", [A]);
  assertEquals(c, [{ tx_id: "iap:dia.2:GPA.9", kind: "admin", bundle: { diamonds: dia + firstBuyExtra("dia.2") } }]);
  assertEquals((await call(pg, "owner", w({ action: "purchase.regrant", id: p8 }))).reason, "notEligible");

  // 같은 상품을 앞서 산(granted) 기록이 있으면 첫 구매 아님 / 다이아 묶음이 아니면 보너스 없음
  await pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id, purchased_at)
    values ($1, 'play', 'dia.3', 'GPA.1', 'granted', 'iap:dia.3:GPA.1', now() - interval '1 day'),
           ($1, 'play', 'dia.3', 'GPA.2', 'verified', 'iap:dia.3:GPA.2', now()),
           ($1, 'play', 'pack.starter', 'GPA.3', 'verified', 'iap:pack.starter:GPA.3', now())`, [B]);
  const id = async (o: string) => (await rows(pg, "select id from public.purchases where order_id = $1", [o]))[0].id;
  const r3 = await call(pg, "owner", w({ action: "purchase.regrant", id: await id("GPA.2") }));
  assertEquals([r3.firstPurchaseBonus, (r3.bundle as { diamonds: number }).diamonds], [false, (bundleOfProduct("dia.3") as { diamonds: number }).diamonds]);
  const r4 = await call(pg, "owner", w({ action: "purchase.regrant", id: await id("GPA.3") }));
  assertEquals([r4.firstPurchaseBonus, r4.bundle], [false, bundleOfProduct("pack.starter")]);
  assertEquals(firstBuyExtra("pack.starter"), 0);
});

Deno.test("claims-granted: 복구분을 기기가 받으면 결제도 지급됨, 다시 복구 -> 아무 일 없음, 환불 결제는 안 건드림", async () => {
  const pg = await setup();
  const db = fakeDb(pg);
  await pg.query(`insert into public.purchases (player_id, store, product_key, order_id, status, tx_id)
    values ($1, 'play', 'dia.1', 'GPA.5', 'verified', 'iap:dia.1:GPA.5'), ($1, 'play', 'dia.0', 'GPA.6', 'verified', 'iap:dia.0:GPA.6')`, [A]);
  const [p5, p6] = (await rows(pg, "select id from public.purchases order by order_id")).map((r) => r.id);
  const r = await call(pg, "owner", w({ action: "purchase.regrant", id: p5 }));
  await call(pg, "owner", w({ action: "purchase.regrant", id: p6 }));
  await pg.query("update public.purchases set status = 'refunded' where id = $1", [p6]); // 복구 뒤 환불됨
  // 기기: claims-pending -> grant -> claims-granted(함수가 부르는 rpc 그대로)
  const txs = (await claimsPending(db, A)).claims.map((c) => c.txId).sort();
  assertEquals(txs, ["iap:dia.0:GPA.6", "iap:dia.1:GPA.5"]);
  assertEquals((await db.rpc("claims_granted", { p_player: A, p_tx_ids: txs })).data, 1);
  const list = (await call(pg, "viewer", { action: "purchase.list" })).purchases as { id: number; status: string; granted_at: unknown }[];
  const g5 = list.find((x) => x.id === p5)!, g6 = list.find((x) => x.id === p6)!;
  assertEquals([g5.status, !!g5.granted_at, g6.status, g6.granted_at], ["granted", true, "refunded", null]);
  const [b] = await rows(pg, "select granted_bundle from public.purchases where id = $1", [p5]);
  assertEquals(b.granted_bundle, r.bundle);
  assertEquals((await claimsPending(db, A)).claims, []);
  // 다시 복구 -> 거절, claims·결제 그대로
  assertEquals((await call(pg, "owner", w({ action: "purchase.regrant", id: p5 }))).reason, "notEligible");
  assertEquals((await rows(pg, "select 1 from public.claims where player_id = $1", [A])).length, 2);
  // 두 번 확인해도 결제 갱신 없음
  assertEquals((await db.rpc("claims_granted", { p_player: A, p_tx_ids: txs })).data, 0);
});

Deno.test("DIA_BONUS == config/shop.json diaBundles bonus", async () => {
  const shop = JSON.parse(await Deno.readTextFile(new URL("shop.json", cfg)));
  assertEquals(DIA_BONUS, shop.diaBundles.map((d: { bonus: number }) => d.bonus));
});

Deno.test("player.*: before/after 감사, rank_hidden은 순위표에서 빠지고 본인은 기록 그대로", async () => {
  const pg = await setup();
  for (const [id, f] of [[A, 50], [B, 40]] as const) {
    await pg.query("update public.players set nickname = $2 where id = $1", [id, `n${f}`]);
    await pg.query("select public.rank_normal_submit($1, $2)", [id, f]);
  }
  const h = await call(pg, "owner", w({ action: "player.rankHide", id: A, hidden: true }));
  assertEquals([h.ok, h.before, h.after], [true, false, true]);
  const top = await rows(pg, "select nickname, rank from public.rank_normal_top(100)");
  assertEquals(top, [{ nickname: "n40", rank: 1 }]);
  const me = (await rows(pg, "select public.rank_normal_me($1) r", [A]))[0].r as { value: number; rank: number };
  assertEquals([me.value, me.rank], [50, 1]);
  await pg.query("insert into public.comp_best (season_id, player_id, points, floor, at) values ('2026-W46', $1, 10, 3, now()), ('2026-W46', $2, 5, 2, now())", [A, B]);
  assertEquals((await rows(pg, "select player_id from public.comp_board('2026-W46')")).map((r) => r.player_id), [B]);

  const n = await call(pg, "owner", w({ action: "player.nicknameReset", id: B }));
  assertEquals([n.before, n.after], ["n40", null]);
  await call(pg, "owner", w({ action: "player.note", id: B, note: "문의 #12" }));
  await call(pg, "owner", w({ action: "player.ban", id: B, banned: true }));
  const pb = (await rows(pg, "select nickname, note, banned from public.players where id = $1", [B]))[0];
  assertEquals(pb, { nickname: null, note: "문의 #12", banned: true });
  const acts = (await rows(pg, "select action from public.admin_audit where target_player = $1 order by id", [B])).map((r) => r.action);
  assertEquals(acts, ["player.nickname_reset", "player.note", "player.banned"]);
  assertEquals((await call(pg, "owner", w({ action: "player.ban", id: B, banned: "yes" }))).reason, "badRequest");
});

Deno.test("조회: search·preview·dashboard·grant.list", async () => {
  const pg = await setup();
  await pg.query("update public.players set nickname = 'Hero_1', app_version = '1.0.3' where id = $1", [A]);
  await pg.query("update public.players set deleted_at = now() where id = $1", [C]);
  const s1 = await call(pg, "viewer", { action: "player.search", q: "00000000" });
  assertEquals((s1.players as unknown[]).length, 3);
  const s2 = await call(pg, "viewer", { action: "player.search", q: "hero" });
  assertEquals((s2.players as { id: string }[]).map((p) => p.id), [A]);
  const s3 = await call(pg, "viewer", { action: "player.search", q: B });
  assertEquals((s3.players as { id: string }[]).map((p) => p.id), [B]);
  const pv = await call(pg, "owner", { action: "grant.preview", players: [A, "00000000", C, MISSING], bundle: { levels: { floor: 10 } } });
  assertEquals((pv.players as { status: string }[]).map((p) => p.status), ["found", "ambiguous", "deleted", "missing"]);
  assertEquals([pv.bundleOk, pv.oldApp], [true, []]);
  assertEquals((await rows(pg, "select 1 from public.admin_audit")).length, 0, "preview는 쓰기 없음");
  const g = await call(pg, "owner", w({ action: "grant.send", mode: "mail", players: [A, B], bundle: { gold: 1 } }));
  await pg.query("select public.mail_claim($1, (select id from public.mail where player_id = $1))", [A]);
  const gl = await call(pg, "viewer", { action: "grant.list" });
  assertEquals((gl.grants as { id: number; received: number }[]).map((x) => [x.id, x.received]), [[g.grantId, 1]]);
  const dash = await call(pg, "viewer", { action: "dashboard" });
  const st = dash.stats as Record<string, number>;
  assertEquals([st.activeToday, st.newToday, st.deleteStuck, st.pendingClaims], [3, 3, 1, 1]);
});

Deno.test("me_delete·사용자 삭제 뒤에도 admin_audit·admin_grants 남음", async () => {
  const pg = await setup();
  await call(pg, "owner", w({ action: "grant.send", mode: "mail", players: [A], bundle: { gold: 1 } }));
  await call(pg, "owner", w({ action: "grant.send", mode: "direct", players: [A], bundle: { gold: 2 } }));
  await call(pg, "owner", w({ action: "player.note", id: A, note: "x" }));
  await pg.query("select public.me_delete($1)", [A]);
  await pg.query("delete from auth.users where id = $1", [A]);
  assertEquals((await rows(pg, "select 1 from public.players where id = $1", [A])).length, 0);
  assertEquals((await rows(pg, "select 1 from public.admin_audit where target_player = $1", [A])).length, 3);
  assertEquals((await rows(pg, "select player_ids from public.admin_grants")).map((r) => r.player_ids), [[A], [A]]);
  // 회수도 깨지지 않음(우편·claims가 이미 없음)
  const r = await call(pg, "owner", w({ action: "grant.revoke", grantId: 1 }));
  assertEquals([r.ok, r.revoked, r.received], [true, 0, 0]);
});

Deno.test("쿠폰: service_role로 만들기·묶음·끄기, 같은 requestId는 한 번", async () => {
  const pg = await setup();
  const req = w({ action: "coupon.create", code: "admin-1", title: { ko: "a", en: "b" }, bundle: { diamonds: 10 }, endsAt: "2027-01-01T00:00:00Z" });
  assertEquals((await call(pg, "owner", req)).ok, true);
  assertEquals((await call(pg, "owner", req)).ok, true, "재시도 = 처음 결과");
  assertEquals((await rows(pg, "select 1 from public.admin_audit where action = 'coupon.create'")).length, 1);
  const bad = await call(pg, "owner", w({ action: "coupon.create", code: "ADMIN1", title: { ko: "a", en: "b" }, bundle: { diamonds: 10 } }));
  assertEquals(bad.reason, "badRequest");
  assert(String(bad.message).includes("이미 있는"));
  const bt = await call(pg, "owner", w({ action: "coupon.batch", campaign: "b1", count: 3, title: { ko: "a", en: "b" }, bundle: { gold: 5 } }));
  assertEquals((bt.data as unknown[]).length, 3);
  assertEquals((await call(pg, "owner", w({ action: "coupon.toggle", campaign: "b1", enabled: false }))).ok, true);
  const list = await call(pg, "viewer", { action: "coupon.list" });
  assertEquals((list.coupons as { campaign: string; enabled: boolean }[]).find((c) => c.campaign === "b1")?.enabled, false);
  // service_role 실행 권한
  await pg.exec("set role service_role");
  await pg.query("select public.coupon_create('SVC1', 'a', 'b', '{\"gold\":1}', null)");
  await pg.query("select * from public.coupon_batch('svc', 1, 'a', 'b', '{\"gold\":1}', null)");
  await pg.query("select public.admin_dashboard()");
  await pg.exec("reset role");
});

Deno.test("권한: anon·authenticated는 새 표·admin_* 함수 못 씀", async () => {
  const pg = await setup();
  for (const role of ["anon", "authenticated"]) {
    await pg.exec(`set role ${role}`);
    for (const q of ["select * from public.admins", "select * from public.admin_audit", "select * from public.admin_grants",
      "select public.admin_dashboard()", "select public.admin_bundle_ok('{}')"]) {
      let failed = false;
      try {
        await pg.query(q);
      } catch {
        failed = true;
      }
      assert(failed, `${role}: ${q}`);
    }
    await pg.exec("reset role");
  }
});
