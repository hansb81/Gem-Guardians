// §15-3 소모성 결제 틈: 결제 직전 pending 목록으로 결제 직후 꺼진 거래를 찾는 규칙.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePendingPurchases, isDefinitePurchaseFailure } from '../src/platform/pendingPurchase.js';

const T0 = Date.parse('2026-11-08T10:00:00Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
const tx = (id, product, ms) => ({ transactionIdentifier: id, productIdentifier: product, purchaseDate: iso(ms) });
const storeIdOf = (key) => ({ 'dia.0': 'dia_60', 'dia.1': 'dia_300' })[key] ?? null;
const pend = (id, productKey, startedAt) => ({ id, productKey, startedAt });

test('같은 상품이면서 결제 시작 이후 거래만 지급, 짝이 맞으면 pending은 지운다', () => {
  const txs = [tx('old', 'dia_60', T0 - 7 * 24 * HOUR), tx('other', 'dia_300', T0 + 30_000), tx('new', 'dia_60', T0 + 20_000)];
  const r = resolvePendingPurchases([pend('a', 'dia.0', T0)], storeIdOf, txs, T0 + MIN);
  assert.deepEqual(r, { grants: [{ productKey: 'dia.0', orderId: 'new' }], keep: [] });
});

test('같은 상품을 연달아 산 경우: 거래 둘 다 지급, 거래가 하나뿐이면 나중 pending이 짝을 갖고 먼저 것은 남는다', () => {
  const p1 = pend('a', 'dia.0', T0);
  const p2 = pend('b', 'dia.0', T0 + 2 * MIN);
  const both = resolvePendingPurchases([p1, p2], storeIdOf, [tx('t1', 'dia_60', T0 + 10_000), tx('t2', 'dia_60', T0 + 2 * MIN + 10_000)], T0 + 5 * MIN);
  assert.deepEqual(both.grants.map((g) => g.orderId).sort(), ['t1', 't2']);
  assert.deepEqual(both.keep, []);
  const one = resolvePendingPurchases([p1, p2], storeIdOf, [tx('t2', 'dia_60', T0 + 2 * MIN + 10_000)], T0 + 5 * MIN);
  assert.deepEqual(one.grants.map((g) => g.orderId), ['t2']);
  assert.deepEqual(one.keep, [p1], '기록이 늦은 첫 결제는 다음 실행에서 다시 본다');
});

test('못 찾은 pending은 24시간까지만 남긴다', () => {
  const p = pend('a', 'dia.0', T0);
  assert.deepEqual(resolvePendingPurchases([p], storeIdOf, [], T0 + HOUR).keep, [p]);
  assert.deepEqual(resolvePendingPurchases([p], storeIdOf, [], T0 + 25 * HOUR).keep, []);
});

test('pending이 없으면(재설치 등) 아무것도 안 준다', () => {
  assert.deepEqual(resolvePendingPurchases([], storeIdOf, [tx('old', 'dia_60', T0)], T0), { grants: [], keep: [] });
});

test('취소·분명한 실패만 바로 지우고, 결과를 모르는 오류는 남긴다', () => {
  assert.equal(isDefinitePurchaseFailure({ userCancelled: true }), true);
  assert.equal(isDefinitePurchaseFailure({ code: '1' }), true); // PURCHASE_CANCELLED
  assert.equal(isDefinitePurchaseFailure({ code: '5' }), true); // PRODUCT_NOT_AVAILABLE
  assert.equal(isDefinitePurchaseFailure({ code: '10' }), false); // NETWORK
  assert.equal(isDefinitePurchaseFailure({ code: '20' }), false); // PAYMENT_PENDING
  assert.equal(isDefinitePurchaseFailure({ code: '2' }), false); // STORE_PROBLEM
  assert.equal(isDefinitePurchaseFailure(new Error('?')), false);
});
