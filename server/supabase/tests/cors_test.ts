// CORS 허용 목록(_shared/cors.ts). 실행: deno test -A server/supabase/tests
import { assertEquals } from "jsr:@std/assert@1";
import { corsHeaders, isAllowedOrigin } from "../functions/_shared/cors.ts";

Deno.test("허용 origin", () => {
  for (const o of [
    "https://gem-guardians.pages.dev",
    "https://abc123.gem-guardians.pages.dev",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "https://localhost",
    "capacitor://localhost",
    "https://gem-guardians.apps.tossmini.com",
    "https://gem-guardians.private-apps.tossmini.com",
    "https://gem-guardians.web.tossmini.com",
    "https://gem-guardians.private-web.tossmini.com",
  ]) assertEquals(isAllowedOrigin(o), true, o);
});

Deno.test("막는 origin", () => {
  for (const o of [
    null,
    "https://evil.com",
    "https://gem-guardians.pages.dev.evil.com",
    "https://evilgem-guardians.pages.dev",
    "http://gem-guardians.pages.dev",
    "http://localhost:8001",
    "https://x.apps.tossmini.com.evil.com",
  ]) assertEquals(isAllowedOrigin(o), false, String(o));
});

Deno.test("헤더: 허용이면 그 origin, 아니면 Allow-Origin 없음", () => {
  assertEquals(corsHeaders("https://gem-guardians.pages.dev")["Access-Control-Allow-Origin"], "https://gem-guardians.pages.dev");
  assertEquals(corsHeaders("https://evil.com")["Access-Control-Allow-Origin"], undefined);
  assertEquals(corsHeaders(null).Vary, "Origin");
});
