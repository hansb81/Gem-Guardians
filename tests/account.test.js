// 계정 연결 L2(src/net/account.js, docs/auth.md §5) - supabase client·platform.auth·call·CloudSave는 전부 가짜.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccount, maskEmail } from '../src/net/account.js';

const A = { id: 'A', is_anonymous: true, identities: [] };
const B = { id: 'B', is_anonymous: false, email: 'gem.user@gmail.com', identities: [{ provider: 'google' }] };
const SERVER_SAVE = { rev: 5, data: { bestFloor: 37 }, summary: { bestFloor: 37, diamonds: 1240, towerSum: 142 }, updatedAt: 1, platform: 'android' };

function setup({ device = { bestFloor: 12, diamonds: 85, towerLevels: [8, 8, 8, 8, 8] }, link = null, signIn = [], tokens = null, save = SERVER_SAVE,
  uploaded = true, purchasesOk = true, pick = 'device', redirect = false, intent = null, search = '', purchases = 0, startUser = A } = {}) {
  const log = [];
  let session = { access_token: startUser === A ? 'atA' : 'atB', refresh_token: startUser === A ? 'rtA' : 'rtB', user: startUser };
  const signInQueue = [...signIn];
  const client = {
    auth: {
      getSession: async () => ({ data: { session } }),
      linkIdentity: async (args) => {
        log.push(['linkIdentity', args]);
        if (link) return { data: null, error: link };
        session = { ...session, user: { ...A, is_anonymous: false, email: 'me@gmail.com', identities: [{ provider: 'google' }] } };
        return { data: {}, error: null };
      },
      signInWithIdToken: async (args) => {
        log.push(['signInWithIdToken', args]);
        const err = signInQueue.shift();
        if (err) return { error: err };
        session = { access_token: 'atB', refresh_token: 'rtB', user: B };
        return { data: { session }, error: null };
      },
      setSession: async (t) => {
        log.push(['setSession', t]);
        session = { ...t, user: A };
        return { error: null };
      },
      signOut: async () => log.push(['signOut']),
      signInWithOAuth: async (args) => log.push(['signInWithOAuth', args]),
    },
  };
  const net = { on: true, user: startUser, playerId: startUser.id, googleWebClientId: 'web-client' };
  const tok = [...(tokens ?? [{ ok: true, idToken: 'id1', nonce: 'n1' }, { ok: true, idToken: 'id2', nonce: 'n2' }])];
  const calls = [];
  const handlers = {
    'account-merge-ticket': () => ({ ok: true, ticket: 'T1', purchases }),
    'save-get': () => ({ ok: true, save }),
    'account-merge': () => ({ ok: true, movedPurchases: 0 }),
  };
  const store = new Map([['gemGuardians.save.v2', '{}'], ['cloudMeta', '{}'], ['adContinue', '{}'], ['locale', '"en"'], ['sfxVolume', '0.5']]);
  const sess = new Map(intent ? [['authIntent', JSON.stringify(intent)]] : []);
  const cloud = {
    held: [],
    ensureUploaded: async () => uploaded,
    hold: (v) => cloud.held.push(v),
    applyServer: async (s) => log.push(['applyServer', s.rev]),
    forceUpload: async () => (log.push(['forceUpload']), { ok: true, rev: 6 }),
  };
  const acc = createAccount();
  acc.init({
    client: () => client,
    net,
    call: async (name, body) => (calls.push({ name, body }), handlers[name]?.(body) ?? { ok: false, reason: 'offline' }),
    sayHello: async () => log.push(['hello', net.playerId]),
    refreshUser: async () => {
      net.user = session.user;
      net.playerId = session.user.id;
      return session;
    },
    cloud,
    playerState: { snapshot: () => device, saveBlocked: false },
    storage: { remove: (k) => store.delete(k), flush: async () => log.push(['flush']) },
    platformAuth: { redirect, providers: ['google'], getIdToken: async (p, o) => (log.push(['getIdToken', o.webClientId]), tok.shift() ?? { ok: false, reason: 'cancel' }) },
    flushPurchases: async () => ({ ok: purchasesOk, left: purchasesOk ? 0 : 1 }),
    iapLogIn: async (id) => log.push(['iapLogIn', id]),
    restorePurchases: async () => log.push(['restore']),
    chooseConflict: async (args) => (log.push(['choose', args]), pick),
    session: { get: (k) => sess.get(k) ?? null, set: (k, v) => sess.set(k, v), remove: (k) => sess.delete(k) },
    location: () => ({ href: `https://gem-guardians.pages.dev/${search}`, origin: 'https://gem-guardians.pages.dev', pathname: '/', search, hash: '' }),
    replaceUrl: (u) => log.push(['replaceUrl', u]),
    reload: () => log.push(['reload']),
    now: () => 1_000_000,
  });
  const names = () => log.map((l) => l[0]);
  return { acc, log, names, calls, store, sess, net, cloud, handlers };
}

