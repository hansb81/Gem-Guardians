// 관리자 함수 입구(docs/admin.md §3, §5-2). 게임용 handle()을 쓰지 않는다 - CORS 목록·로그인 조건이 다르다.
// auth.ts(service_role 클라이언트)를 import하지 않는다: db를 받아서 테스트가 가짜 db로 부를 수 있게.
import { fail, must } from "./result.ts";

// deno-lint-ignore no-explicit-any
export type Db = any;
export type Role = "owner" | "viewer";
export type AdminCtx = { uid: string; role: Role; body: Record<string, unknown>; db: Db; ip: string | null; requestId: string; reason: string };
export type Action = { role: Role; write?: boolean; run: (ctx: AdminCtx) => Promise<unknown> };

// 관리자 페이지 출처: env ADMIN_ORIGINS(콤마 목록, 배포한 workers.dev 주소) + 로컬 개발. 게임 cors.ts 목록과 섞지 않는다.
export const adminOrigins = (env = Deno.env.get("ADMIN_ORIGINS") ?? "") =>
  new Set(["http://localhost:5180", ...env.split(",").map((s) => s.trim()).filter(Boolean)]);

export function adminCors(origin: string | null, origins = adminOrigins()): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && origins.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const ADMIN_PER_MINUTE = 60;
export const GRANT_PER_MINUTE = 10;

// 분당 제한(rate_hit 재사용, ratelimit.ts overLimit와 같은 규칙: 카운트 실패는 막지 않음).
async function over(db: Db, uid: string, fn: string, limit: number) {
  const { data, error } = await db.rpc("rate_hit", { p_player: uid, p_fn: fn, p_limit: limit });
  return !error && data === false;
}

// 1) JWT -> getClaims(서명 확인) 2) 익명 403 3) aal2 아니면 401 mfa 4) admins 표 5) 분당 제한 6) action·role 7) 쓰기면 requestId·reason.
export async function adminRun(req: Request, actions: Record<string, Action>, db: Db): Promise<Response> {
  let uid: string | null = null;
  let name = "";
  try {
    return await gate(req, actions, db, (u, n) => ((uid = u), (name = n)));
  } catch (e) {
    await db.from("server_log").insert({ source: "admin", level: "error", body: { uid, action: name, msg: String(e) } });
    return json(fail("error"), 500);
  }
}

async function gate(req: Request, actions: Record<string, Action>, db: Db, seen: (uid: string, action: string) => void) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json(fail("auth"), 401);
  const { data, error } = await db.auth.getClaims(token);
  const claims = data?.claims as { sub?: string; aal?: string; is_anonymous?: boolean } | undefined;
  if (error || !claims?.sub) return json(fail("auth"), 401);
  if (claims.is_anonymous) return json(fail("anonymous"), 403);
  if (claims.aal !== "aal2") return json(fail("mfa"), 401);
  const uid = claims.sub;
  const admin = must(await db.from("admins").select("role").eq("user_id", uid).maybeSingle()) as { role: Role } | null;
  if (!admin) return json(fail("notAdmin"), 403);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return json(fail("badRequest"), 400);
  }
  const name = String(body.action ?? "");
  seen(uid, name);
  const act = Object.hasOwn(actions, name) ? actions[name] : null;
  if (await over(db, uid, "admin", ADMIN_PER_MINUTE)) return json(fail("rateLimited"), 429);
  if (name.startsWith("grant.") && await over(db, uid, "admin-grant", GRANT_PER_MINUTE)) return json(fail("rateLimited"), 429);
  if (!act) return json(fail("badAction"), 400);
  if (act.role === "owner" && admin.role !== "owner") return json(fail("role"), 403);
  const requestId = body.requestId;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (act.write && (!isUuid(requestId) || reason.length < 1 || reason.length > 500)) return json(fail("badRequest"), 400);
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? null;
  return json(await act.run({ uid, role: admin.role, body, db, ip, requestId: requestId as string, reason }));
}

export function adminHandle(actions: Record<string, Action>, db: Db) {
  Deno.serve(async (req) => {
    const cors = adminCors(req.headers.get("origin"));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const res = await adminRun(req, actions, db);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  });
}
