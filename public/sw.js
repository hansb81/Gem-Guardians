// 웹 빌드 전용 서비스 워커(src/boot.js가 웹 프로덕션 빌드에서만 등록). __SW_*__ 자리는 vite.config.js가 빌드 때 채운다.
// skipWaiting을 하지 않는다: 새 버전은 열린 탭이 모두 닫힌 뒤 다음 실행에 적용(게임 도중 교체·새로고침 없음).
// shortcut: 앱 뼈대(index·_app·config)만 미리 받고 assets/는 처음 쓸 때 캐시 - 안 열어 본 화면의 그림은 오프라인에서 빠질 수 있다. 완전 오프라인이 필요하면 PRECACHE에 assets/를 넣는다(약 16MB).
const CACHE = 'gg-__SW_VERSION__';
const PRECACHE = __SW_PRECACHE__;

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE))));

self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gg-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()),
));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // 같은 출처 GET만 - Supabase 등 서버 호출은 손대지 않는다.
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || req.headers.has('range')) return;
  const nav = req.mode === 'navigate';
  // 게임 페이지(./, index.html)만 캐시의 './'로. privacy.html·delete-account.html 같은 다른 페이지는 브라우저가 그대로 받는다
  // (안 그러면 게임을 한 번 연 브라우저에서 계정 삭제 안내를 열어도 게임이 뜬다).
  const root = new URL('./', self.registration.scope).pathname;
  if (nav && url.pathname !== root && url.pathname !== `${root}index.html`) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    // 페이지는 './'로 받는다: Pages가 /index.html을 /로 308 리다이렉트하는데, 리다이렉트된 응답을 페이지 이동에 주면 브라우저가 거부한다.
    const hit = await cache.match(nav ? './' : req, { ignoreSearch: nav });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.status === 200 && !nav) cache.put(req, res.clone());
    return res;
  }));
});
