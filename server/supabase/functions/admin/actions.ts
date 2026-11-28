// 관리자 action 표(docs/admin.md §5-2). index.ts가 adminHandle로 묶는다 - 테스트가 가짜 db로 바로 부를 수 있게 따로 둔다.
// 쓰기(owner)는 전부 admin_* SQL 함수 한 번 = 한 트랜잭션 + admin_audit(같은 requestId면 처음 결과 그대로).
import { type Action, type AdminCtx, type Db, isUuid } from "../_shared/admin.ts";
import { fail, must } from "../_shared/result.ts";
import { product } from "../_shared/iap.ts";

// levels 키를 아는 앱 버전(C단계). null = 아직 없음 -> 버전 경고 생략.
export const LEVELS_MIN_APP_VERSION: string | null = null;
export const BROADCAST_CONFIRM = "전체 발송";
// config/shop.json diaBundles[N].bonus (N = products.json dia.N) - 순서 동결. tests/admin_test.ts가 config와 비교한다.
export const DIA_BONUS = [0, 30, 90, 320, 850, 2100];

// 다이아 묶음 첫 구매 2배(기기 src/core/shop/shop.js buyProduct 'diaBundle'): 첫 구매면 기본 다이아(grant.diamonds - bonus)만큼 더.
// 다이아 묶음이 아니면 0.
export function firstBuyExtra(key: string) {
  const m = /^dia\.(\d+)$/.exec(key);
  const dia = (product(key)?.grant as { diamonds?: number } | undefined)?.diamonds;
  if (!m || !dia || DIA_BONUS[Number(m[1])] == null) return 0;
  return dia - DIA_BONUS[Number(m[1])];
}

const EVENT_ID = /^[A-Za-z0-9_-]{1,40}$/; // SQL event_create와 같은 규칙
const EVENT_PLATFORMS = ["web", "toss", "android", "onestore", "ios"]; // players.platform 값(hello PLATFORMS)
export const BANNER_W = 236, BANNER_H = 55;
// PNG 서명 + IHDR 너비·높이. PNG가 아니면 null.
export function pngSize(b: Uint8Array): [number, number] | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v) || String.fromCharCode(...b.slice(12, 16)) !== "IHDR") return null;
  const v = new DataView(b.buffer, b.byteOffset);
  return [v.getUint32(16), v.getUint32(20)];
}
// 번들 비교용(키 순서 무시).
const sortKeys = (v: unknown): unknown =>
  v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
    : v ?? null;

const rpc = async (db: Db, fn: string, args: Record<string, unknown> = {}) => must(await db.rpc(fn, args));
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
const limitOf = (v: unknown, def = 100) => Math.min(500, Math.max(1, Number(v) || def));
const tsOrNull = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
// 점 구분 숫자 버전 비교(1.2.10 > 1.2.9). 못 읽으면 낮은 버전으로 본다.
const verLt = (a: string | null, b: string) => {
  const x = (a ?? "").split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = Number.isFinite(x[i]) ? x[i] : 0;
    const q = y[i] ?? 0;
    if (p !== q) return p < q;
  }
  return false;
};

const playerSet = (field: string, value: (b: Record<string, unknown>) => unknown): Action => ({
  role: "owner", write: true,
  run: async ({ uid, body, db, ip, requestId, reason }) => {
    if (!isUuid(body.id)) return fail("badRequest");
    const v = value(body);
    if (v === undefined) return fail("badRequest");
    return rpc(db, "admin_player_set", {
      p_admin: uid, p_request: requestId, p_player: body.id, p_field: field, p_value: v, p_reason: reason, p_ip: ip,
    });
  },
});

// 쿠폰·이벤트: SQL 함수·표 쓰기(SQL 예외 = 입력 오류 메시지) + 감사. 같은 requestId면 저장된 결과.
async function auditWrite(ctx: AdminCtx, action: string, target: string, fn: () => Promise<{ data: unknown; error: unknown }>) {
  const prev = must(await ctx.db.from("admin_audit").select("after").eq("request_id", ctx.requestId).maybeSingle()) as
    { after: unknown } | null;
  if (prev) return prev.after;
  const { data, error } = await fn();
  if (error) return fail("badRequest", { message: (error as { message?: string }).message ?? String(error) });
  const result = { ok: true, data };
  must(await ctx.db.rpc("admin_audit_add", {
    p_admin: ctx.uid, p_request: ctx.requestId, p_action: action, p_target_player: null, p_target: target,
    p_reason: ctx.reason, p_before: null, p_after: result, p_ip: ctx.ip,
  }));
  return result;
}

