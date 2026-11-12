// 토스 미니앱(앱인토스, @apps-in-toss/web-framework 3.x) 어댑터 - docs/platforms.md 2-1·3-2.
// 설정(appName·광고 id·기능 스위치)은 config/platform.toss.json. 모든 SDK 호출은 isSupported 확인 + try/catch -
// 토스 앱 버전이 지원 안 하거나 실패하면 그 기능은 caps에서 꺼져 화면에서 숨는다(게임은 계속).
import {
  Storage, User, IAP, TossAds, Game, Screen, SafeArea, graniteEvent,
  loadFullScreenAd, showFullScreenAd, generateHapticFeedback,
} from '@apps-in-toss/web-framework';
import web from '../web/index.js';
import cfg from '../../../config/platform.toss.json';
import products from '../../../config/products.json';

const warn = (what, e) => console.warn(`[toss] ${what}`, e);
const supported = (fn) => {
  try {
    return typeof fn === 'function' && (fn.isSupported ? fn.isSupported() : true);
  } catch {
    return false;
  }
};

// 상품 키 <-> 토스 sku(config/products.json ids.toss).
const skuOf = (key) => products[key]?.ids?.toss ?? null;
const isNonConsumable = (key) => products[key]?.type === 'nonConsumable';
const keyOfSku = (sku) => Object.keys(products).find((k) => !k.startsWith('_') && products[k]?.ids?.toss === sku) ?? null;

// ---------- 전면/보상 광고: load -> show -> 닫히면 다음 것 미리 load ----------
function fullScreen(adGroupId) {
  let loaded = false;
  let loading = false;
  const load = () => {
    if (loaded || loading) return;
    loading = true;
    try {
      loadFullScreenAd({
        options: { adGroupId },
        onEvent: (e) => {
          if (e.type === 'loaded') {
            loaded = true;
            loading = false;
          }
        },
        onError: (e) => {
          loading = false;
          warn('loadFullScreenAd', e);
        },
      });
    } catch (e) {
      loading = false;
      warn('loadFullScreenAd', e);
    }
  };
  // 결과 { shown, rewarded } - 보상은 userEarnedReward 이벤트가 왔을 때만.
  const show = () =>
    new Promise((resolve) => {
      if (!loaded) {
        load();
        resolve({ shown: false, rewarded: false });
        return;
      }
      loaded = false;
      let rewarded = false;
      const done = (shown) => {
        resolve({ shown, rewarded });
        load();
      };
      try {
        showFullScreenAd({
          options: { adGroupId },
          onEvent: (e) => {
            if (e.type === 'userEarnedReward') rewarded = true;
            else if (e.type === 'dismissed') done(true);
            else if (e.type === 'failedToShow') done(false);
          },
          onError: (e) => {
            warn('showFullScreenAd', e);
            done(false);
          },
        });
      } catch (e) {
        warn('showFullScreenAd', e);
        done(false);
      }
    });
  return { load, show };
}

const interstitial = fullScreen(cfg.ads.interstitial);
const rewarded = fullScreen(cfg.ads.rewarded);

async function anonymousKey() {
  try {
    if (supported(User.getAnonymousKey)) return (await User.getAnonymousKey())?.hash || null;
  } catch (e) {
    warn('User.getAnonymousKey', e);
  }
  return null;
}
let banner = null; // attachBanner 결과({ destroy })

const backCbs = [];
const insetCbs = [];
const HAPTIC = { light: 'tickWeak', medium: 'tap', heavy: 'tickMedium', success: 'success', error: 'error' };

