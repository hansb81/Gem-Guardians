// 결제 provider: 원스토어 IAP SDK V21 - onestore 빌드 전용(docs/platforms.md §14). 네이티브는 자체 Capacitor 플러그인
// OneStoreIap(android/app/src/onestore/). Capacitor/RevenueCat 플러그인이 없어 직접 만든 얇은 다리다.
// 흐름: 결제 성공 -> 게임 onGrant(productKey, purchaseToken) -> 지급이 성공한 뒤에만 소모성 consume / 비소모성 acknowledge.
// 3일 안에 consume/acknowledge를 안 하면 원스토어가 자동 환불한다 - 실패하면 구매가 스토어에 "미처리"로 남으므로
// 시작·onResume·실패 30초 뒤에 queryPurchases로 다시 훑는다(스토어 목록이 곧 재시도 큐, txId라 이중 지급 없음).
// TODO(서버 검증): 지금은 클라이언트 지급. 서버(랭킹 서버)가 생기면 settle()의 onGrant 전에 purchaseToken을
// iap-apis.onestore.net(OAuth client_credentials) 구매 확인 API로 검증하고, 지급도 서버로 옮긴다.
import { registerPlugin } from '@capacitor/core';
import products from '../../../../config/products.json' with { type: 'json' };
import onestoreCfg from '../../../../config/platform.onestore.json' with { type: 'json' };

const OneStoreIap = registerPlugin('OneStoreIap');

// PurchaseClient.ResponseCode(sdk-iap 21.04.00) - 네이티브가 코드를 그대로 넘긴다.
const OK = 0;
const USER_CANCELED = 1;
const ITEM_ALREADY_OWNED = 7;
const NEED_LOGIN = 10;
const NEED_UPDATE = 11;
const SERVICE_DISCONNECTED = 1007; // ERROR_SERVICE_DISCONNECTED - 다음 호출 전에 다시 connect
const PURCHASED = 0; // PurchaseData.PurchaseState
const INAPP = 'inapp'; // PurchaseClient.ProductType - 관리형 상품(소모성/비소모성 구분은 consume 여부로)
const RETRY_MS = 30 * 1000;

