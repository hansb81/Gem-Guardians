// 현금 결제 입구(호출부 src/render/shopScreen.js, main.js): 어댑터(platform.iap)는 게임이 넘긴 onGrant(productKey, orderId)만
// 부르고, 게임은 inventory txId `iap:{productKey}:{orderId}` 한 번으로 지급한다(src/platform/interface.js).
// 실제 결제는 마켓 어댑터, 개발용 가짜 결제는 src/platform/dev(?dev=1).
import { platform } from '../platform/index.js';

const fail = (productKey) => (e) => ({ ok: false, productKey, reason: String(e?.message ?? e) });

export function purchase(productKey, onGrant) {
  return platform.iap.purchase(productKey, onGrant).catch(fail(productKey));
}

// 시작 시 미지급 주문 복구.
export function recoverPending(onGrant) {
  return platform.iap.recoverPending(onGrant).catch(() => []);
}

// 구매 내역 복원(비소모성 다시 지급 + 환불 회수).
export function restore(onGrant, onRevoke) {
  return platform.iap.restore(onGrant, onRevoke).catch(() => []);
}