// 기기 bundleOfGrant(src/core/shop/shop.js)와 같은 모양: products.json grant -> grant() 번들.
export function bundleOfProduct(key: string) {
  const g = product(key)?.grant as { diamonds?: number; items?: Record<string, number>; slot4?: boolean; adFree?: boolean } | undefined;
  if (!g) return null;
  const flags = [...(g.slot4 ? ["slot4"] : []), ...(g.adFree ? ["adFree"] : [])];
  return { ...(g.diamonds ? { diamonds: g.diamonds } : {}), ...(g.items && Object.keys(g.items).length ? { items: g.items } : {}),
    ...(flags.length ? { flags } : {}) };
}

// save.data에서 관리 화면에 필요한 것만(전체 save JSON은 내려보내지 않음).
function savePick(d: Record<string, unknown> | null) {
  if (!d) return null;
  const inv = (d.inv ?? {}) as { items?: unknown; perm?: { skills?: unknown; flags?: unknown } };
  const shop = (d.shop ?? {}) as { passes?: unknown; passHistory?: unknown };
  return {
    passes: shop.passes ?? null, passHistory: shop.passHistory ?? null, // 패스 해지 환불의 "받은 일수" 확인용
    gold: d.gold, diamonds: d.diamonds, floor: d.floor, bestFloor: d.bestFloor, towerLevels: d.towerLevels,
    items: inv.items ?? null, skills: inv.perm?.skills ?? null, flags: inv.perm?.flags ?? null,
  };
}

