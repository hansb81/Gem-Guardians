// service_role 클라이언트(RLS 우회 - 함수 안에서만) + 요청 JWT에서 플레이어 id.
import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Authorization: Bearer <로그인 JWT> -> auth.users 사용자(id, is_anonymous, identities). 토큰이 없거나 틀리면 null.
export async function userFrom(req: Request) {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : data.user;
}
export const userIdFrom = async (req: Request): Promise<string | null> => (await userFrom(req))?.id ?? null;
