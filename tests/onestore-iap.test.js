// 원스토어 결제 provider(src/platform/capacitor/iap/onestore.js): 지급이 성공한 뒤에만 consume/acknowledge, 미처리 구매 복구.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import onestoreIap from '../src/platform/capacitor/iap/onestore.js';

const catalog = {
  'dia.0': { type: 'consumable', priceKRW: 1200, ids: { onestore: 'os_dia_60' } },
  'pack.adfree': { type: 'nonConsumable', priceKRW: 4900, ids: { onestore: 'os_adfree' } },
  'pack.boss': { type: 'consumable', priceKRW: 5900, ids: { onestore: null } },
};
const buy = (productId, token, extra = {}) => ({ productId, purchaseToken: token, purchaseState: 0, acknowledged: false, ...extra });

function setup(plugin) {
  const calls = [];
  const fake = new Proxy({}, {
    get: (_, m) => async (args) => {
      calls.push([m, args]);
      return plugin[m]?.(args) ?? { code: 0 };
    },
  });
  const platform = { caps: { iap: false }, lifecycle: { onResume() {} } };
  const p = onestoreIap({ platform, warn() {}, plugin: fake, config: { features: { iap: true }, onestore: { licenseKey: 'KEY' } }, catalog });
  p.init();
  platform.iap = p.iap;
  return { iap: p.iap, calls, platform };
}

test('결제 성공 -> 지급 -> consume(소모성). 지급 실패면 consume하지 않는다', async () => {
  const { iap, calls } = setup({ purchase: () => ({ code: 0, purchases: [buy('os_dia_60', 'T1')] }) });
  const granted = [];
  const r = await iap.purchase('dia.0', (k, id) => granted.push([k, id]) > 0);
  assert.deepEqual(r, { ok: true, productKey: 'dia.0', orderId: 'T1' });
  assert.deepEqual(granted, [['dia.0', 'T1']]);
  assert.deepEqual(calls.at(-1), ['consume', { purchaseToken: 'T1' }]);

  const s2 = setup({ purchase: () => ({ code: 0, purchases: [buy('os_dia_60', 'T2')] }) });
  const r2 = await s2.iap.purchase('dia.0', () => false);
  assert.equal(r2.ok, false);
  assert.ok(!s2.calls.some(([m]) => m === 'consume'), '지급 실패한 구매는 스토어에 미처리로 남겨 다시 훑는다');
});

test('비소모성은 acknowledge, 상품 id가 없는(null) 상품은 결제하지 않는다', async () => {
  const { iap, calls } = setup({ purchase: () => ({ code: 0, purchases: [buy('os_adfree', 'A1')] }) });
  await iap.purchase('pack.adfree', () => true);
  assert.deepEqual(calls.at(-1), ['acknowledge', { purchaseToken: 'A1' }]);
  assert.equal((await iap.purchase('pack.boss', () => true)).reason, 'noSku');
});

test('미처리 구매 복구: 소모성 전부 + acknowledge 전 비소모성만, 지급 후 마무리', async () => {
  const list = [buy('os_dia_60', 'C1'), buy('os_adfree', 'N1', { acknowledged: true }), buy('os_adfree', 'N2'), buy('unknown', 'U1')];
  const { iap, calls } = setup({ queryPurchases: () => ({ code: 0, purchases: list }) });
  const granted = [];
  await iap.recoverPending((k, id) => granted.push(id) > 0);
  assert.deepEqual(granted, ['C1', 'N2']);
  assert.deepEqual(calls.filter(([m]) => m === 'consume' || m === 'acknowledge'), [['consume', { purchaseToken: 'C1' }], ['acknowledge', { purchaseToken: 'N2' }]]);
});

test('restore = 보유 중인 비소모성만 다시 지급', async () => {
  const list = [buy('os_dia_60', 'C1'), buy('os_adfree', 'N1', { acknowledged: true })];
  const { iap } = setup({ queryPurchases: () => ({ code: 0, purchases: list }) });
  const out = await iap.restore(() => true);
  assert.deepEqual(out, [{ ok: true, productKey: 'pack.adfree', orderId: 'N1' }]);
});

test('NEED_LOGIN이면 상점 안내 상태 -> fixStoreStatus가 로그인 화면 후 다시 연결', async () => {
  let connectCode = 0;
  const { iap, calls } = setup({ connect: () => ({ code: connectCode }), queryPurchases: () => ({ code: 10 }) });
  assert.equal(iap.getStoreStatus(), null);
  await iap.recoverPending(() => true);
  assert.equal(iap.getStoreStatus(), 'needLogin');
  assert.equal(await iap.fixStoreStatus(), true);
  assert.ok(calls.some(([m]) => m === 'launchLogin'));
  connectCode = 11;
  assert.equal(await iap.fixStoreStatus(), false);
  assert.equal(iap.getStoreStatus(), 'needUpdate');
});

test('developerPayload = 상품키|서버 플레이어 id 앞 8자(logIn 전이면 빈 칸) - 서버 iap-verify가 비교', async () => {
  const { iap, calls } = setup({ purchase: () => ({ code: 0, purchases: [buy('os_dia_60', 'P1')] }) });
  await iap.purchase('dia.0', () => true);
  assert.equal(calls.find(([m]) => m === 'purchase')[1].developerPayload, 'dia.0|');
  iap.logIn('0123abcd-ffff-4fff-8fff-ffffffffffff');
  await iap.purchase('dia.0', () => true);
  assert.equal(calls.filter(([m]) => m === 'purchase')[1][1].developerPayload, 'dia.0|0123abcd');
});