test('link 성공: ID 토큰 -> linkIdentity(nonce 포함) -> hello, 같은 id(A) 그대로', async () => {
  const s = setup();
  assert.deepEqual(await s.acc.link('google'), { ok: true, kind: 'linked' });
  const li = s.log.find((l) => l[0] === 'linkIdentity')[1];
  assert.deepEqual(li, { provider: 'google', token: 'id1', nonce: 'n1', access_token: undefined });
  assert.ok(s.names().includes('hello'));
  assert.equal(s.net.playerId, 'A');
  assert.equal(s.acc.state().kind, 'linked');
  assert.equal(s.acc.state().email, 'm***@gmail.com');
  assert.equal(s.calls.length, 0, 'ticket 안 받음');
});

test('취소: Google 창을 닫으면 아무것도 안 바뀜', async () => {
  const s = setup({ tokens: [{ ok: false, reason: 'cancel' }] });
  assert.deepEqual(await s.acc.link('google'), { ok: false, reason: 'cancel' });
  assert.ok(!s.names().includes('linkIdentity'));
  assert.equal(s.store.size, 5);
});

test('이미 연결됨(identity_already_exists) -> ticket -> B로 로그인 -> 고르기(이 기기) -> account-merge -> RevenueCat logIn(B)·복원 -> force 올리기', async () => {
  const s = setup({ link: { code: 'identity_already_exists', message: 'Identity is already linked to another user' }, purchases: 2 });
  const r = await s.acc.link('google');
  assert.deepEqual(r, { ok: true, kind: 'linked', switched: true, keep: 'device' });
  assert.deepEqual(s.calls.map((c) => c.name), ['account-merge-ticket', 'save-get', 'account-merge']);
  assert.deepEqual(s.calls[2].body, { ticket: 'T1', keep: 'device' });
  const choose = s.log.find((l) => l[0] === 'choose')[1];
  assert.equal(choose.purchases, 2, '이 기기 결제 수 -> 카드 "결제 n건 포함"');
  assert.equal(choose.server.rev, 5);
  assert.deepEqual(s.log.find((l) => l[0] === 'signInWithIdToken')[1], { provider: 'google', token: 'id1', nonce: 'n1' }, '같은 토큰으로 먼저');
  assert.deepEqual(s.log.filter((l) => l[0] === 'iapLogIn'), [['iapLogIn', 'B']]);
  const order = s.names();
  assert.ok(order.indexOf('restore') < order.indexOf('forceUpload'));
  assert.ok(!order.includes('applyServer') && !order.includes('setSession'));
  assert.equal(s.cloud.held[0], true, '전환 중 업로드 멈춤');
});

test('같은 토큰 signIn이 거절되면 Google 창을 한 번 더 받아 재시도', async () => {
  const s = setup({ link: { code: 'identity_already_exists' }, signIn: [{ code: 'invalid_nonce', message: 'nonce reused' }] });
  assert.equal((await s.acc.link('google')).ok, true);
  const tries = s.log.filter((l) => l[0] === 'signInWithIdToken').map((l) => l[1].token);
  assert.deepEqual(tries, ['id1', 'id2']);
  assert.equal(s.log.filter((l) => l[0] === 'getIdToken').length, 2);
});

test('빈 게스트(최고 1층·결제 0·다이아 시작값)면 팝업 없이 서버 쪽(keep server) -> applyServer', async () => {
  const s = setup({ link: { code: 'identity_already_exists' }, device: { bestFloor: 1, diamonds: 0, towerLevels: [1, 1, 1, 1, 1] } });
  const r = await s.acc.link('google');
  assert.equal(r.keep, 'server');
  assert.ok(!s.names().includes('choose'));
  assert.equal(s.calls.find((c) => c.name === 'account-merge').body.keep, 'server');
  assert.ok(s.names().includes('applyServer'));
});

