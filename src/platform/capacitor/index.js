// Android/iOS(Capacitor) 공통 어댑터 - docs/platforms.md 2-1·3-3·3-4·14. 차이는 Capacitor.getPlatform(), 원스토어 빌드는 결제만 다르다.
// 설정(광고 id·기능 스위치)은 config/platform.android.json(onestore 빌드도) / platform.ios.json. 플러그인 호출은 try/catch - 실패하면
// 그 기능만 caps에서 꺼진다.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { AdMob, AdmobConsentStatus, BannerAdPosition, BannerAdSize, BannerAdPluginEvents, RewardAdPluginEvents } from '@capacitor-community/admob';
import web from '../web/index.js';
import androidCfg from '../../../config/platform.android.json';
import iosCfg from '../../../config/platform.ios.json';

const isAndroid = Capacitor.getPlatform() === 'android';
const cfg = isAndroid ? androidCfg : iosCfg;
const ad = cfg.admob;
const warn = (what, e) => console.warn(`[capacitor] ${what}`, e);
// 결제 provider(docs/platforms.md §14-3): onestore 빌드 = 원스토어 SDK(자체 플러그인), 그 밖 = RevenueCat(Play·App Store).
// 빌드 타임 상수라 번들러가 안 쓰는 쪽(과 그 SDK JS)을 버린다.
// eslint-disable-next-line no-undef
const isOneStore = __PLATFORM__ === 'onestore';
const iapModule = isOneStore ? import('./iap/onestore.js') : import('./iap/play.js');

// 적응형 배너(앵커) 높이 추정 - 폭/6.4, 50~90 그리고 화면 높이 15% 이하(Google 적응형 배너 규칙).
// shortcut: 실제 높이는 SizeChanged로 오지만, 자리(배율)는 이 추정으로 미리 고정한다 - 차이가 크면 실기기에서 보정.
const slotHeight = () => Math.round(Math.max(50, Math.min(90, window.innerWidth / 6.4, window.innerHeight * 0.15)));

const pauseCbs = [];
const resumeCbs = [];
const backCbs = [];
let bannerState = 'none'; // 'none' | 'shown' | 'hidden'
let bannerActual = 0;
// 이벤트 팝업 배너(docs/ads.md 3장) - 하단 배너 상태와 따로. 플러그인은 배너 1개(mAdView)만 지원해서 features.banner가
// 켜지면 caps.popupBanner를 끈다. show/hide는 순서대로(remove가 끝나기 전에 show가 끼면 엉킨다).
let popupBannerOn = false;
let popupChain = Promise.resolve();
const queuePopup = (fn) => (popupChain = popupChain.then(fn).catch((e) => warn('popupBanner', e)));

// 보상형 미리 불러오기(docs/ads.md 2장) - AdMob 준비 직후 1개, show 후 다음 것. true = 불러옴, false = 실패.
let rewardLoad = null;
function prepareRewarded() {
  rewardLoad = AdMob.prepareRewardVideoAd({ adId: ad.rewarded, isTesting: ad.testing }).then(
    () => true,
    (e) => {
      warn('rewarded load', e);
      return false;
    }
  );
  return rewardLoad;
}
const REWARD_SAFETY_MS = 90000; // Dismissed가 끝내 안 오는 경우 대비.

// 리스너 기준 결과: Rewarded = 플래그만, Dismissed/FailedToShow = 그 플래그로 끝. showRewardVideoAd는 보상을 받았을 때만
// resolve하고 중간에 닫으면 끝나지 않는다(플러그인 Android 소스) - 반환값은 안 믿는다. 리스너는 매번 제거.
async function showLoadedRewarded() {
  let rewarded = false;
  let finish;
  const result = new Promise((resolve) => (finish = resolve));
  const handles = await Promise.all([
    AdMob.addListener(RewardAdPluginEvents.Rewarded, () => (rewarded = true)),
    AdMob.addListener(RewardAdPluginEvents.Dismissed, () => finish(true)),
    AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => finish(false)),
  ]);
  const timer = setTimeout(() => finish(true), REWARD_SAFETY_MS);
  AdMob.showRewardVideoAd().catch((e) => {
    warn('rewarded show', e);
    finish(false);
  });
  const shown = await result;
  clearTimeout(timer);
  handles.forEach((h) => h.remove());
  return { shown, rewarded };
}

