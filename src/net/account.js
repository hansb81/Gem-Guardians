// 계정 연결 L2(docs/auth.md §2·§4·§5): 게스트(익명) -> Google 연결(linkIdentity, 플레이어 id 그대로).
// 그 Google 계정이 이미 다른 플레이어 B에 붙어 있으면 B로 전환 + 진행 고르기(account-merge). 로그아웃.
// 실패·취소하면 게스트 진행은 그대로(기기 save는 고른 뒤에만 바뀐다). 의존성은 init으로 받는다(테스트가 가짜를 끼운다).
import { saveSummary } from './cloudSave.js';

const INTENT_KEY = 'authIntent'; // 웹 리다이렉트 왕복 동안 sessionStorage에 { mode:'link'|'signin', ticket, purchases, at, a:{access_token, refresh_token, id} }
const INTENT_MS = 10 * 60e3; // 서버 ticket 수명과 같음
const URL_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state', 'sb'];
// 로그아웃 때 지우는 키(설정 키 - 소리·언어·진동 등 - 는 남김). 결제 대기열은 그 전에 비운다.
const SIGNOUT_KEYS = ['gemGuardians.save.v2', 'cloudMeta', 'adContinue'];
// 계정 삭제 때 지우는 키 = 로그아웃 + 로그인 토큰(nudges는 save 안). 결제 대기열(pendingVerify)은 영수증이라 남김.
const DELETE_KEYS = [...SIGNOUT_KEYS, 'gemGuardians.auth'];
export const DELETED_NOTICE_KEY = 'accountDeleted'; // platform.session - 다시 뜬 첫 화면 토스트 한 번

// a***@gmail.com
export function maskEmail(email) {
  const m = /^([^@])[^@]*(@.+)$/.exec(email ?? '');
  return m ? `${m[1]}***${m[2]}` : null;
}

const fail = (reason, extra) => ({ ok: false, reason, ...extra });