test('빈 게스트 판정은 다이아를 안 봄: 1층 + 출석 다이아 10 + 결제 0 -> 묻지 않음, 결제 1건이면 물음', async () => {
  const free = setup({ link: { code: 'identity_already_exists' }, device: { bestFloor: 1, diamonds: 10, towerLevels: [1, 1, 1, 1, 1] } });
  assert.equal((await free.acc.link('google')).keep, 'server');
  assert.ok(!free.names().includes('choose'));
  const paid = setup({ link: { code: 'identity_already_exists' }, device: { bestFloor: 1, diamonds: 10, towerLevels: [1, 1, 1, 1, 1] }, purchases: 1 });
  await paid.acc.link('google');
  assert.ok(paid.names().includes('choose'));
});

test('B에 서버 save가 없으면 묻지 않고 keep device', async () => {
  const s = setup({ link: { code: 'identity_already_exists' }, save: null });
  assert.equal((await s.acc.link('google')).keep, 'device');
  assert.ok(!s.names().includes('choose'));
});

test('[취소] -> setSession(A 토큰), A save 그대로(merge·applyServer·forceUpload 없음)', async () => {
  const s = setup({ link: { code: 'identity_already_exists' }, pick: 'cancel' });
  assert.deepEqual(await s.acc.link('google'), { ok: false, reason: 'cancel' });
  assert.deepEqual(s.log.find((l) => l[0] === 'setSession')[1], { access_token: 'atA', refresh_token: 'rtA' });
  assert.equal(s.net.playerId, 'A');
  assert.ok(!s.calls.some((c) => c.name === 'account-merge'));
  for (const n of ['applyServer', 'forceUpload', 'iapLogIn']) assert.ok(!s.names().includes(n), n);
  assert.equal(s.store.size, 5);
  assert.equal(s.cloud.held.at(-1), false, '업로드 다시');
});

test('먼저 올리기 실패(또는 결제 대기열 남음)면 Google 창·linkIdentity를 안 부름 -> offline', async () => {
  for (const opt of [{ uploaded: false }, { purchasesOk: false }]) {
    const s = setup(opt);
    assert.deepEqual(await s.acc.link('google'), { ok: false, reason: 'offline' });
    assert.ok(!s.names().includes('getIdToken') && !s.names().includes('linkIdentity'));
  }
  const off = setup();
  off.net.on = false;
  assert.equal((await off.acc.link('google')).reason, 'offline');
});

test('manual_linking_disabled 등 다른 오류는 error, 게스트 그대로', async () => {
  const s = setup({ link: { code: 'manual_linking_disabled', message: 'Manual linking is disabled' } });
  assert.deepEqual(await s.acc.link('google'), { ok: false, reason: 'error' });
  assert.equal(s.calls.length, 0);
});

test('로그아웃: 올리기 실패면 중단 / 성공이면 save·cloudMeta·adContinue만 지우고 설정 키 유지 + reload', async () => {
  const fail = setup({ uploaded: false });
  fail.net.user = B;
  assert.deepEqual(await fail.acc.signOut(), { ok: false, reason: 'offline' });
  assert.equal(fail.store.size, 5);
  assert.ok(!fail.names().includes('reload'));

  const s = setup();
  s.net.user = B;
  assert.deepEqual(await s.acc.signOut(), { ok: true });
  assert.deepEqual([...s.store.keys()].sort(), ['locale', 'sfxVolume']);
  assert.ok(s.names().includes('signOut') && s.names().at(-1) === 'reload');
  assert.deepEqual(await setup().acc.signOut(), { ok: false, reason: 'guest' }, '게스트엔 로그아웃 없음');
});

test('웹 리다이렉트: 떠나기 전 ticket·A 토큰을 authIntent에, linkIdentity(redirectTo)', async () => {
  const s = setup({ redirect: true });
  assert.deepEqual(await s.acc.link('google'), { ok: true, redirect: true });
  const it = JSON.parse(s.sess.get('authIntent'));
  assert.equal(it.mode, 'link');
  assert.equal(it.ticket, 'T1');
  assert.deepEqual(it.a, { access_token: 'atA', refresh_token: 'rtA', id: 'A' });
  assert.deepEqual(s.log.find((l) => l[0] === 'linkIdentity')[1], { provider: 'google', options: { redirectTo: 'https://gem-guardians.pages.dev/' } });
  assert.ok(!s.names().includes('getIdToken'));
});

