// 쿠폰 입력(docs/coupon.md): 기기 정규화, CouponService(지급·복구·중복), 설정 팝업 버튼·쿠폰 팝업, 문구, 서버 아이템 목록.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCoupon, CouponService } from '../src/net/services.js';
import { Inventory } from '../src/game/inventory.js';
import { ko } from '../src/config/locales/ko.js';
import { en } from '../src/config/locales/en.js';

globalThis.Image ??= class {}; // MainMenuScreen 생성자가 배경 폴백을 로드한다 - Node엔 Image가 없다.
const { MainMenuScreen, COUPON_REASONS } = await import('../src/render/mainMenuScreen.js');

const ITEMS = JSON.parse(readFileSync(new URL('../config/items.json', import.meta.url), 'utf8'));

test('normalizeCoupon: 소문자·하이픈·공백·전각은 같은 값, 3자/21자/한글만은 null', () => {
  for (const s of ['gems-open', 'GEMS OPEN', ' gemsopen ', 'ＧＥＭＳ－ＯＰＥＮ', 'Gems_Open!']) assert.equal(normalizeCoupon(s), 'GEMSOPEN', s);
  assert.equal(normalizeCoupon('xk7q-m2rt-9hwa'), 'XK7QM2RT9HWA');
  for (const s of ['abc', 'A'.repeat(21), '한글만', '', null, undefined]) assert.equal(normalizeCoupon(s), null, String(s));
  assert.equal(normalizeCoupon('A'.repeat(20)), 'A'.repeat(20));
});

// 가짜 서버: calls에 [name, body]를 쌓고, 응답은 respond(name, body).
function fakeApi(respond) {
  const api = { calls: [], synced: 0 };
  api.call = async (name, body) => {
    api.calls.push([name, body]);
    return respond(name, body);
  };
  api.syncClaims = async () => {
    api.synced++;
    return [];
  };
  return api;
}
const inventory = () => new Inventory({}, { config: ITEMS });
const OK = { ok: true, txId: 'coupon:GEMSOPEN', bundle: { diamonds: 100, items: { hammer: 3 } }, title: { ko: '출시 기념', en: 'Launch' } };

test('CouponService: ok -> 지급 1번(txId coupon:X) + claims-granted, title 돌려줌', async () => {
  const inv = inventory();
  const api = fakeApi((name) => (name === 'coupon-redeem' ? OK : { ok: true }));
  const res = await new CouponService(inv, api).redeem('gems-open');
  assert.equal(res.ok, true);
  assert.deepEqual(res.title, OK.title);
  assert.equal(res.delta.diamonds, 100);
  assert.deepEqual(api.calls, [['coupon-redeem', { code: 'gems-open' }], ['claims-granted', { txIds: ['coupon:GEMSOPEN'] }]]);
  assert.equal(inv.wallet.diamonds, 100);
});

test('CouponService: 같은 txId가 두 번 오면 두 번째는 지급 없음(그래도 claims-granted)', async () => {
  const inv = inventory();
  const api = fakeApi((name) => (name === 'coupon-redeem' ? OK : { ok: true }));
  const svc = new CouponService(inv, api);
  await svc.redeem('GEMSOPEN');
  const second = await svc.redeem('GEMSOPEN');
  assert.equal(second.ok, true);
  assert.equal(second.delta, null);
  assert.equal(inv.wallet.diamonds, 100);
  assert.equal(api.calls.filter(([n]) => n === 'claims-granted').length, 2);
});

test('CouponService: already -> syncClaims로 끊긴 지급 복구, 그대로 돌려줌', async () => {
  const api = fakeApi(() => ({ ok: false, reason: 'already' }));
  const res = await new CouponService({ grant: () => assert.fail('지급하면 안 됨') }, api).redeem('GEMSOPEN');
  assert.deepEqual(res, { ok: false, reason: 'already' });
  assert.equal(api.synced, 1);
});

test('CouponService: badCode면 서버를 안 부름, 받는 중 두 번째 호출은 busy', async () => {
  const api = fakeApi(() => new Promise(() => {})); // 응답이 안 오는 서버
  const svc = new CouponService(inventory(), api);
  assert.deepEqual(await svc.redeem('a-b'), { ok: false, reason: 'badCode' });
  assert.equal(api.calls.length, 0);
  svc.redeem('GEMSOPEN'); // 대기 중
  assert.equal(svc.busy, true);
  assert.deepEqual(await svc.redeem('GEMSOPEN'), { ok: false, reason: 'busy' });
  assert.equal(api.calls.length, 1);
});

