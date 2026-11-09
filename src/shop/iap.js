// 현금 결제 입구(호출부 src/render/shopScreen.js, main.js): 어댑터(platform.iap)는 게임이 넘긴 onGrant(productKey, orderId)만
// 부르고, 게임은 inventory txId `iap:{productKey}:{orderId}` 한 번으로 지급한다(src/platform/interface.js).
// 실제 결제는 마켓 어댑터, 개발용 가짜 결제는 src/platform/dev(?dev=1).
// 서버가 켜져 있으면(docs/server.md §7) onGrant 앞에 서버 확인: iap-verify -> ok면 지급 -> iap-granted.
// 서버 실패·오프라인이면 iapStrict=false: 지급 + pendingVerify에 남김 / true: 지급 안 함 + pendingVerify. 다음 hello 뒤 다시 확인.
import { platform, PLATFORM_ID } from '../platform/index.js';
import { net, feature } from '../net/api.js';
import { IapService } from '../net/services.js';
import { storage } from '../platform/storage.js';

const fail = (productKey) => (e) => ({ ok: false, productKey, reason: String(e?.message ?? e) });

// 서버 purchases.store 이름. 개발 패널 가짜 결제 = 'dev'(서버 DEV_IAP=true일 때만 verified).
const STORE = { android: 'play', ios: 'ios', onestore: 'onestore', toss: 'toss' };
const storeName = () => STORE[PLATFORM_ID] ?? (platform.dev ? 'dev' : null);
// 다시 물어볼 실패(연결·반영 지연·서버 오류). owner·refunded·notImplemented 같은 판정은 다시 묻지 않는다.
const RETRY = new Set(['offline', 'notFound', 'rateLimited', 'error', 'auth']);
const retryable = (reason) => RETRY.has(reason) || /^http5/.test(reason ?? '');

const PV = 'pendingVerify'; // [{ store, productKey, orderId, bundle }]
const pendings = () => storage.load(PV) ?? [];
const same = (a, b) => a.store === b.store && a.orderId === b.orderId;
function savePendings(list) {
  storage.save(PV, list);
  return storage.flush(); // 결제 기록이라 디바운스 기다리지 않고 바로
}

// onGrant 앞에 서버 확인을 끼운다. state.verifying = iapStrict로 지급을 미뤘음(상점이 안내 문구를 띄운다).
export function withVerify(onGrant, state = {}) {
  return async (productKey, orderId) => {
    const store = storeName();
    if (!net.enabled || !store) return onGrant(productKey, orderId); // 서버 없음 = 지금 동작
    const v = await IapService.verify(store, productKey, orderId);
    if (v.ok) {
      const got = await onGrant(productKey, orderId);
      if (got) IapService.granted(v.txId, got.delta ?? null);
      return got;
    }
    // v1(iapStrict=false): 손님이 돈 내고 못 받는 게 최악 - 지급하고 기록만(§7). 준 bundle은 재확인 때 서버로.
    const strict = feature('iapStrict');
    const got = strict ? false : await onGrant(productKey, orderId);
    const entry = { store, productKey, orderId, bundle: got?.delta ?? null };
    if (retryable(v.reason) && !pendings().some((p) => same(p, entry))) await savePendings([...pendings(), entry]);
    if (strict) state.verifying = true;
    return got;
  };
}

export function purchase(productKey, onGrant) {
  const state = {};
  return platform.iap
    .purchase(productKey, withVerify(onGrant, state))
    .then((r) => (!r?.ok && state.verifying ? { ...r, reason: 'verifying' } : r))
    .catch(fail(productKey));
}

// 시작 시 미지급 주문 복구.
export function recoverPending(onGrant) {
  return platform.iap.recoverPending(withVerify(onGrant)).catch(() => []);
}

// 구매 내역 복원(비소모성 다시 지급 + 환불 회수).
export function restore(onGrant, onRevoke) {
  return platform.iap.restore(withVerify(onGrant), onRevoke).catch(() => []);
}

// hello 뒤 한 번: RevenueCat logIn(서버 플레이어 id) -> 환불 회수 -> pendingVerify 다시 확인.
// onGrant는 감싸지 않은 지급 함수(txId라 이미 받은 주문은 duplicate로 ok).
export async function syncServerIap({ onGrant, onRevoke, grantedTx }) {
  if (net.playerId) await platform.iap.logIn?.(net.playerId);
  if (!net.on) return;
  // 환불 회수는 광고 제거만, 이 기기가 그 주문(iap:{키}:{주문})으로 받은 경우만(shop.js revokePaidProduct가 adFree만 뺀다).
  if (net.hello?.revoke?.includes('adFree')) {
    for (const { productKey, orderId } of net.hello.revokeOrders ?? []) {
      if (grantedTx().includes(`iap:${productKey}:${orderId}`)) onRevoke(productKey, orderId);
    }
  }
  for (const p of pendings()) {
    const v = await IapService.verify(p.store, p.productKey, p.orderId, { retryMs: 0 });
    if (retryable(v.reason)) continue;
    if (v.ok) {
      const got = await onGrant(p.productKey, p.orderId);
      if (!got) continue;
      IapService.granted(v.txId, got.delta ?? p.bundle ?? null); // 이미 지급(duplicate)이면 그때 남긴 bundle
    }
    await savePendings(pendings().filter((x) => !same(x, p)));
  }
}
