// Supabase 로그인(이메일+비밀번호 -> TOTP, aal2)과 admin 함수 호출. URL·anon 키는 게임과 같은 config/server.json(공개값).
// 세션은 sessionStorage(탭을 닫으면 끝), 30분 동안 입력이 없으면 로그아웃(docs/admin.md §3).
import { createClient } from '@supabase/supabase-js';
import server from '../../config/server.json';

export const IDLE_MS = 30 * 60e3;
// 로그인한 관리자(me 응답). role이 있을 때만 '쫓겨남'(auth/mfa/notAdmin)을 로그인 화면으로 돌린다.
export const me = { uid: null, role: null };
export const isOwner = () => me.role === 'owner';

export const supabase = createClient(server.url, server.anonKey, {
  auth: { storage: sessionStorage, storageKey: 'gg-admin-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

let lastActive = Date.now();
let onLogout = () => {};
export function watchIdle(cb) {
  onLogout = cb;
  for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => (lastActive = Date.now()), { passive: true });
  setInterval(async () => {
    if (Date.now() - lastActive < IDLE_MS) return;
    lastActive = Date.now();
    if ((await supabase.auth.getSession()).data.session) await logout('30분 동안 사용하지 않아 로그아웃했어요');
  }, 30e3);
}

export async function logout(msg) {
  me.role = null;
  await supabase.auth.signOut().catch(() => {});
  sessionStorage.removeItem('gg-admin-auth');
  onLogout(msg);
}

// POST /functions/v1/admin {action, ...}. 응답은 항상 { ok, reason?, ... } (HTTP 4xx·5xx여도 본문을 읽는다).
export async function call(action, body = {}) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) return { ok: false, reason: 'auth' };
  let res;
  try {
    res = await fetch(`${server.url}/functions/v1/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: server.anonKey },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
  const out = await res.json().catch(() => ({ ok: false, reason: `http${res.status}` }));
  if (me.role && (out.reason === 'auth' || out.reason === 'mfa' || out.reason === 'notAdmin')) {
    me.role = null;
    onLogout(null, out.reason);
  }
  return out;
}

// 쓰기: requestId(재시도·더블클릭 방지) + 사유.
export const write = (action, body, reason) => call(action, { ...body, requestId: crypto.randomUUID(), reason });
