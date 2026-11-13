// 응답은 항상 { ok, reason?, ... } (인벤토리와 같은 모양). 판정 실패도 HTTP 200 - 클라이언트는 ok/reason만 본다.
import { db, userIdFrom } from "./auth.ts";
import { overLimit } from "./ratelimit.ts";
import { corsHeaders } from "./cors.ts";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const fail = (reason: string, extra: Record<string, unknown> = {}) => ({ ok: false, reason, ...extra });

export type Ctx = { uid: string; body: Record<string, unknown>; db: typeof db };

// 모든 함수의 입구: CORS(허용 목록 cors.ts), 로그인 확인, 분당 호출 제한, JSON 본문, 예외 -> { ok:false, reason:'error' } + server_log.
export function handle(name: string, fn: (ctx: Ctx) => Promise<unknown>) {
  Deno.serve(async (req) => {
    const cors = corsHeaders(req.headers.get("origin"));
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    const res = await run(name, fn, req);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  });
}

async function run(name: string, fn: (ctx: Ctx) => Promise<unknown>, req: Request): Promise<Response> {
  const uid = await userIdFrom(req);
  if (!uid) return json(fail("auth"), 401);
  if (await overLimit(uid, name)) return json(fail("rateLimited"));
  let body: Record<string, unknown> = {};
  try {
    body = req.headers.get("content-type")?.includes("json") ? await req.json() : {};
  } catch {
    return json(fail("badRequest"), 400);
  }
  try {
    return json(await fn({ uid, body: body ?? {}, db }));
  } catch (e) {
    await db.from("server_log").insert({ source: name, level: "error", body: { uid, msg: String(e) } });
    return json(fail("error"), 500);
  }
}

// supabase-js { data, error } -> data (error면 던짐 -> handle이 'error'로).
export function must<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw new Error(typeof error === "object" ? JSON.stringify(error) : String(error));
  return data;
}

export const isBanned = async (uid: string) =>
  !!must(await db.from("players").select("banned").eq("id", uid).maybeSingle())?.banned;
