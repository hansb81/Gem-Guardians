// POST|GET /ping (JWT 없음, config.toml verify_jwt=false) -> { ok:true }. 깨우기 워크플로가 매일 부른다(docs/server.md §20-12).
// DB는 IP당 분당 호출 카운트 한 번만 건드린다(그게 곧 DB 활동). 10회 넘으면 429.
import { db } from "../_shared/auth.ts";
import { fail, json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const { data, error } = await db.rpc("ping_hit", { p_ip: ip });
  if (error) return json(fail("error"), 500);
  return data ? json({ ok: true }) : json(fail("rateLimited"), 429);
});