test('웹 authIntent: 10분 지난 건 버림, 오류(이미 연결됨) -> signin 모드로 바꾸고 signInWithOAuth', async () => {
  const old = setup({ intent: { mode: 'link', ticket: 'T1', at: 1_000_000 - 11 * 60e3 }, search: '?code=abc' });
  assert.deepEqual(await old.acc.handleRedirect(), { action: 'none' });
  assert.equal(old.sess.has('authIntent'), false);
  assert.deepEqual(old.log.find((l) => l[0] === 'replaceUrl')[1], '/', '?code= 지움');

  const s = setup({ intent: { mode: 'link', ticket: 'T1', at: 1_000_000 - 60e3, a: { access_token: 'atA', refresh_token: 'rtA', id: 'A' } },
    search: '?error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked' });
  assert.deepEqual(await s.acc.handleRedirect(), { action: 'redirect' });
  assert.equal(JSON.parse(s.sess.get('authIntent')).mode, 'signin');
  assert.deepEqual(s.log.find((l) => l[0] === 'signInWithOAuth')[1], { provider: 'google', options: { redirectTo: 'https://gem-guardians.pages.dev/' } });
});

test('웹 signin으로 돌아옴: 사용자가 취소하면 A로 setSession, B 세션이면 resume -> 고르기 -> account-merge', async () => {
  const intent = { mode: 'signin', ticket: 'T1', purchases: 0, at: 1_000_000 - 60e3, a: { access_token: 'atA', refresh_token: 'rtA', id: 'A' } };
  const back = setup({ intent, search: '?error=access_denied' });
  assert.deepEqual(await back.acc.handleRedirect(), { action: 'failed', reason: 'cancel' });
  assert.deepEqual(back.log.find((l) => l[0] === 'setSession')[1], { access_token: 'atA', refresh_token: 'rtA' });

  const s = setup({ intent, search: '?code=xyz', startUser: B });
  const r = await s.acc.handleRedirect();
  assert.equal(r.action, 'resume');
  assert.equal(s.sess.has('authIntent'), false);
  assert.deepEqual((await s.acc.resumeSwitch(r.intent)).keep, 'device');
  assert.deepEqual(s.calls.map((c) => c.name), ['save-get', 'account-merge']);
  assert.equal(s.calls[1].body.ticket, 'T1');
});

test('maskEmail', () => {
  assert.equal(maskEmail('gem.user@gmail.com'), 'g***@gmail.com');
  assert.equal(maskEmail(null), null);
});

test('계정 줄: 서버 켜지면 늘(계정 삭제는 모든 빌드), caps.login 빈 빌드(토스 등)는 Google 연결만 숨김', async () => {
  globalThis.Image ??= class {}; // MainMenuScreen 생성자가 그림을 로드한다 - Node엔 Image가 없다.
  const { MainMenuScreen } = await import('../src/render/mainMenuScreen.js');
  const { platform } = await import('../src/platform/index.js');
  const m = new MainMenuScreen();
  m.account = { state: () => ({ kind: 'guest' }), googleOn: () => true };
  platform.caps.login = [];
  assert.ok(m._settingsButtons().some((b) => b.id === 'account'));
  assert.equal(m._loginOn(), false, 'Google 버튼·게스트 안내 숨김');
  platform.caps.login = ['google'];
  assert.equal(m._loginOn(), true);
  m.account = null; // 서버 꺼짐
  assert.ok(!m._settingsButtons().some((b) => b.id === 'account'));
});

test('계정 삭제: 서버 실패(offline)면 기기 데이터 그대로, 성공이면 지정 키만 지우고 reload + 토스트 표시', async () => {
  const off = setup();
  off.net.on = false;
  assert.deepEqual(await off.acc.deleteAccount(), { ok: false, reason: 'offline' });
  const fail = setup();
  fail.calls.length = 0;
  const failRes = await fail.acc.deleteAccount(); // 'me-delete' 처리기가 없음 = offline 응답
  assert.deepEqual(failRes, { ok: false, reason: 'offline' });
  assert.ok(fail.calls.some((c) => c.name === 'me-delete'));
  assert.equal(fail.store.size, 5, '서버 삭제 실패 = 기기 데이터 그대로');
  assert.ok(!fail.names().includes('reload'));

  const s = setup({ purchasesOk: false }); // 결제 대기열 비우기 실패해도 진행
  s.store.set('gemGuardians.auth', '{}');
  s.handlers['me-delete'] = () => ({ ok: true });
  assert.deepEqual(await s.acc.deleteAccount(), { ok: true });
  assert.deepEqual([...s.store.keys()].sort(), ['locale', 'sfxVolume'], 'save·cloudMeta·adContinue·auth만 지움');
  assert.ok(s.names().includes('signOut') && s.names().at(-1) === 'reload');
  assert.equal(s.acc.takeDeletedNotice(), true);
  assert.equal(s.acc.takeDeletedNotice(), false);
});
