// 타이틀 로그인 입구(docs/auth.md §15): 상태별 화면, 터치 판정, link 결과별 전환.
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Image ??= class {};
globalThis.document ??= {}; // TitleScreen 생성자가 document.fonts를 본다(없으면 바로 준비됨)
const { TitleScreen } = await import('../src/render/titleScreen.js');
const { titleLoginMode, linkFromTitle } = await import('../src/game/titleLogin.js');
const { t } = await import('../src/config/i18n.js');

const GUEST = { kind: 'guest', providers: [] };
const LINKED = { kind: 'linked', providers: ['google'], email: 'a***@gmail.com' };
const FRESH = { tutorialDone: false, bestFloor: 1, purchases: 0 };
const PLAYED = { tutorialDone: true, bestFloor: 7, purchases: 0 };
const mode = (o) => titleLoginMode({ loginOn: true, ready: true, netOn: true, state: GUEST, ...FRESH, ...o });

test('상태 표: 처음 실행 / 진행 있는 게스트 / 연결 계정 / 기본', () => {
  assert.equal(mode({}), 'first');
  assert.equal(mode(PLAYED), 'guest');
  assert.equal(mode({ purchases: 1 }), 'guest', '결제가 있으면 빈 게스트 아님');
  assert.equal(mode({ bestFloor: 2 }), 'guest');
  assert.equal(mode({ tutorialDone: true }), 'guest');
  assert.equal(mode({ state: LINKED }), 'linked');
  assert.equal(mode({ loginOn: false }), null, '토스(caps.login 빔)·서버 꺼짐');
  assert.equal(mode({ netOn: false }), null, '오프라인으로 시작');
  assert.equal(mode({ ...PLAYED, netOn: false }), null);
});

test('서버 준비 전: 처음 실행은 바로 버튼, 진행 있으면 기본(게스트인지 아직 모름)', () => {
  assert.equal(mode({ ready: false, netOn: false }), 'first');
  assert.equal(mode({ ...PLAYED, ready: false, netOn: false }), null);
});

// 540x960 그대로(k=1) 그린 뒤 fillText 기록.
function fakeCtx() {
  const texts = [];
  const ctx = new Proxy({ canvas: {} }, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === 'fillText') return (s) => texts.push(s);
      if (k === 'measureText') return (s) => ({ width: String(s).length * 8 });
      return () => {};
    },
    set(o, k, v) {
      o[k] = v;
      return true;
    },
  });
  return { ctx, texts };
}
function title(loginMode, extra = {}) {
  const s = new TitleScreen();
  s.tapReady = true;
  s.loadShown = 1;
  Object.assign(s.login, { mode: loginMode, ...extra });
  return s;
}
function drawn(s) {
  const { ctx, texts } = fakeCtx();
  s.draw(ctx, 540, 960, 16, 0); // nowMs 0 = "터치하여 시작" 깜빡임 켜진 프레임
  return texts;
}

test('그리는 것: first = 버튼 두 개·안내(터치 문구 없음), guest = 터치 + 글자 버튼, linked = 터치 + 이메일, 기본 = 터치만', () => {
  const first = drawn(title('first'));
  assert.ok(first.includes(t('title.guest')) && first.includes(t('title.google')));
  assert.ok(first.includes(t('title.note')[0]));
  assert.ok(!first.includes(t('title.tap')));
  const guest = drawn(title('guest'));
  assert.ok(guest.includes(t('title.tap')) && guest.includes(t('title.link')));
  assert.ok(!guest.includes(t('title.google')));
  const linked = drawn(title('linked', { email: 'a***@gmail.com' }));
  assert.ok(linked.includes(t('title.tap')) && linked.includes('a***@gmail.com') && !linked.includes(t('title.link')));
  const plain = drawn(title(null));
  assert.ok(plain.includes(t('title.tap')) && !plain.includes(t('title.link')) && !plain.includes(t('title.guest')));
  assert.ok(drawn(title('first', { busy: true })).includes(t('menu.account.busy')));
  assert.ok(drawn(title('first', { msg: 'offline' })).includes(t('menu.account.fail.offline')));
});

test('로딩 중엔 버튼 없음(게이지 그대로)', () => {
  const s = title('first');
  s.tapReady = false;
  s.loadShown = 0.5;
  assert.equal(s.loginMode, null);
  assert.ok(!drawn(s).includes(t('title.guest')));
  assert.equal(s.hitLogin(270, 400), 'block', '처음 실행이면 게이지가 마저 차는 사이 터치도 시작 아님');
  s.login.mode = 'guest';
  assert.equal(s.hitLogin(270, 400), null);
});

test('터치: first는 빈 곳 = 시작 아님, 게스트 버튼 = 시작, Google 버튼 = 연결', () => {
  const s = title('first');
  drawn(s);
  assert.equal(s.hitLogin(270, 400), 'block');
  assert.equal(s.hitLogin(270, 800), 'guest');
  assert.equal(s.hitLogin(270, 870), 'google');
  s.login.busy = true;
  assert.equal(s.hitLogin(270, 800), 'block', '연결 중엔 다른 입력 막음');
});

test('터치: guest 글자 버튼은 시작으로 안 침, 그 밖은 평소처럼 시작(null)', () => {
  const s = title('guest');
  drawn(s);
  assert.equal(s.hitLogin(270, 928), 'google');
  assert.equal(s.hitLogin(270, 400), null);
  const linked = title('linked');
  drawn(linked);
  assert.equal(linked.hitLogin(270, 928), null);
});

test('글자 버튼 터치 높이는 화면이 작아도 44px 이상', () => {
  const s = title('guest');
  const { ctx } = fakeCtx();
  s.draw(ctx, 270, 480, 16, 0); // k = 0.5
  assert.equal(s.hitLogin(135, 464 - 21), 'google'); // 글자 줄(928*0.5=464) 위 21px
  assert.equal(s.hitLogin(135, 464 + 21), 'google');
});

// 가짜 Account: link 결과에 따라 state가 바뀐다.
function fakeAccount(result) {
  const acc = { st: GUEST, calls: 0 };
  acc.state = () => acc.st;
  acc.link = async (p) => {
    assert.equal(p, 'google');
    acc.calls++;
    if (result.ok && result.kind === 'linked') acc.st = LINKED;
    return result;
  };
  return acc;
}

test('link 결과별 화면: linked -> 터치(linked), 취소·실패 -> 그대로', async () => {
  for (const [r, before, after] of [
    [{ ok: true, kind: 'linked' }, FRESH, 'linked'],
    [{ ok: true, kind: 'linked', switched: true, keep: 'device' }, PLAYED, 'linked'],
    [{ ok: false, reason: 'cancel' }, FRESH, 'first'],
    [{ ok: false, reason: 'error' }, PLAYED, 'guest'],
  ]) {
    const acc = fakeAccount(r);
    assert.deepEqual(await linkFromTitle(acc, Promise.resolve()), r);
    assert.equal(mode({ ...before, state: acc.state() }), after);
  }
});

test('서버 준비를 기다림: 끝나면 link, waitMs 넘으면 오프라인(link 안 부름)', async () => {
  const acc = fakeAccount({ ok: true, kind: 'linked' });
  let go;
  const started = new Promise((r) => (go = r));
  const p = linkFromTitle(acc, started, 1000);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(acc.calls, 0);
  go();
  assert.equal((await p).ok, true);
  const slow = fakeAccount({ ok: true, kind: 'linked' });
  assert.deepEqual(await linkFromTitle(slow, new Promise(() => {}), 20), { ok: false, reason: 'offline' });
  assert.equal(slow.calls, 0);
});
