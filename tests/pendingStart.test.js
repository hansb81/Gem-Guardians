// 시작 때 결제 대기열(src/shop/iap.js startPendingPurchases): 미지급 주문 복구(기기 지급)는 hello를 기다리지 않는다.
// 서버가 꺼졌거나 오프라인·느릴 때도 결제한 손님이 바로 받는다(iapStrict false). 서버 확인만 hello 뒤.
import test from 'node:test';
import assert from 'node:assert/strict';
import { net } from '../src/net/api.js';
import { platform } from '../src/platform/index.js';
import { storage } from '../src/platform/storage.js';
import { startPendingPurchases } from '../src/shop/iap.js';

function setup(netState) {
  Object.assign(net, { enabled: false, on: false, features: {}, hello: null, playerId: null }, netState);
  platform.dev = true; // node = web 빌드 -> store 'dev'
  platform.caps.iap = true;
  storage.save('pendingVerify', []);
  const grants = [];
  const logIns = [];
  platform.iap = {
    ...platform.iap,
    recoverPending: async (onGrant) => [{ productKey: 'dia.3', orderId: 'GPA.1', ok: !!(await onGrant('dia.3', 'GPA.1')) }],
    logIn: async (id) => logIns.push(id),
  };
  const env = { onGrant: async (k, o) => (grants.push(`${k}:${o}`), { delta: { diamonds: 330 } }), onRevoke: () => {}, grantedTx: () => [] };
  return { env, grants, logIns };
}
const never = new Promise(() => {}); // hello가 끝나지 않는 상황(서버 느림·로그인 대기)

test('서버 꺼짐(enabled:false): hello를 기다리지 않고 바로 기기 지급, 서버 확인 없음', async () => {
  const s = setup({ enabled: false });
  const { recovered } = startPendingPurchases(s.env, never);
  const r = await recovered;
  assert.deepEqual(s.grants, ['dia.3:GPA.1']);
  assert.equal(r[0].ok, true);
  assert.deepEqual(storage.load('pendingVerify'), [], '서버 꺼짐 = 지금 동작(기록 안 남김)');
});

test('오프라인(서버 켜짐, 로그인 전·연결 안 됨): 바로 지급 + pendingVerify에 남김, hello 뒤 재확인', async () => {
  const s = setup({ enabled: true, on: false, features: { iapStrict: false } });
  let helloDone;
  const ready = new Promise((r) => (helloDone = r));
  const { recovered, synced } = startPendingPurchases(s.env, ready);
  await recovered;
  assert.deepEqual(s.grants, ['dia.3:GPA.1'], 'hello 전에 지급');
  assert.equal(storage.load('pendingVerify').length, 1);
  assert.deepEqual(s.logIns, [], '서버 확인(logIn)은 아직');
  net.playerId = 'P1';
  helloDone();
  await synced;
  assert.deepEqual(s.logIns, ['P1'], 'hello 뒤 RevenueCat logIn');
});

test('시작 지연: hello가 끝나지 않아도 복구가 바로 끝난다(0초)', async () => {
  const s = setup({ enabled: true, on: false });
  const t0 = Date.now();
  await startPendingPurchases(s.env, never).recovered;
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(s.grants.length, 1);
});
