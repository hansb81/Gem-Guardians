// 게임 서버(Supabase, docs/server.md §12) 입구. 게임 코드는 서비스(AttendanceService 등)를 통해서만 부른다.
// config/server.json enabled:false(기본)면 아무 요청도 안 하고 net.on=false - 지금 동작 그대로.
// 응답은 항상 { ok, reason?, ... }. 연결 실패·타임아웃(8초, 1회 재시도)은 { ok:false, reason:'offline' }.
// 로그인 = Supabase 익명 로그인. 세션은 platform.storage(토스 Storage·Capacitor Preferences·localStorage)에 저장.
import { platform, PLATFORM_ID } from '../platform/index.js';

const TIMEOUT_MS = 8000;
const OFFLINE = Object.freeze({ ok: false, reason: 'offline' });

export const net = {
  on: false, // 서버 켜짐(설정) + 로그인 성공
  enabled: false, // 설정상 켜짐(로그인 전에도) - 꺼져 있으면 서버 UI를 아예 안 보인다
  features: {},
  playerId: null,
  hello: null, // 마지막 /hello 응답
};

let cfg = null;
let client = null;

// enabled + 기능 스위치(/hello가 덮어씀).
export const feature = (key) => net.enabled && !!net.features[key];

// 8초 타임아웃 + 실패 시 1회 재시도. 네트워크 실패만 재시도(서버가 판정한 ok:false는 그대로).
async function request(url, init) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      if (res.status >= 500 && attempt === 0) continue;
      const body = await res.json().catch(() => null);
      return body && typeof body === 'object' ? body : { ok: false, reason: `http${res.status}` };
    } catch {
      // 네트워크 오류·타임아웃 -> 한 번 더
    } finally {
      clearTimeout(timer);
    }
  }
  return OFFLINE;
}

// Edge Function 호출: POST {url}/functions/v1/{name}. 서버가 꺼져 있거나 로그인 전이면 offline.
export async function call(name, body = {}) {
  if (!client) return OFFLINE;
  const { data } = await client.auth.getSession().catch(() => ({ data: {} })); // 만료면 여기서 갱신
  const token = data?.session?.access_token;
  if (!token) return OFFLINE;
  return request(`${cfg.url}/functions/v1/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: cfg.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// 시작할 때 한 번: 설정 읽기 -> 익명 로그인 -> /hello. 실패해도 던지지 않는다(오프라인으로 계속).
// override = 개발 패널 스위치(true/false/null). legacyId = 기존 로컬 랭킹 playerId(문의 대응용).
export async function initNet(config, { override = null, legacyId = '', appVersion = '' } = {}) {
  cfg = config;
  net.enabled = override ?? !!config?.enabled;
  net.features = { ...config?.features };
  if (!net.enabled || !config.url || !config.anonKey) {
    net.enabled = false;
    return net;
  }
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const store = platform.storage;
    client = createClient(config.url, config.anonKey, {
      auth: {
        storageKey: 'gemGuardians.auth',
        storage: { getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.remove(k) },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    let { data } = await client.auth.getSession();
    if (!data.session) ({ data } = await client.auth.signInAnonymously());
    net.playerId = data?.session?.user?.id ?? null;
  } catch (e) {
    console.warn('[net] 로그인 실패 - 오프라인으로 계속', e);
  }
  await sayHello(legacyId, appVersion);
  return net;
}

export async function sayHello(legacyId = '', appVersion = '') {
  // 토스: getAnonymousKey(토스 사용자 키) - 서버는 해시로만 남긴다. 실패면 null(서버는 기존 값 유지, 다음 실행 때 다시).
  const tossKey = PLATFORM_ID === 'toss' ? await platform.identity.getAnonymousKey?.().catch(() => null) ?? null : undefined;
  const res = await call('hello', { platform: PLATFORM_ID, appVersion, legacyId, tossKey });
  net.on = !!res.ok;
  if (res.ok) {
    net.hello = res;
    Object.assign(net.features, res.features);
  }
  return res;
}

// 데이터 삭제 후: 이 기기의 익명 세션을 버린다 - 다음 실행 때 새 플레이어 id로 시작.
export async function forgetSession() {
  await client?.auth.signOut({ scope: 'local' }).catch(() => {});
  net.on = false;
  net.playerId = null;
}

// 서버에 기록됐는데 기기가 아직 지급 안 한 것(claims-pending) -> grant -> claims-granted.
// 실패하면 그대로 두고 다음 실행 때 다시(서버 granted_at이 비어 있는 한 계속 내려온다). txId라 중복 지급 없음.
export async function syncClaims(inventory) {
  if (!net.on) return [];
  const res = await call('claims-pending');
  if (!res.ok || !res.claims?.length) return [];
  const done = [];
  const deltas = [];
  for (const c of res.claims) {
    const g = inventory.grant(c.bundle, { src: c.kind, txId: c.txId });
    if (g.ok) deltas.push(g.delta);
    if (g.ok || g.reason === 'duplicate') done.push(c.txId);
  }
  if (done.length) call('claims-granted', { txIds: done });
  return deltas;
}