export function createAccount() {
  let d = null;

  const client = () => d.client();
  const redirectTo = () => `${d.location().origin}${d.location().pathname}`;
  const readIntent = () => {
    try {
      return JSON.parse(d.session.get(INTENT_KEY) ?? 'null');
    } catch {
      return null;
    }
  };
  const writeIntent = (v) => d.session.set(INTENT_KEY, JSON.stringify(v));

  // 지금 세션 토큰(되돌리기용)
  async function currentTokens() {
    const s = (await client().auth.getSession()).data?.session;
    return s ? { access_token: s.access_token, refresh_token: s.refresh_token, id: s.user?.id ?? null } : null;
  }

  // §5-1 2번: 기기 save 먼저 올리기 + 결제 대기열 비우기. 둘 다 돼야 진행.
  async function prepare() {
    if (!d.net.on) return false;
    if (!(await d.cloud.ensureUploaded())) return false;
    return !!(await d.flushPurchases())?.ok;
  }

  async function restoreA(a) {
    if (a) await client().auth.setSession({ access_token: a.access_token, refresh_token: a.refresh_token }).catch((e) => console.warn('[account] setSession', e));
    await d.refreshUser();
    await d.sayHello();
    d.cloud.hold(false);
  }

  // B 세션으로 로그인한 뒤(§5-1 5번 후반): save-get -> 빈 게스트면 바로 서버 쪽, 아니면 고르기 -> account-merge -> 적용.
  async function continueAsB({ ticket, purchases = 0, a }) {
    d.cloud.hold(true);
    await d.refreshUser();
    await d.sayHello();
    const got = await d.call('save-get');
    if (!got.ok) {
      await restoreA(a);
      return fail(got.reason === 'offline' ? 'offline' : 'error');
    }
    const device = saveSummary(d.playerState.snapshot());
    let keep;
    if (!got.save) keep = 'device'; // B는 연결만 하고 저장 전
    // §4-1 빈 게스트: 최고 1층 + 결제 0건(다이아는 안 봄 - 결제가 없으면 출석 등 무료 보상뿐이라 새 폰에 깔고 로그인할 때 묻지 않게)
    else if (device.bestFloor <= 1 && purchases === 0) keep = 'server';
    else keep = await d.chooseConflict({ server: got.save, device, purchases });
    if (keep !== 'server' && keep !== 'device') {
      await restoreA(a); // [취소] = 게스트 A 그대로(B 세션은 로컬에서 버려짐)
      return fail('cancel');
    }
    const m = await d.call('account-merge', { ticket, keep });
    if (!m.ok) {
      console.warn('[account] account-merge', m);
      await restoreA(a);
      return fail(m.reason === 'offline' ? 'offline' : 'error');
    }
    // 결제 사용자도 B로(지금은 시작 때 한 번뿐이라 직접) -> 비소모성 복원(광고 제거·4번째 슬롯·스타터 팩).
    await d.iapLogIn(d.net.playerId);
    await d.restorePurchases();
    if (keep === 'server') {
      await d.cloud.applyServer(got.save); // 다시 불러옴
      return { ok: true, kind: 'linked', switched: true, keep };
    }
    d.cloud.hold(false);
    const up = await d.cloud.forceUpload(); // 성공하면 cloudMeta.owner = B
    if (!up?.ok) console.warn('[account] forceUpload', up);
    return { ok: true, kind: 'linked', switched: true, keep };
  }

  const api = {
    init(deps) {
      d = { now: Date.now, ...deps };
    },

    state() {
      const u = d?.net.user;
      const ids = (u?.identities ?? []).filter((i) => i.provider && i.provider !== 'anonymous');
      if (!u || u.is_anonymous || ids.length === 0) return { kind: 'guest', providers: [] };
      const email = u.email ?? ids.find((i) => i.identity_data?.email)?.identity_data.email;
      return { kind: 'linked', providers: ids.map((i) => i.provider), email: maskEmail(email) };
    },

    // §5-1. -> { ok:true, kind:'linked', switched? } | { ok:true, redirect:true }(웹) | { ok:false, reason:'offline'|'cancel'|'unavailable'|'error' }
    async link(provider) {
      if (!d.net.on || !client()) return fail('offline');
      if (!(await prepare())) return fail('offline');
      const auth = d.platformAuth;

      if (auth.redirect) {
        // 웹: 떠나기 전에 ticket(충돌 대비)과 A 토큰을 sessionStorage에.
        const t = await d.call('account-merge-ticket');
        if (!t.ok) return fail(t.reason === 'offline' ? 'offline' : 'error');
        writeIntent({ mode: 'link', ticket: t.ticket, purchases: t.purchases ?? 0, at: d.now(), a: await currentTokens() });
        const { error } = await client().auth.linkIdentity({ provider, options: { redirectTo: redirectTo() } });
        if (error) {
          d.session.remove(INTENT_KEY);
          console.warn('[account] linkIdentity(redirect)', error.code, error.message);
          if (error.code === 'manual_linking_disabled') console.warn('[account] 서버 설정이 꺼져 있어요: Supabase Auth "Manual linking"을 켜야 함');
          return fail('error');
        }
        return { ok: true, redirect: true };
      }

      let tok = await auth.getIdToken(provider, { webClientId: d.net.googleWebClientId });
      if (!tok.ok) return tok;
      const { error } = await client().auth.linkIdentity({ provider, token: tok.idToken, nonce: tok.nonce, access_token: tok.accessToken });
      if (!error) {
        await d.refreshUser();
        await d.sayHello(); // 서버가 players.linked 갱신
        return { ok: true, kind: 'linked' };
      }
      console.warn('[account] linkIdentity', error.code, error.status, error.message);
      if (error.code === 'manual_linking_disabled') {
        console.warn('[account] 서버 설정이 꺼져 있어요: Supabase Auth "Manual linking"을 켜야 함');
        return fail('error');
      }
      if (error.code !== 'identity_already_exists') return fail('error');

      // 충돌 경로(§5-1 5번): A 세션 복사 -> ticket -> B로 로그인.
      const a = await currentTokens();
      const t = await d.call('account-merge-ticket');
      if (!t.ok) return fail(t.reason === 'offline' ? 'offline' : 'error');
      d.cloud.hold(true);
      let r = await client().auth.signInWithIdToken({ provider, token: tok.idToken, nonce: tok.nonce });
      if (r.error) {
        // 같은 ID 토큰(nonce)을 두 번 못 쓰는 경우 - Google 창을 한 번 더(docs/auth.md §10-2).
        console.warn('[account] signInWithIdToken(같은 토큰) 실패 - 다시 받음', r.error.code, r.error.message);
        tok = await auth.getIdToken(provider, { webClientId: d.net.googleWebClientId });
        if (!tok.ok) {
          await restoreA(a);
          return tok;
        }
        r = await client().auth.signInWithIdToken({ provider, token: tok.idToken, nonce: tok.nonce });
        if (r.error) {
          console.warn('[account] signInWithIdToken', r.error.code, r.error.message);
          await restoreA(a);
          return fail('error');
        }
      }
      return continueAsB({ ticket: t.ticket, purchases: t.purchases ?? 0, a });
    },

    // 웹 리다이렉트에서 돌아왔을 때(시작 때 한 번, hello 뒤). -> { action:'none'|'linked'|'redirect'|'resume'|'failed', reason?, intent? }
    async handleRedirect() {
      const intent = readIntent();
      const loc = d.location();
      const q = new URLSearchParams(loc.search);
      const h = new URLSearchParams((loc.hash ?? '').replace(/^#/, ''));
      const err = q.get('error_code') ?? h.get('error_code') ?? q.get('error') ?? h.get('error');
      const desc = q.get('error_description') ?? h.get('error_description') ?? '';
      const cleanUrl = () => {
        const u = new URL(loc.href);
        for (const k of URL_PARAMS) u.searchParams.delete(k);
        const hp = new URLSearchParams(u.hash.replace(/^#/, ''));
        if (URL_PARAMS.some((k) => hp.has(k))) u.hash = '';
        if (u.href !== loc.href) d.replaceUrl(u.pathname + u.search + u.hash);
      };
      if (!intent) return { action: 'none' };
      if (!(d.now() - intent.at <= INTENT_MS)) {
        d.session.remove(INTENT_KEY);
        cleanUrl();
        return { action: 'none' };
      }
      if (err) console.warn('[account] redirect error', err, desc);
      if (intent.mode === 'link') {
        if (err === 'identity_already_exists' || /already (been )?linked|already exists/i.test(desc)) {
          // 이미 다른 플레이어에 연결된 Google 계정 -> 한 번 더 다녀와 B로 로그인(웹만 두 번 왕복).
          writeIntent({ ...intent, mode: 'signin' });
          d.cloud.hold(true);
          await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } });
          return { action: 'redirect' };
        }
        d.session.remove(INTENT_KEY);
        cleanUrl();
        if (err) return { action: 'failed', reason: err === 'access_denied' ? 'cancel' : 'error' };
        await d.refreshUser();
        return api.state().kind === 'linked' ? { action: 'linked' } : { action: 'failed', reason: 'cancel' };
      }
      // signin: B 세션으로 돌아옴(아니면 A로 되돌림)
      d.session.remove(INTENT_KEY);
      cleanUrl();
      const now = await d.refreshUser();
      if (err || !now || now.user?.id === intent.a?.id) {
        await restoreA(intent.a);
        return { action: 'failed', reason: err === 'access_denied' || !err ? 'cancel' : 'error' };
      }
      d.cloud.hold(true);
      return { action: 'resume', intent };
    },

    // handleRedirect가 resume을 돌려준 뒤(게임·클라우드 저장 준비 뒤) 진행 고르기.
    resumeSwitch(intent) {
      return continueAsB({ ticket: intent.ticket, purchases: intent.purchases ?? 0, a: intent.a });
    },

    // §6. 게스트·연결 계정 모두. 결제 대기열 비우기는 시도만(실패해도 진행) -> me-delete -> 성공했을 때만 기기 데이터 지움.
    async deleteAccount() {
      if (!d.net.on) return fail('offline');
      await Promise.resolve(d.flushPurchases()).catch(() => null);
      const r = await d.call('me-delete');
      if (!r.ok) return fail(r.reason === 'offline' ? 'offline' : 'error');
      d.playerState.saveBlocked = true;
      d.cloud.hold(true);
      for (const k of DELETE_KEYS) d.storage.remove(k);
      await d.storage.flush();
      await client()?.auth.signOut({ scope: 'local' }).catch(() => {}); // 메모리 세션도(서버 사용자는 이미 없음)
      d.session.set(DELETED_NOTICE_KEY, '1');
      d.reload(); // 새 게스트, 튜토리얼부터
      return { ok: true };
    },

    // 다시 뜬 첫 화면에서 한 번 - 계정을 지웠으면 true.
    takeDeletedNotice() {
      if (!d.session.get(DELETED_NOTICE_KEY)) return false;
      d.session.remove(DELETED_NOTICE_KEY);
      return true;
    },

    // §5-3. 연결된 계정만. 올리기 + 결제 대기열 비우기가 둘 다 돼야 진행.
    async signOut() {
      if (api.state().kind !== 'linked') return fail('guest');
      if (!(await prepare())) return fail('offline');
      d.playerState.saveBlocked = true; // 지우는 사이 저장이 다시 쓰지 않게
      d.cloud.hold(true);
      for (const k of SIGNOUT_KEYS) d.storage.remove(k);
      await d.storage.flush();
      await client().auth.signOut({ scope: 'local' }).catch(() => {});
      d.reload(); // 새 게스트(익명)로 시작
      return { ok: true };
    },
  };
  return api;
}

export const Account = createAccount();