const platform = {
  ...web,
  id: 'toss',
  caps: { ...web.caps, iap: false, ads: false, banner: false, rewarded: false, leaderboard: false, haptics: false, externalLinks: false, backButton: true, exit: true, restore: false, autoRestore: false,
    coupon: cfg.features.coupon !== false }, // 쿠폰 입력 - 토스 정책 확인 전까지 platform.toss.json에서 끔(docs/coupon.md §7)

  async init() {
    const f = cfg.features;
    const fullScreenOk = supported(loadFullScreenAd) && supported(showFullScreenAd);
    Object.assign(this.caps, {
      iap: f.iap && supported(IAP.createOneTimePurchaseOrder),
      autoRestore: f.iap && supported(IAP.getCompletedOrRefundedOrders),
      ads: f.ads && fullScreenOk,
      rewarded: f.rewarded && fullScreenOk,
      banner: f.banner && supported(TossAds.initialize) && supported(TossAds.attachBanner),
      leaderboard: f.leaderboard && supported(Game.setLeaderboardScore) && supported(Game.openLeaderboard),
      haptics: f.haptics,
    });
    if (this.caps.ads) interstitial.load();
    if (this.caps.rewarded) rewarded.load();
    if (this.caps.banner) {
      try {
        TossAds.initialize({ callbacks: { onInitializationFailed: (e) => warn('TossAds.initialize', e) } });
      } catch (e) {
        this.caps.banner = false;
        warn('TossAds.initialize', e);
      }
    }
    try {
      graniteEvent.addEventListener('backEvent', {
        // 게임이 처리 안 한 뒤로가기(타이틀 등) = 미니앱 닫기(토스 기본 동작과 같게).
        onEvent: () => backCbs.some((cb) => cb()) || Screen.close().catch((e) => warn('Screen.close', e)),
        onError: (e) => warn('backEvent', e),
      });
    } catch (e) {
      this.caps.backButton = false;
      warn('backEvent', e);
    }
    try {
      SafeArea.subscribe({ onEvent: (ins) => insetCbs.forEach((cb) => cb(ins)) });
    } catch (e) {
      warn('SafeArea.subscribe', e);
    }
  },

  storage: {
    async get(key) {
      try {
        return await Storage.getItem(key);
      } catch (e) {
        warn('Storage.getItem', e);
        return null;
      }
    },
    set: (key, str) => Storage.setItem(key, str).catch((e) => warn('Storage.setItem', e)),
    remove: (key) => Storage.removeItem(key).catch((e) => warn('Storage.removeItem', e)),
  },

  identity: {
    // 토스 사용자 키(hash) 또는 null(실패). 서버 hello의 tossKey는 이것만 쓴다 - 가짜 값이면 토스 사용자 판정이 틀어짐(§22 C2-5).
    getAnonymousKey: anonymousKey,
    async getUserId() {
      const key = await anonymousKey();
      if (key) return key;
      console.warn('[toss] getAnonymousKey 실패 - 로컬 UUID로 대신한다(기기 바꾸면 이어지지 않음)');
      return web.identity.getUserId();
    },
  },

  iap: {
    async getProducts() {
      if (!supported(IAP.getProductItemList)) return [];
      try {
        const { products: list } = await IAP.getProductItemList();
        return list
          .map((p) => ({ key: keyOfSku(p.sku), storeId: p.sku, priceText: p.displayAmount }))
          .filter((p) => p.key)
          .map((p) => ({ ...p, priceKRW: products[p.key].priceKRW }));
      } catch (e) {
        warn('getProductItemList', e);
        return [];
      }
    },
    // 지급은 processProductGrant 안에서 게임 onGrant(productKey, orderId) - 지급이 성공했을 때만 true(토스가 결제를 확정).
    purchase(productKey, onGrant) {
      const sku = skuOf(productKey);
      if (!sku) return Promise.resolve({ ok: false, productKey, reason: 'noSku' });
      return new Promise((resolve) => {
        let orderId = null;
        let granted = false;
        let cleanup = () => {};
        const finish = (r) => {
          try {
            cleanup();
          } catch {
            // 이미 정리됨
          }
          resolve(r);
        };
        try {
          cleanup = IAP.createOneTimePurchaseOrder({
            options: {
              sku,
              processProductGrant: async (params) => {
                orderId = params.orderId;
                granted = !!(await onGrant(productKey, orderId));
                return granted;
              },
            },
            onEvent: (e) => finish({ ok: granted, productKey, orderId: e?.data?.orderId ?? orderId, reason: granted ? undefined : 'grantFailed' }),
            onError: (e) => finish({ ok: false, productKey, orderId, reason: String(e?.message ?? e) }),
          });
        } catch (e) {
          finish({ ok: false, productKey, reason: String(e?.message ?? e) });
        }
      });
    },
    // 복원: 토스 Storage는 앱을 지우면 같이 지워진다 - 완료된 주문 중 비소모성(products.json type)만 다시 지급(txId라 중복 없음),
    // 환불만 남은 상품은 onRevoke(게임이 플래그 회수). 같은 상품을 다시 산 완료 주문이 있으면 회수하지 않는다.
    async restore(onGrant, onRevoke) {
      if (!supported(IAP.getCompletedOrRefundedOrders)) return [];
      const byKey = new Map(); // key -> { completed, refunded }
      try {
        let key = null;
        do {
          const page = await IAP.getCompletedOrRefundedOrders(key ? { key } : undefined);
          for (const o of page.orders) {
            const productKey = keyOfSku(o.sku);
            if (!productKey || !isNonConsumable(productKey)) continue;
            const e = byKey.get(productKey) ?? { completed: null, refunded: null };
            if (o.status === 'COMPLETED') e.completed ??= o.orderId;
            else if (o.status === 'REFUNDED') e.refunded ??= o.orderId;
            byKey.set(productKey, e);
          }
          key = page.hasNext ? page.nextKey : null;
        } while (key);
      } catch (e) {
        warn('getCompletedOrRefundedOrders', e);
        return [];
      }
      const out = [];
      for (const [productKey, e] of byKey) {
        if (e.completed) out.push({ ok: !!(await onGrant(productKey, e.completed)), productKey, orderId: e.completed });
        else if (e.refunded) onRevoke(productKey, e.refunded);
      }
      return out;
    },
    // 시작 시: 결제됐지만 지급 전에 꺼진 주문 -> 게임 grant -> 성공한 것만 completeProductGrant.
    async recoverPending(onGrant) {
      if (!supported(IAP.getPendingOrders) || !supported(IAP.completeProductGrant)) return [];
      const out = [];
      try {
        const { orders } = await IAP.getPendingOrders();
        for (const o of orders) {
          const productKey = keyOfSku(o.sku);
          if (!productKey) {
            warn('알 수 없는 sku의 미지급 주문', o);
            continue;
          }
          const ok = !!(await onGrant(productKey, o.orderId));
          if (ok) await IAP.completeProductGrant({ params: { orderId: o.orderId } });
          out.push({ ok, productKey, orderId: o.orderId });
        }
      } catch (e) {
        warn('recoverPending', e);
      }
      return out;
    },
  },

  ads: {
    showInterstitial: async () => (platform.caps.ads ? (await interstitial.show()).shown : false),
    showRewarded: async () => (platform.caps.rewarded ? rewarded.show() : { rewarded: false, shown: false }),
    // 배너는 게임이 비워 둔 하단 자리(#banner-slot) 안에 붙인다 - 높이 102 고정.
    async showBanner() {
      if (!platform.caps.banner) return 0;
      const slot = document.getElementById('banner-slot');
      if (!slot || banner) return banner ? cfg.ads.bannerHeight : 0;
      try {
        banner = TossAds.attachBanner(cfg.ads.banner, slot, { theme: 'dark', callbacks: { onNoFill: () => warn('banner noFill', cfg.ads.banner) } });
        return cfg.ads.bannerHeight;
      } catch (e) {
        warn('attachBanner', e);
        return 0;
      }
    },
    hideBanner() {
      try {
        banner?.destroy();
      } catch (e) {
        warn('banner.destroy', e);
      }
      banner = null;
    },
    getBannerSlotHeight: () => (platform.caps.banner ? cfg.ads.bannerHeight : 0),
  },

  leaderboard: {
    // 점수는 숫자 문자열. 판이 끝난 뒤에만 부른다(호출부 main.js startExitToMenu).
    // 성공하면 true(게임이 "마지막 제출 층"을 기록 - 실패하면 다음 기회에 다시 낸다).
    async submit(score) {
      try {
        const res = await Game.setLeaderboardScore({ score: String(score) });
        return res !== undefined; // 앱 버전이 낮으면 undefined(아무 동작 안 함).
      } catch (e) {
        warn('setLeaderboardScore', e);
        return false;
      }
    },
    async open() {
      try {
        await Game.openLeaderboard();
      } catch (e) {
        warn('openLeaderboard', e);
      }
    },
  },

  haptics: {
    impact(kind) {
      if (!platform.caps.haptics || !HAPTIC[kind]) return;
      generateHapticFeedback({ type: HAPTIC[kind] }).catch(() => {});
    },
  },

  lifecycle: {
    // TODO(토스): 백그라운드 전용 이벤트 문서가 없다 - visibilitychange(web)로 받는다. 실기기에서 오는지 확인(docs/platforms.md 8-4).
    ...web.lifecycle,
    onBack: (cb) => backCbs.push(cb),
    exit: () => Screen.close().catch((e) => warn('Screen.close', e)),
  },

  layout: {
    getInsets() {
      try {
        return SafeArea.get();
      } catch {
        return web.layout.getInsets();
      }
    },
    onInsetsChange: (cb) => insetCbs.push(cb),
  },

  links: { open: () => false }, // 외부 링크 금지(자기 사이트 이동·iframe 금지).
};

export default platform;