// 설정 카드 [70,204,400,552] -> 쿠폰 버튼 [84,216,100,36]. 쿠폰 카드 [70,324,400,312] -> X (440,354), 취소 (180,580), 받기 (350,580).
function menu(server) {
  const m = new MainMenuScreen();
  m._transform = { offsetX: 0, offsetY: 0, k: 1 };
  m.server = server;
  m.popup = 'settings';
  return m;
}
const COUPON_BTN_TAP = [130, 230];

test('메뉴: 서버 쿠폰이 없으면 버튼이 안 그려지고 안 눌린다', () => {
  const m = menu({ att: null, mail: null, coupon: null, playerCode: () => null });
  let drew = false;
  m._drawCouponButton = () => {
    drew = true;
  };
  m._nine = m._text = m._sprite = m._panel = () => true; // 캔버스 없이 그리기 흐름만
  m._drawSettingsPopup({}, m._popupCardBasis());
  assert.equal(drew, false);
  m.handlePointerDown(...COUPON_BTN_TAP);
  assert.equal(m.popup, 'settings');
  m.server.coupon = { busy: false }; // 켜지면 그려진다(위 판정이 헛돌지 않았는지)
  m._drawSettingsPopup({}, m._popupCardBasis());
  assert.equal(drew, true);
});

test('메뉴: 쿠폰 버튼 -> 쿠폰 팝업, X·뒤로가기·취소 -> 설정, 받기 = couponRedeem, 결과 처리', () => {
  const coupon = { busy: false };
  const m = menu({ att: null, mail: null, coupon, playerCode: () => null });
  m.handlePointerDown(...COUPON_BTN_TAP);
  assert.equal(m.popup, 'coupon');
  m.handlePointerDown(440, 354); // X
  assert.equal(m.popup, 'settings');
  m.handlePointerDown(...COUPON_BTN_TAP);
  assert.equal(m.closePopup(), true); // 뒤로가기
  assert.equal(m.popup, 'settings');
  m.handlePointerDown(...COUPON_BTN_TAP);
  m.handlePointerDown(180, 580); // 취소
  assert.equal(m.popup, 'settings');

  m.handlePointerDown(...COUPON_BTN_TAP);
  assert.equal(m.handlePointerDown(350, 580), 'couponRedeem:'); // Node엔 DOM 입력이 없어 빈 값
  coupon.busy = true;
  assert.equal(m.handlePointerDown(350, 580), null, '받는 중엔 누름 무시');
  coupon.busy = false;
  m.couponResult({ ok: false, reason: 'notFound' });
  assert.equal(m._couponMsg, 'notFound');
  assert.equal(m.popup, 'coupon');
  m.couponResult({ ok: false, reason: 'busy' });
  assert.equal(m._couponMsg, 'notFound');
  m.couponResult({ ok: true, delta: { diamonds: 10 } });
  assert.equal(m.popup, 'settings');
});

test('메뉴: 카드 바깥 탭으로 닫혀도 DOM 입력 칸이 다음 그리기에서 떨어진다', () => {
  const m = menu({ att: null, mail: null, coupon: { busy: false }, playerCode: () => null });
  m.handlePointerDown(...COUPON_BTN_TAP);
  let removed = 0;
  m._couponInput = { remove: () => removed++ }; // Node엔 DOM이 없어 가짜 input
  m.handlePointerDown(10, 10); // 카드 [70,324,400,312] 바깥
  assert.equal(m.popup, null);
  m._syncCouponInput(null); // draw()가 매 프레임 끝에 부르는 것
  assert.equal(removed, 1);
  assert.equal(m._couponInput, null);
});

test('문구: 모든 reason에 ko/en 문구가 있고, 모르는 reason은 err.error', () => {
  for (const loc of [ko, en]) {
    const c = loc.menu.coupon;
    for (const k of ['title', 'button', 'hint', 'ok', 'busy', 'cancel']) assert.ok(c[k], k);
    for (const r of [...COUPON_REASONS, 'error']) assert.ok(c.err[r], r);
  }
});

test('서버 _shared/coupon.ts ITEM_IDS == config/items.json items 키', () => {
  const ts = readFileSync(new URL('../server/supabase/functions/_shared/coupon.ts', import.meta.url), 'utf8');
  const literal = ts.slice(ts.indexOf('['), ts.lastIndexOf(']') + 1);
  assert.deepEqual(Function(`return ${literal}`)(), Object.keys(ITEMS.items));
});
