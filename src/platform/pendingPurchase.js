// 결제 직전에 남기는 pending 목록 [{ id, productKey, startedAt }]으로 "결제 응답 뒤 지급 전에 앱이 죽은" 결제를 찾는다
// (docs/platforms.md §15-3). 같은 상품을 연달아 살 수 있어 상품마다 하나가 아니라 목록이다.
// 스토어 SDK 없이 도는 순수 함수 - capacitor 어댑터가 쓰고 tests가 검사한다.

// 기기 시계와 스토어 서버 시계 차이 여유. 이 사이에 이미 받은 거래가 걸려도 txId로 두 번 지급되지 않는다.
const CLOCK_SLACK_MS = 5 * 60 * 1000;
// 결과를 알 수 없는 결제(네트워크·스토어 문제 등)는 스토어 기록이 늦게 올라올 수 있어 이 시간까지 다음 실행에서 다시 본다.
export const PENDING_KEEP_MS = 24 * 3600 * 1000;

// RevenueCat PURCHASES_ERROR_CODE 중 "결제가 일어나지 않았다"가 분명한 것 - 이때는 pending을 바로 지운다.
// 그 밖(STORE_PROBLEM 2, NETWORK 10, PAYMENT_PENDING 20, 백엔드·영수증 오류 등)은 결과를 알 수 없으므로 남긴다.
const DEFINITE_FAILURE = new Set([
  '1', // PURCHASE_CANCELLED
  '3', // PURCHASE_NOT_ALLOWED
  '4', // PURCHASE_INVALID
  '5', // PRODUCT_NOT_AVAILABLE_FOR_PURCHASE
  '6', // PRODUCT_ALREADY_PURCHASED (새 결제 없음)
  '15', // OPERATION_ALREADY_IN_PROGRESS
  '18', // INELIGIBLE
  '19', // INSUFFICIENT_PERMISSIONS
  '23', // CONFIGURATION
  '24', // UNSUPPORTED
]);

export function isDefinitePurchaseFailure(err) {
  return !!err?.userCancelled || DEFINITE_FAILURE.has(String(err?.code));
}

// transactions = [{ transactionIdentifier, productIdentifier, purchaseDate(ISO) }] (RevenueCat nonSubscriptionTransactions).
// storeIdOf(productKey) -> 스토어 상품 id.
// 결과 { grants: [{ productKey, orderId }], keep: 남겨 둘 pending[] }.
// - grants: 각 상품의 가장 이른 pending 시작(여유 포함) 이후 거래 전부(이미 받은 거래는 txId로 걸러진다 - 덜 주는 것보다 안전).
// - keep: 최근 pending부터 최근 거래를 하나씩 짝지어, 짝이 없는 pending 중 24시간이 안 된 것만.
export function resolvePendingPurchases(pendings, storeIdOf, transactions, nowMs) {
  const grants = [];
  const keep = [];
  const byKey = new Map();
  for (const p of pendings ?? []) {
    if (!byKey.has(p.productKey)) byKey.set(p.productKey, []);
    byKey.get(p.productKey).push(p);
  }
  for (const [productKey, list] of byKey) {
    const storeId = storeIdOf(productKey);
    const from = Math.min(...list.map((p) => p.startedAt)) - CLOCK_SLACK_MS;
    const txs = transactions
      .filter((t) => storeId && t.productIdentifier === storeId)
      .map((t) => ({ id: t.transactionIdentifier, at: Date.parse(t.purchaseDate) }))
      .filter((t) => t.at >= from)
      .sort((a, b) => b.at - a.at);
    for (const t of txs) grants.push({ productKey, orderId: t.id });
    const used = new Set();
    for (const p of [...list].sort((a, b) => b.startedAt - a.startedAt)) {
      const t = txs.find((x) => !used.has(x.id) && x.at >= p.startedAt - CLOCK_SLACK_MS);
      if (t) used.add(t.id);
      else if (nowMs - p.startedAt < PENDING_KEEP_MS) keep.push(p);
    }
  }
  return { grants, keep };
}
