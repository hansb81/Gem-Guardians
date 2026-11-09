// 결제 provider: RevenueCat(@revenuecat/purchases-capacitor) - Google Play(android 빌드)와 App Store(ios 빌드).
// onestore 빌드는 onestore.js를 쓰고 이 파일(과 RevenueCat JS)은 번들에서 빠진다(capacitor/index.js).
// 영수증 검증은 RevenueCat 서버. provider는 인벤토리를 모르고 게임이 넘긴 onGrant만 부른다.
import { Purchases, PRODUCT_CATEGORY } from '@revenuecat/purchases-capacitor';
import { Preferences } from '@capacitor/preferences';
import { resolvePendingPurchases, isDefinitePurchaseFailure } from '../../pendingPurchase.js';
import products from '../../../../config/products.json';

const NON_SUB = PRODUCT_CATEGORY.NON_SUBSCRIPTION;

// 결제 직전 기록 목록(docs/platforms.md §15-3) [{ id, productKey, startedAt }] - 같은 상품을 연달아 살 수 있어 목록.
// 게임 저장(300ms 디바운스)과 따로 Preferences에 바로 쓴다.
const PENDING_KEY = 'pendingPurchases';
let pendingSeq = 0;
async function getPendings() {
  try {
    const list = JSON.parse((await Preferences.get({ key: PENDING_KEY })).value ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
const setPendings = (list) => Preferences.set({ key: PENDING_KEY, value: JSON.stringify(list) });
async function addPending(entry) {
  await setPendings([...(await getPendings()), entry]);
}

// platform = capacitor 어댑터(caps를 켜고 읽는다). cfg = config/platform.android.json | platform.ios.json.
export default function playIap({ platform, cfg, isAndroid, warn }) {
  const storeKey = isAndroid ? 'android' : 'ios';
  // 상품 키 <-> 스토어 상품 id(config/products.json ids.android / ids.ios).
  const storeIdOf = (key) => products[key]?.ids?.[storeKey] ?? null;
  const keyOfStoreId = (id) => Object.keys(products).find((k) => !k.startsWith('_') && products[k]?.ids?.[storeKey] === id) ?? null;

  async function storeProduct(storeId) {
    const { products: list } = await Purchases.getProducts({ productIdentifiers: [storeId], type: NON_SUB });
    return list[0] ?? null;
  }
  async function removePending(id) {
    try {
      await setPendings((await getPendings()).filter((p) => p.id !== id));
    } catch (e) {
      warn('pending remove', e);
    }
  }

  return {
    async init() {
      if (!cfg.features.iap || !cfg.revenuecat.apiKey) return;
      try {
        await Purchases.configure({ apiKey: cfg.revenuecat.apiKey });
        Object.assign(platform.caps, { iap: true, restore: !isAndroid && !!cfg.features.restore, autoRestore: isAndroid });
      } catch (e) {
        warn('RevenueCat configure', e);
      }
    },

    iap: {
      async getProducts() {
        const ids = Object.keys(products).filter((k) => !k.startsWith('_')).map(storeIdOf).filter(Boolean);
        if (!platform.caps.iap || ids.length === 0) return [];
        try {
          const { products: list } = await Purchases.getProducts({ productIdentifiers: ids, type: NON_SUB });
          return list.map((p) => ({ key: keyOfStoreId(p.identifier), storeId: p.identifier, priceText: p.priceString })).filter((p) => p.key)
            .map((p) => ({ ...p, priceKRW: products[p.key].priceKRW }));
        } catch (e) {
          warn('getProducts', e);
          return [];
        }
      },
      async purchase(productKey, onGrant) {
        const storeId = storeIdOf(productKey);
        if (!platform.caps.iap || !storeId) return { ok: false, productKey, reason: 'noSku' };
        try {
          const product = await storeProduct(storeId);
          if (!product) return { ok: false, productKey, reason: 'noProduct' };
          // 결제 창을 띄우기 직전에 남긴다 - 결제 응답 뒤 지급 전에 앱이 죽어도 다음 실행 때 recoverPending이 찾는다.
          const startedAt = Date.now();
          const entry = { id: `${startedAt}-${++pendingSeq}`, productKey, startedAt };
          await addPending(entry);
          let r;
          try {
            r = await Purchases.purchaseStoreProduct({ product });
          } catch (e) {
            // 취소·분명한 실패 = 결제 없음 -> 바로 지움. 결과를 모르는 오류(네트워크·스토어 문제·결제 보류)는 남겨 24시간 다시 본다.
            if (isDefinitePurchaseFailure(e)) await removePending(entry.id);
            return { ok: false, productKey, reason: e?.userCancelled ? 'cancelled' : String(e?.message ?? e) };
          }
          const orderId = r.transaction.transactionIdentifier;
          const ok = !!(await onGrant(productKey, orderId));
          if (ok) await removePending(entry.id); // 지급 실패면 남겨서 다음 실행에 다시.
          return { ok, productKey, orderId };
        } catch (e) {
          return { ok: false, productKey, reason: String(e?.message ?? e) };
        }
      },
      // RevenueCat은 결제가 끝나면 스토어 거래를 스스로 마무리해서 "미지급 주문" 목록이 없다 - 대신 결제 직전 pending 목록과
      // CustomerInfo 거래 목록을 맞춰 본다(같은 상품·시작 이후 거래 -> iap:{key}:{transactionId}로 지급, txId라 중복 없음).
      // 재설치하면 pending도 지워지므로 예전 결제를 또 주는 일은 없다. 웹훅/서버 지급은 서버가 생기면.
      async recoverPending(onGrant) {
        if (!platform.caps.iap) return [];
        const pendings = await getPendings();
        if (pendings.length === 0) return [];
        try {
          const { customerInfo } = await Purchases.getCustomerInfo();
          const { grants, keep } = resolvePendingPurchases(pendings, storeIdOf, customerInfo.nonSubscriptionTransactions, Date.now());
          const out = [];
          for (const g of grants) out.push({ ...g, ok: !!(await onGrant(g.productKey, g.orderId)) });
          // 지급이 하나라도 실패하면 목록을 그대로 둬서 다음 실행에 다시 한다.
          if (out.every((r) => r.ok)) await setPendings(keep);
          return out;
        } catch (e) {
          warn('recoverPending', e);
          return [];
        }
      },
      // 비소모성(products.json type)만 다시 지급(txId라 중복 없음). iOS는 restorePurchases(애플 계정 확인), Android는 getCustomerInfo.
      // TODO(환불): RevenueCat은 환불된 거래를 목록에서 뺄 뿐 따로 알려 주지 않는다 - 회수는 entitlements(광고 제거 등) 기준으로 붙인다.
      async restore(onGrant) {
        if (!platform.caps.iap) return [];
        try {
          const { customerInfo } = isAndroid ? await Purchases.getCustomerInfo() : await Purchases.restorePurchases();
          const out = [];
          for (const tx of customerInfo.nonSubscriptionTransactions) {
            const productKey = keyOfStoreId(tx.productIdentifier);
            if (!productKey || products[productKey].type !== 'nonConsumable') continue;
            out.push({ ok: !!(await onGrant(productKey, tx.transactionIdentifier)), productKey, orderId: tx.transactionIdentifier });
          }
          return out;
        } catch (e) {
          warn('restore', e);
          return [];
        }
      },
    },
  };
}