const HAPTIC = {
  light: () => Haptics.impact({ style: ImpactStyle.Light }),
  medium: () => Haptics.impact({ style: ImpactStyle.Medium }),
  heavy: () => Haptics.impact({ style: ImpactStyle.Heavy }),
  success: () => Haptics.notification({ type: NotificationType.Success }),
  error: () => Haptics.notification({ type: NotificationType.Error }),
};

// 광고 동의: UMP(필요한 지역이면 폼) -> iOS는 ATT 요청 -> 초기화. 실패해도 게임은 계속(광고만 꺼짐).
async function initAds() {
  // 동의 단계 실패(예: AdMob에 GDPR 메시지 미설정 "Publisher misconfiguration")로 초기화까지 막히면 광고가 전부 안 나온다 - 경고만 남기고 진행.
  try {
    const consent = await AdMob.requestConsentInfo();
    if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) await AdMob.showConsentForm();
  } catch (e) {
    warn('consent', e);
  }
  if (!isAndroid) {
    const { status } = await AdMob.trackingAuthorizationStatus();
    if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
  }
  // 실광고 id여도 testDevices에 등록된 폰은 테스트 광고만 받는다(본인 클릭 = 무효 트래픽 방지). id는 logcat "Use RequestConfiguration...setTestDeviceIds"에서.
  const devices = ad.testDevices || [];
  await AdMob.initialize({ initializeForTesting: devices.length > 0, testingDevices: devices });
  AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
    bannerActual = size.height;
  });
}

