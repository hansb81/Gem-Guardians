// 브라우저에서 함수를 부를 수 있는 출처(origin) 목록 - 여기 한 곳에서만 고친다(docs/platforms.md "웹 배포").
// CORS는 브라우저만 지키는 규칙이라 인증이 아니다: 로그인·호출 제한은 http.ts handle()이 따로 본다.
const ORIGINS = new Set([
  "https://gem-guardians.pages.dev", // Cloudflare Pages 본 배포
  "http://localhost:5173", // vite dev
  "http://localhost:4173", // vite preview
  "http://localhost:8000", // serve.py
  "http://127.0.0.1:8000", // serve.py
  "https://localhost", // Capacitor Android
  "capacitor://localhost", // Capacitor iOS
]);
const PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.gem-guardians\.pages\.dev$/, // Pages PR·브랜치 미리보기
  // 토스 미니앱: SDK 2.x apps / QR 테스트 private-apps, SDK 3.x web / private-web (developers-apps-in-toss.toss.im)
  /^https:\/\/[a-z0-9-]+\.(private-)?(apps|web)\.tossmini\.com$/,
];

export const isAllowedOrigin = (origin: string | null) =>
  !!origin && (ORIGINS.has(origin) || PATTERNS.some((re) => re.test(origin)));

/** 요청 Origin이 목록에 있으면 그대로 돌려준다(없으면 Allow-Origin 없음 -> 브라우저가 막는다). */
export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin!;
  return h;
}
