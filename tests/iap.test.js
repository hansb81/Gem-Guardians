// 결제 서버 확인(docs/server.md §7): config/products.json == 서버 사본, 그리고 src/shop/iap.js withVerify 흐름.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { net } from '../src/net/api.js';
import { IapService } from '../src/net/services.js';
import { platform } from '../src/platform/index.js';
import { storage } from '../src/platform/storage.js';
import { withVerify, syncServerIap } from '../src/shop/iap.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('상품표: config와 서버 사본이 같다', () => {
  assert.deepEqual(read('../server/supabase/functions/_shared/products.json'), read('../config/products.json'));
});

// 서버 켜짐 + 가짜 verify. answers = verify가 차례로 돌려줄 값.
function setup(answers, { strict = false } = {}) {
  Object.assign(net, { enabled: true, on: true, features: { iapStrict: strict }, hello: null, playerId: null });
  platform.dev = true; // node = web 빌드 -> store 'dev'
  storage.save('pendingVerify', []);
  const calls = { verify: [], granted: [], grant: [] };
  IapService.verify = async (store, productKey, orderId) => {
    calls.verify.push([store, productKey, orderId]);
    return answers.shift() ?? { ok: false, reason: 'offline' };
  };
  IapService.granted = (txId, bundle) => calls.granted.push([txId, bundle]);
  // 처음 받으면 delta, 이미 받은 주문이면 delta null(shopScreen.grantPaid와 같은 모양).
  const onGrant = async (k, o) => {
    const dup = calls.grant.includes(`${k}:${o}`);
    calls.grant.push(`${k}:${o}`);
    return { delta: dup ? null : { diamonds: 120 } };
  };
  return { calls, onGrant };
}

test('서버 ok -> 지급 -> iap-granted', async () => {
  const { calls, onGrant } = setup([{ ok: true, txId: 'iap:dia.0:o1' }]);
  assert.ok(await withVerify(onGrant)('dia.0', 'o1'));
  assert.deepEqual(calls.verify, [['dev', 'dia.0', 'o1']]);
  assert.deepEqual(calls.grant, ['dia.0:o1']);
  assert.deepEqual(calls.granted, [['iap:dia.0:o1', { diamonds: 120 }]]);
  assert.deepEqual(storage.load('pendingVerify'), []);
});

test('오프라인 + iapStrict=false -> 지급 + pendingVerify, hello 뒤 재확인으로 비움', async () => {
  const { calls, onGrant } = setup([{ ok: false, reason: 'offline' }, { ok: true, txId: 'iap:dia.0:o2' }]);
  assert.ok(await withVerify(onGrant)('dia.0', 'o2'));
  assert.deepEqual(storage.load('pendingVerify'), [{ store: 'dev', productKey: 'dia.0', orderId: 'o2', bundle: { diamonds: 120 } }]);
  await syncServerIap({ onGrant, onRevoke: () => assert.fail(), grantedTx: () => [] });
  assert.deepEqual(storage.load('pendingVerify'), []);
  assert.deepEqual(calls.granted, [['iap:dia.0:o2', { diamonds: 120 }]]); // 재확인 땐 duplicate라 처음 준 bundle
});

test('오프라인 + iapStrict=true -> 지급 안 함 + verifying, 재확인 ok면 그때 지급', async () => {
  const { calls, onGrant } = setup([{ ok: false, reason: 'offline' }, { ok: true, txId: 'iap:dia.0:o3' }], { strict: true });
  const state = {};
  assert.equal(await withVerify(onGrant, state)('dia.0', 'o3'), false);
  assert.equal(state.verifying, true);
  assert.deepEqual(calls.grant, []);
  await syncServerIap({ onGrant, onRevoke: () => assert.fail(), grantedTx: () => [] });
  assert.deepEqual(calls.grant, ['dia.0:o3']);
});

test('owner 같은 판정은 다시 묻지 않음(pendingVerify 안 남김)', async () => {
  const { onGrant } = setup([{ ok: false, reason: 'owner' }]);
  await withVerify(onGrant)('dia.0', 'o4');
  assert.deepEqual(storage.load('pendingVerify'), []);
});

test('서버 꺼짐 -> verify 없이 바로 지급', async () => {
  const { calls, onGrant } = setup([]);
  net.enabled = false;
  assert.ok(await withVerify(onGrant)('dia.0', 'o5'));
  assert.deepEqual(calls.verify, []);
});

test('hello revoke: 이 기기가 그 주문으로 받은 광고 제거만 회수', async () => {
  const { onGrant } = setup([]);
  net.hello = { revoke: ['adFree'], revokeOrders: [{ productKey: 'pack.adfree', orderId: 'a1' }, { productKey: 'pack.adfree', orderId: 'a2' }] };
  const revoked = [];
  await syncServerIap({ onGrant, onRevoke: (k, o) => revoked.push(o), grantedTx: () => ['iap:pack.adfree:a2'] });
  assert.deepEqual(revoked, ['a2']);
});