const platform = {
  ...web,
  id: isOneStore ? 'onestore' : isAndroid ? 'android' : 'ios',
  adTesting: !!ad.testing,
  caps: {
    ...web.caps,
    iap: false, // 결제 provider init이 켠다(RevenueCat: revenuecat.apiKey + features.iap, 원스토어: platform.onestore.json).
    ads: false,
    banner: false,
    popupBanner: false,
    rewarded: false,
    leaderboard: false,
    haptics: !!cfg.features.haptics,
    externalLinks: true,
    backButton: isAndroid,
    // iOS는 앱이 스스로 끄는 걸 애플이 권하지 않는다 - 종료 확인 모달(종료 버튼)을 안 띄운다.
    exit: isAndroid,
    restore: false, // iOS + 결제 켜짐이면 init에서 켠다(상점 "구매 내역 복원").
    autoRestore: false, // Android + 결제 켜짐이면 init에서 켠다(Play는 로그인 팝업 없이 구매 기록을 읽을 수 있다).
    // 평가하기·업데이트 안내 링크는 자기 마켓으로만(원스토어 심사: 다른 마켓 링크 금지).
    storeLinks: isOneStore ? 'onestore' : isAndroid ? 'play' : 'appstore',
  },

  async init() {
    App.addListener('appStateChange', ({ isActive }) => (isActive ? resumeCbs : pauseCbs).forEach((cb) => cb()));
    // 게임이 처리 안 한 뒤로가기(타이틀 등) = 앱 종료(안드로이드 기본 동작과 같게).
    if (isAndroid) App.addListener('backButton', () => backCbs.some((cb) => cb()) || App.exitApp());
    const { default: makeIap } = await iapModule;
    const provider = makeIap({ platform: this, cfg, isAndroid, warn });
    this.iap = provider.iap;
    await provider.init();
    // 동의 폼·ATT 팝업을 기다리면 타이틀이 늦게 뜬다 - 기다리지 않고, 끝나면 광고 caps를 켠다(배너 자리는 설정값으로 이미 비워 둠).
    const f = cfg.features;
    if (f.ads || f.banner || f.rewarded || f.popupBanner) {
      initAds()
        .then(() => {
          Object.assign(this.caps, { ads: !!f.ads, banner: !!f.banner, rewarded: !!f.rewarded, popupBanner: !!f.popupBanner && !f.banner });
          if (f.rewarded) prepareRewarded();
        })
        .catch((e) => warn('AdMob init', e));
    }
  },

  storage: {
    async get(key) {
      try {
        return (await Preferences.get({ key })).value;
      } catch (e) {
        warn('Preferences.get', e);
        return null;
      }
    },
    set: (key, value) => Preferences.set({ key, value }).catch((e) => warn('Preferences.set', e)),
    remove: (key) => Preferences.remove({ key }).catch((e) => warn('Preferences.remove', e)),
  },

  // identity: web 그대로(로컬 UUID - Preferences가 아니라 WebView localStorage). TODO: Play Games / Game Center.

  iap: web.iap, // init에서 결제 provider(iap/play.js | iap/onestore.js)로 바뀐다.

  ads: {
    async showInterstitial() {
      if (!platform.caps.ads) return false;
      try {
        await AdMob.prepareInterstitial({ adId: ad.interstitial, isTesting: ad.testing });
        await AdMob.showInterstitial();
        return true;
      } catch (e) {
        warn('interstitial', e);
        return false;
      }
    },
    // 미리 불러 둔 것을 띄운다. 아직 불러오는 중이면 loadTimeoutMs까지 기다리고, 넘으면 shown:false(로딩은 계속 - 다음 번에 씀).
    async showRewarded(_placement, { loadTimeoutMs = 8000 } = {}) {
      if (!platform.caps.rewarded) return { rewarded: false, shown: false };
      let timer;
      const timeout = new Promise((r) => (timer = setTimeout(() => r('timeout'), loadTimeoutMs)));
      const loaded = await Promise.race([rewardLoad ?? prepareRewarded(), timeout]);
      clearTimeout(timer);
      if (loaded !== true) {
        if (loaded === false) prepareRewarded(); // 실패(noFill 등)는 다시 요청, 타임아웃은 진행 중인 로드를 그대로 둔다.
        return { rewarded: false, shown: false };
      }
      rewardLoad = null;
      try {
        return await showLoadedRewarded();
      } catch (e) {
        warn('rewarded', e);
        return { rewarded: false, shown: false };
      } finally {
        prepareRewarded();
      }
    },
    // 게임이 비워 둔 하단 자리(#banner-slot, 높이 = getBannerSlotHeight) 위치에 띄운다.
    async showBanner() {
      if (!platform.caps.banner) return 0;
      try {
        if (bannerState === 'hidden') await AdMob.resumeBanner();
        else if (bannerState === 'none') {
          await AdMob.showBanner({
            adId: ad.banner,
            isTesting: ad.testing,
            adSize: BannerAdSize.ADAPTIVE_BANNER,
            position: BannerAdPosition.BOTTOM_CENTER,
            margin: web.layout.getInsets().bottom,
          });
        }
        bannerState = 'shown';
        return bannerActual || slotHeight();
      } catch (e) {
        warn('banner', e);
        return 0;
      }
    },
    hideBanner() {
      if (bannerState !== 'shown') return;
      bannerState = 'hidden';
      AdMob.hideBanner().catch((e) => warn('hideBanner', e));
    },
    getBannerSlotHeight: () => (cfg.features.banner ? slotHeight() : 0),
    // 이벤트 팝업 광고 칸. 위치를 바꾸려면 remove -> show(이미 있으면 showBanner는 광고만 다시 불러오고 위치는 무시).
    // margin 단위는 dp(= WebView CSS px, 플러그인이 x density). TOP_CENTER면 플러그인이 safe-area top을 더하므로 뺀다.
    showPopupBanner(rect) {
      if (!platform.caps.popupBanner) return;
      queuePopup(async () => {
        if (popupBannerOn) await AdMob.removeBanner();
        popupBannerOn = true;
        // 플러그인은 margin을 위·아래 여백에 둘 다 넣는다 -> 2*margin + 높이 > 화면이면 배너 높이가 0(안 보임).
        // 그래서 칸이 화면 아래 절반이면 BOTTOM 기준으로 띄워 margin을 작게 유지한다(실기기 확인 2026-11-10).
        const insets = web.layout.getInsets();
        const bottom = rect.y + rect.height / 2 > window.innerHeight / 2;
        await AdMob.showBanner({
          adId: ad.popupBanner,
          isTesting: ad.testing,
          adSize: BannerAdSize.BANNER,
          position: bottom ? BannerAdPosition.BOTTOM_CENTER : BannerAdPosition.TOP_CENTER,
          margin: Math.max(0, Math.round(bottom ? window.innerHeight - rect.y - rect.height - insets.bottom : rect.y - insets.top)),
        });
      });
    },
    hidePopupBanner() {
      queuePopup(async () => {
        if (!popupBannerOn) return;
        popupBannerOn = false;
        await AdMob.removeBanner();
      });
    },
  },

  haptics: {
    impact(kind) {
      if (platform.caps.haptics) HAPTIC[kind]?.().catch(() => {});
    },
  },

  lifecycle: {
    onPause: (cb) => pauseCbs.push(cb),
    onResume: (cb) => resumeCbs.push(cb),
    onBack: (cb) => backCbs.push(cb),
    exit: () => (isAndroid ? App.exitApp() : undefined),
  },
};

export default platform;