export const ACTIONS: Record<string, Action> = {
  me: { role: "viewer", run: ({ uid, role }) => Promise.resolve({ ok: true, uid, role, now: Date.now() }) },

  dashboard: {
    role: "viewer",
    run: async ({ db }) => {
      const [stats, purchases, errors, active] = await Promise.all([
        rpc(db, "admin_dashboard"),
        db.from("v_purchases_recent").select("*").limit(10),
        db.from("server_log").select("id, at, source, body").eq("level", "error").order("id", { ascending: false }).limit(10),
        // 전체 발송 대상 수 안내(§5-3): 최근 30일 접속
        db.from("players").select("id", { count: "exact", head: true }).gte("last_seen_at", new Date(Date.now() - 30 * 86400e3).toISOString()),
      ]);
      return { ok: true, stats, purchases: must(purchases), errors: must(errors), active30d: active.count ?? null };
    },
  },

  "player.search": {
    role: "viewer",
    run: async ({ body, db }) => {
      const q = str(body.q, 100);
      if (!q?.trim()) return fail("badRequest");
      return { ok: true, players: await rpc(db, "admin_player_search", { p_q: q }) };
    },
  },

  "player.get": {
    role: "viewer",
    run: async ({ body, db }) => {
      const id = body.id;
      if (!isUuid(id)) return fail("badRequest");
      const player = must(await db.from("players").select("*").eq("id", id).maybeSingle());
      if (!player) return fail("notFound");
      const [save, purchases, claims, mail, best, logs, audit, auth, comp] = await Promise.all([
        db.from("saves").select("data, summary, rev, updated_at, app_version, platform, device_id").eq("player_id", id).maybeSingle(),
        db.from("purchases").select("id, store, product_key, order_id, price_krw, status, tx_id, purchased_at, verified_at, granted_at, refunded_at, granted_bundle")
          .eq("player_id", id).order("id", { ascending: false }).limit(100),
        db.from("claims").select("tx_id, kind, bundle, claimed_at, granted_at").eq("player_id", id).order("claimed_at", { ascending: false }).limit(100),
        db.from("mail").select("id, title_ko, title_en, bundle, expires_at, created_at, grant_id, revoked_at").eq("player_id", id)
          .order("id", { ascending: false }).limit(100),
        db.from("normal_best").select("best_floor, reached_at").eq("player_id", id).maybeSingle(),
        db.from("server_log").select("id, at, source, level, body").eq("body->>uid", id).order("id", { ascending: false }).limit(50),
        db.from("admin_audit").select("*").eq("target_player", id).order("id", { ascending: false }).limit(50),
        db.auth.admin.getUserById(id),
        db.from("comp_best").select("season_id, points, floor, at").eq("player_id", id).order("season_id", { ascending: false }).limit(20),
      ]);
      const mailRows = (must(mail) ?? []) as { id: number }[];
      const got = mailRows.length
        ? new Set(((must(await db.from("claims").select("tx_id").eq("player_id", id).in("tx_id", mailRows.map((m) => `mail:${m.id}`))) ?? []) as
          { tx_id: string }[]).map((c) => c.tx_id))
        : new Set<string>();
      const s = must(save) as { data: Record<string, unknown> } | null;
      const u = auth.data?.user as { is_anonymous?: boolean; identities?: { provider: string }[]; created_at?: string } | undefined;
      return {
        ok: true, player,
        save: s && { ...s, data: undefined, picked: savePick(s.data) },
        purchases: must(purchases), claims: must(claims),
        mail: mailRows.map((m) => ({ ...m, claimed: got.has(`mail:${m.id}`) })),
        normalBest: must(best), compBest: must(comp), logs: must(logs), audit: must(audit),
        auth: u ? { isAnonymous: !!u.is_anonymous, providers: (u.identities ?? []).map((i) => i.provider), createdAt: u.created_at } : null,
      };
    },
  },

  // 순위표(비정상 계정 찾기): 게임 순위표와 달리 숨김·정지·탈퇴도 포함하고 표시만 한다. 가입 시각·save 요약을 같이.
  "rank.list": {
    role: "viewer",
    run: async ({ body, db }) => {
      const limit = limitOf(body.limit, 200);
      const who = "players!inner(nickname, created_at, banned, rank_hidden, deleted_at, platform, app_version, saves(summary))";
      const hiddenOnly = body.hiddenOnly === true;
      if (body.mode === "comp") {
        const seasonId = body.seasonId ?? must(await db.rpc("comp_season", { p_at: new Date().toISOString() }));
        if (typeof seasonId !== "string" || !/^\d{4}-W\d{2}$/.test(seasonId)) return fail("badRequest");
        let q = db.from("comp_best").select(`player_id, points, floor, at, ${who}`).eq("season_id", seasonId);
        if (hiddenOnly) q = q.eq("players.rank_hidden", true);
        return { ok: true, seasonId, rows: must(await q.order("points", { ascending: false }).order("at").limit(limit)) };
      }
      let q = db.from("normal_best").select(`player_id, best_floor, reached_at, ${who}`);
      if (hiddenOnly) q = q.eq("players.rank_hidden", true);
      return { ok: true, rows: must(await q.order("best_floor", { ascending: false }).order("reached_at").limit(limit)) };
    },
  },

  "player.note": playerSet("note", (b) => (b.note === null ? null : str(b.note, 2000) ?? undefined)),
  "player.ban": playerSet("banned", (b) => (typeof b.banned === "boolean" ? b.banned : undefined)),
  "player.rankHide": playerSet("rank_hidden", (b) => (typeof b.hidden === "boolean" ? b.hidden : undefined)),
  "player.nicknameReset": playerSet("nickname_reset", () => null),

  // 쓰기 없음: 받는 사람 확인 + 번들 검사 + levels면 옛 앱 버전 경고.
  "grant.preview": {
    role: "owner",
    run: async ({ body, db }) => {
      const list = body.players;
      if (!Array.isArray(list) || list.length > 200 || !list.every((s) => typeof s === "string" && s.length <= 64)) {
        return fail("badRequest");
      }
      const players = (await rpc(db, "admin_resolve_players", { p_q: list })) as
        { q: string; id: string | null; status: string; nickname: string | null; app_version: string | null }[];
      const bundleOk = !!(await rpc(db, "admin_bundle_ok", { b: body.bundle ?? null }));
      const hasLevels = !!(body.bundle && typeof body.bundle === "object" && "levels" in (body.bundle as object));
      const oldApp = hasLevels && LEVELS_MIN_APP_VERSION
        ? players.filter((p) => p.id && verLt(p.app_version, LEVELS_MIN_APP_VERSION)).map((p) => p.id)
        : [];
      return { ok: true, players, bundleOk, oldApp };
    },
  },

  "grant.send": {
    role: "owner", write: true,
    run: async ({ uid, body, db, ip, requestId, reason }) => {
      const players = body.players;
      if (!Array.isArray(players) || !players.length || players.length > 200 || !players.every(isUuid)) {
        return fail("badPlayers");
      }
      const title = (body.title ?? {}) as { ko?: unknown; en?: unknown };
      return rpc(db, "admin_grant", {
        p_admin: uid, p_request: requestId, p_mode: body.mode, p_players: players, p_bundle: body.bundle ?? null,
        p_title_ko: str(title.ko, 100), p_title_en: str(title.en, 100), p_expires: tsOrNull(body.expiresAt),
        p_reason: reason, p_note: str(body.note, 2000), p_ip: ip,
      });
    },
  },

  "grant.revoke": {
    role: "owner", write: true,
    run: async ({ uid, body, db, ip, requestId, reason }) => {
      const id = Number(body.grantId);
      if (!Number.isSafeInteger(id) || id <= 0) return fail("badRequest");
      // player(선택) = 그 사람 몫만 회수(플레이어 상세), 없으면 지급 묶음 전체(지급 상세)
      if (body.player != null && !isUuid(body.player)) return fail("badRequest");
      return rpc(db, "admin_grant_revoke", {
        p_admin: uid, p_request: requestId, p_grant: id, p_reason: reason, p_ip: ip, p_player: body.player ?? null,
      });
    },
  },

  "grant.list": {
    role: "viewer",
    run: async ({ body, db }) => ({ ok: true, grants: await rpc(db, "admin_grant_list", { p_limit: limitOf(body.limit) }) }),
  },

  "mail.broadcast": {
    role: "owner", write: true,
    run: async ({ uid, body, db, ip, requestId, reason }) => {
      if (body.confirm !== BROADCAST_CONFIRM) return fail("confirm");
      const title = (body.title ?? {}) as { ko?: unknown; en?: unknown };
      return rpc(db, "admin_broadcast", {
        p_admin: uid, p_request: requestId, p_bundle: body.bundle ?? null, p_title_ko: str(title.ko, 100),
        p_title_en: str(title.en, 100), p_expires: tsOrNull(body.expiresAt), p_reason: reason, p_ip: ip,
      });
    },
  },

  // 필터: store, status, q(주문번호 정확히), from/to(구매 시각), limit(최대 500).
  "purchase.list": {
    role: "viewer",
    run: async ({ body, db }) => {
      let q = db.from("purchases").select("id, player_id, store, product_key, order_id, price_krw, status, tx_id, purchased_at, verified_at, granted_at, refunded_at");
      if (str(body.store, 20)) q = q.eq("store", body.store);
      if (str(body.status, 20)) q = q.eq("status", body.status);
      if (str(body.q, 200)) q = q.eq("order_id", body.q);
      if (tsOrNull(body.from)) q = q.gte("purchased_at", tsOrNull(body.from));
      if (tsOrNull(body.to)) q = q.lt("purchased_at", tsOrNull(body.to));
      const [list, sales] = await Promise.all([
        q.order("id", { ascending: false }).limit(limitOf(body.limit, 200)),
        db.from("v_sales_daily").select("*").limit(90), // 일별 매출(최근 날짜부터, 마켓별)
      ]);
      return { ok: true, purchases: must(list), sales: must(sales) };
    },
  },

  "purchase.regrant": {
    role: "owner", write: true,
    run: async ({ uid, body, db, ip, requestId, reason }) => {
      const id = Number(body.id);
      if (!Number.isSafeInteger(id) || id <= 0) return fail("badRequest");
      const p = must(await db.from("purchases").select("product_key").eq("id", id).maybeSingle()) as { product_key: string } | null;
      if (!p) return fail("notFound");
      const bundle = bundleOfProduct(p.product_key);
      if (!bundle) return fail("unknownProduct");
      return rpc(db, "admin_purchase_regrant", {
        p_admin: uid, p_request: requestId, p_purchase: id, p_bundle: bundle, p_first_extra: firstBuyExtra(p.product_key),
        p_reason: reason, p_ip: ip,
      });
    },
  },

  "coupon.list": {
    role: "viewer",
    run: async ({ db }) => ({ ok: true, coupons: must(await db.from("v_coupon_stats").select("*")) }),
  },

  // {code, title:{ko,en}, bundle, endsAt, maxUses?, platforms?, startsAt?, campaign?, note?}
  "coupon.create": {
    role: "owner", write: true,
    run: (ctx) => {
      const b = ctx.body;
      const title = (b.title ?? {}) as { ko?: unknown; en?: unknown };
      return auditWrite(ctx, "coupon.create", `coupon:${str(b.code, 40)}`, () =>
        ctx.db.rpc("coupon_create", {
          p_code: str(b.code, 40), p_title_ko: str(title.ko, 100), p_title_en: str(title.en, 100), p_bundle: b.bundle ?? null,
          p_ends_at: tsOrNull(b.endsAt), p_max_uses: Number.isSafeInteger(b.maxUses) ? b.maxUses : null,
          p_platforms: Array.isArray(b.platforms) ? b.platforms : null, p_starts_at: tsOrNull(b.startsAt) ?? new Date().toISOString(),
          p_campaign: str(b.campaign, 40), p_note: str(b.note, 2000),
        }));
    },
  },

  // {campaign, count, title:{ko,en}, bundle, endsAt, platforms?, note?} -> data = [{code}] (CSV는 페이지가 만든다)
  "coupon.batch": {
    role: "owner", write: true,
    run: (ctx) => {
      const b = ctx.body;
      const title = (b.title ?? {}) as { ko?: unknown; en?: unknown };
      return auditWrite(ctx, "coupon.batch", `campaign:${str(b.campaign, 40)}`, () =>
        ctx.db.rpc("coupon_batch", {
          p_campaign: str(b.campaign, 40), p_count: Number(b.count), p_title_ko: str(title.ko, 100), p_title_en: str(title.en, 100),
          p_bundle: b.bundle ?? null, p_ends_at: tsOrNull(b.endsAt), p_platforms: Array.isArray(b.platforms) ? b.platforms : null,
          p_note: str(b.note, 2000),
        }));
    },
  },

  // {campaign, enabled} - 묶음 전체 켜기/끄기.
  "coupon.toggle": {
    role: "owner", write: true,
    run: (ctx) => {
      const campaign = str(ctx.body.campaign, 40);
      if (!campaign || typeof ctx.body.enabled !== "boolean") return Promise.resolve(fail("badRequest"));
      return auditWrite(ctx, "coupon.toggle", `campaign:${campaign}`, () =>
        ctx.db.from("coupons").update({ enabled: ctx.body.enabled }).eq("campaign", campaign).select("code"));
    },
  },

  // 이벤트(docs/events.md). 목록 + 받은 사람 수(claims event:{id}).
  "event.list": {
    role: "viewer",
    run: async ({ db }) => {
      const events = (must(await db.from("events").select("*").order("sort").order("starts_at")) ?? []) as { id: string }[];
      const counts = await Promise.all(events.map((e) =>
        db.from("claims").select("player_id", { count: "exact", head: true }).eq("tx_id", `event:${e.id}`)));
      return { ok: true, events: events.map((e, i) => ({ ...e, claimed_count: counts[i].count ?? 0 })) };
    },
  },

  // {id, isNew, kind, title:{ko,en}, body:{ko,en}, bundle, startsAt, endsAt, platforms?, sort, enabled, banner?, confirmBundle?}
  // banner = 앱 안 그림 키(원격 그림 banner_url은 event.banner로만).
  // 이미 받은 사람이 있는 이벤트의 보상을 바꾸면 confirmBundle 없이는 'bundleChanged'(받은 사람 수와 함께) - 받은 사람은 그대로.
  "event.save": {
    role: "owner", write: true,
    run: async (ctx) => {
      const b = ctx.body;
      const id = str(b.id, 40);
      if (!id || !EVENT_ID.test(id)) return fail("badRequest", { message: "id는 영문·숫자·_·- 1~40자" });
      if (b.kind !== "claim" && b.kind !== "notice") return fail("badRequest", { message: "종류는 claim·notice" });
      const startsAt = tsOrNull(b.startsAt), endsAt = tsOrNull(b.endsAt);
      if (!startsAt || !endsAt || endsAt <= startsAt) return fail("badRequest", { message: "기간" });
      const platforms = Array.isArray(b.platforms) && b.platforms.length ? b.platforms : null;
      if (platforms && !platforms.every((p) => EVENT_PLATFORMS.includes(p as string))) return fail("badRequest", { message: "마켓" });
      const bundle = b.kind === "claim" ? b.bundle ?? null : null;
      if (bundle && !(await rpc(ctx.db, "event_bundle_ok", { b: bundle }))) return fail("badBundle");
      if (b.kind === "claim" && !bundle) return fail("badBundle");
      const old = must(await ctx.db.from("events").select("bundle").eq("id", id).maybeSingle()) as { bundle: unknown } | null;
      if (b.isNew === true && old) return fail("exists");
      if (b.isNew !== true && !old) return fail("notFound");
      if (old && JSON.stringify(sortKeys(old.bundle)) !== JSON.stringify(sortKeys(bundle)) && b.confirmBundle !== true) {
        const { count } = await ctx.db.from("claims").select("player_id", { count: "exact", head: true }).eq("tx_id", `event:${id}`);
        if (count) return fail("bundleChanged", { claimed: count });
      }
      const title = (b.title ?? {}) as { ko?: unknown; en?: unknown };
      const text = (b.body ?? {}) as { ko?: unknown; en?: unknown };
      const row = {
        id, kind: b.kind, bundle, title_ko: str(title.ko, 100), title_en: str(title.en, 100),
        body_ko: str(text.ko, 1000), body_en: str(text.en, 1000), starts_at: startsAt, ends_at: endsAt, platforms,
        sort: Number.isSafeInteger(b.sort) ? b.sort : 0, enabled: b.enabled === true, banner: str(b.banner, 40) || null,
      };
      return auditWrite(ctx, "event.save", `event:${id}`, () =>
        old ? ctx.db.from("events").update(row).eq("id", id).select("id") : ctx.db.from("events").insert(row));
    },
  },

  // {id, enabled}
  "event.toggle": {
    role: "owner", write: true,
    run: (ctx) => {
      const id = str(ctx.body.id, 40);
      if (!id || typeof ctx.body.enabled !== "boolean") return Promise.resolve(fail("badRequest"));
      return auditWrite(ctx, "event.toggle", `event:${id}`, async () => {
        const r = await ctx.db.from("events").update({ enabled: ctx.body.enabled }).eq("id", id).select("id, enabled");
        return !r.error && !r.data?.length ? { data: null, error: { message: "없는 이벤트" } } : r;
      });
    },
  },

  // {id, png(base64)} -> Storage event-banners/{id}-{해시 8자}.png(바꿀 때마다 새 이름 = 캐시 문제 없음) -> events.banner_url.
  "event.banner": {
    role: "owner", write: true,
    run: async (ctx) => {
      const id = str(ctx.body.id, 40);
      const b64 = str(ctx.body.png, 200_000);
      if (!id || !EVENT_ID.test(id) || !b64) return fail("badRequest");
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      } catch {
        return fail("badRequest");
      }
      const size = pngSize(bytes);
      if (!size || size[0] !== BANNER_W || size[1] !== BANNER_H) return fail("badRequest", { message: `PNG ${BANNER_W}x${BANNER_H}만` });
      if (!must(await ctx.db.from("events").select("id").eq("id", id).maybeSingle())) return fail("notFound");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].slice(0, 4).map((x) => x.toString(16).padStart(2, "0")).join("");
      const path = `${id}-${hash}.png`;
      const up = await ctx.db.storage.from("event-banners").upload(path, bytes, { contentType: "image/png", upsert: true });
      if (up.error) return fail("error", { message: String(up.error.message ?? up.error) });
      const url = ctx.db.storage.from("event-banners").getPublicUrl(path).data.publicUrl as string;
      return auditWrite(ctx, "event.banner", `event:${id}`, () =>
        ctx.db.from("events").update({ banner_url: url }).eq("id", id).select("id, banner_url"));
    },
  },

  // {level?, source?, uid?, since?, limit?}
  "log.list": {
    role: "viewer",
    run: async ({ body, db }) => {
      let q = db.from("server_log").select("id, at, source, level, body");
      if (str(body.level, 20)) q = q.eq("level", body.level);
      if (str(body.source, 40)) q = q.eq("source", body.source);
      if (isUuid(body.uid)) q = q.eq("body->>uid", body.uid);
      if (tsOrNull(body.since)) q = q.gte("at", tsOrNull(body.since));
      return { ok: true, logs: must(await q.order("id", { ascending: false }).limit(limitOf(body.limit, 200))) };
    },
  },

  // {player?, action?, limit?}
  "audit.list": {
    role: "viewer",
    run: async ({ body, db }) => {
      let q = db.from("admin_audit").select("*");
      if (isUuid(body.player)) q = q.eq("target_player", body.player);
      if (str(body.action, 40)) q = q.eq("action", body.action);
      return { ok: true, audit: must(await q.order("id", { ascending: false }).limit(limitOf(body.limit, 200))) };
    },
  },
};