// plugin/config/catalog는 tests에서 가짜로 바꿔 끼운다.
export default function onestoreIap({ platform, warn, plugin = OneStoreIap, config = onestoreCfg, catalog = products }) {
  const storeIdOf = (key) => catalog[key]?.ids?.onestore ?? null;
  const keyOfStoreId = (id) => Object.keys(catalog).find((k) => !k.startsWith('_') && catalog[k]?.ids?.onestore === id) ?? null;
  const isNonConsumable = (key) => catalog[key]?.type === 'nonConsumable';
  const call = (method, args) => plugin[method](args).catch((e) => ({ code: -1, message: String(e?.message ?? e) }));
  // null = 정상 | 'needLogin' | 'needUpdate'(서비스 앱 없음/오래됨) | 'unavailable' - 상점 현금 탭 안내(getStoreStatus).
  let status = null;
  let ready = null;
  let busy = false; // 결제 창이 떠 있는 동안(앱이 pause/resume된다) 자동 훑기를 막는다 - 같은 구매를 두 곳에서 지급하지 않게.
  let lastOnGrant = null; // 게임이 recoverPending으로 넘긴 onGrant - onResume·재시도 훑기에 쓴다.
  let retryTimer = null;

  const track = (r) => {
    if (r.code === NEED_LOGIN) status = 'needLogin';
    else if (r.code === NEED_UPDATE) status = 'needUpdate';
    else if (r.code === SERVICE_DISCONNECTED) status = 'unavailable';
    return r;
  };
  async function connect() {
    const r = await call('connect', { base64PublicKey: config.onestore.licenseKey });
    status = r.code === OK ? null : r.code === NEED_LOGIN ? 'needLogin' : r.code === NEED_UPDATE ? 'needUpdate' : 'unavailable';
    if (status) warn(`onestore connect ${r.code}`, r.message);
    return !status;
  }
  // 연결이 안 돼 있으면 한 번 다시 붙어 본다.
  async function ensure() {
    await ready;
    return !status || connect();
  }
  function retryLater() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (lastOnGrant && !busy) iap.recoverPending(lastOnGrant);
    }, RETRY_MS);
    retryTimer.unref?.(); // node 테스트가 30초 기다리지 않게(브라우저 타이머는 숫자라 없음).
  }

  // 결제된 구매 하나 마무리: 지급 -> (성공했을 때만) consume/acknowledge.
  async function settle(p, onGrant) {
    const productKey = keyOfStoreId(p.productId);
    if (!productKey || p.purchaseState !== PURCHASED) return { ok: false, productKey, reason: 'notPurchased' };
    const orderId = p.purchaseToken;
    // TODO(서버 검증): 여기서 purchaseToken 검증(iap-apis.onestore.net) 후 지급.
    if (!(await onGrant(productKey, orderId))) {
      retryLater();
      return { ok: false, productKey, orderId, reason: 'grantFailed' };
    }
    const finish = isNonConsumable(productKey)
      ? p.acknowledged ? { code: OK } : track(await call('acknowledge', { purchaseToken: orderId }))
      : track(await call('consume', { purchaseToken: orderId }));
    if (finish.code !== OK) {
      warn(`onestore finish ${finish.code}`, finish.message);
      retryLater();
    }
    return { ok: true, productKey, orderId }; // 지급은 끝났다 - 마무리 실패는 재시도 훑기가 맡는다.
  }

  async function queryInapp() {
    if (!(await ensure())) return null;
    const r = track(await call('queryPurchases', { type: INAPP }));
    return r.code === OK ? r.purchases ?? [] : null;
  }

  const iap = {
    async getProducts() {
      const ids = Object.keys(catalog).filter((k) => !k.startsWith('_')).map(storeIdOf).filter(Boolean);
      if (!platform.caps.iap || ids.length === 0 || !(await ensure())) return [];
      const r = track(await call('getProducts', { ids, type: INAPP }));
      if (r.code !== OK) return [];
      return (r.products ?? [])
        .map((p) => ({ key: keyOfStoreId(p.productId), storeId: p.productId, priceText: p.price }))
        .filter((p) => p.key)
        .map((p) => ({ ...p, priceKRW: catalog[p.key].priceKRW }));
    },

    async purchase(productKey, onGrant) {
      const storeId = storeIdOf(productKey);
      if (!platform.caps.iap || !storeId) return { ok: false, productKey, reason: 'noSku' };
      if (!(await ensure())) return { ok: false, productKey, reason: status }; // 'needLogin'이면 상점이 로그인 창을 연다.
      busy = true;
      try {
        const r = track(await call('purchase', { productId: storeId, type: INAPP, developerPayload: productKey }));
        if (r.code !== OK) {
          // 이미 보유 = 예전 결제가 consume 안 된 채 남아 있다 -> 훑어서 마무리(지급은 txId라 중복 없음).
          if (r.code === ITEM_ALREADY_OWNED) retryLater();
          return { ok: false, productKey, reason: r.code === USER_CANCELED ? 'cancelled' : status ?? `code ${r.code}` };
        }
        const p = (r.purchases ?? []).find((x) => x.productId === storeId);
        if (!p) return { ok: false, productKey, reason: 'noPurchase' };
        return await settle(p, onGrant);
      } finally {
        busy = false;
      }
    },

    // 시작 + onResume + 실패 재시도: 미처리 구매(소모성은 consume 전, 비소모성은 acknowledge 전) 전부 지급·마무리.
    async recoverPending(onGrant) {
      lastOnGrant = onGrant;
      if (!platform.caps.iap) return [];
      const list = await queryInapp();
      if (!list) return [];
      const out = [];
      for (const p of list) {
        const key = keyOfStoreId(p.productId);
        if (!key || (isNonConsumable(key) && p.acknowledged)) continue;
        out.push(await settle(p, onGrant));
      }
      return out;
    },

    // 비소모성만 다시 지급(재설치 등) - queryPurchases(INAPP)에 남아 있는 것 = 보유 중. 환불되면 목록에서 빠진다.
    // shortcut: 환불 회수(onRevoke)는 안 한다 - 보유 목록만 있고 환불 목록이 없다. 서버 검증이 생기면 그쪽 환불 조회로.
    async restore(onGrant) {
      if (!platform.caps.iap) return [];
      const list = await queryInapp();
      if (!list) return [];
      const out = [];
      for (const p of list) {
        const key = keyOfStoreId(p.productId);
        if (!key || !isNonConsumable(key) || p.purchaseState !== PURCHASED) continue;
        out.push({ ok: !!(await onGrant(key, p.purchaseToken)), productKey: key, orderId: p.purchaseToken });
      }
      return out;
    },

    getStoreStatus: () => (platform.caps.iap ? status : null),
    // 상점 안내 버튼: 로그인 / 서비스 앱 설치·업데이트 화면을 띄운 뒤 다시 연결. 연결되면 미처리 구매도 훑는다.
    async fixStoreStatus() {
      if (status === 'needLogin') await call('launchLogin');
      else if (status === 'needUpdate') await call('launchUpdateOrInstall');
      const ok = await connect();
      if (ok && lastOnGrant) await iap.recoverPending(lastOnGrant);
      return ok;
    },
  };

  return {
    init() {
      if (!config.features.iap || !config.onestore.licenseKey) return;
      // 서비스 앱이 없거나 로그인 전이어도 현금 탭은 보여 주고 안내를 띄운다(docs/platforms.md §14-2 O3) - 그래서 iap는 켠다.
      Object.assign(platform.caps, { iap: true, autoRestore: true });
      ready = connect(); // 기다리지 않는다 - 결제·훑기가 ready를 기다린다.
      platform.lifecycle.onResume(() => {
        if (lastOnGrant && !busy) iap.recoverPending(lastOnGrant);
      });
    },
    iap,
  };
}
