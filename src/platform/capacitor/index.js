// Android/iOS(Capacitor) 공통 어댑터 - docs/platforms.md 2-1·3-3·3-4·14. 차이는 Capacitor.getPlatform(), 원스토어 빌드는 결제만 다르다.
// 설정(광고 id·기능 스위치)은 config/platform.android.json(onestore 빌드도) / platform.ios.json. 플러그인 호출은 try/catch - 실패하면
// 그 기능만 caps에서 꺼진다.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { AdMob, AdmobConsentStatus, BannerAdPosition, BannerAdSize, BannerAdPluginEvents } from '@capacitor-community/admob';
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

const HAPTIC = {
  light: () => Haptics.impact({ style: ImpactStyle.Light }),
  medium: () => Haptics.impact({ style: ImpactStyle.Medium }),
  heavy: () => Haptics.impact({ style: ImpactStyle.Heavy }),
  success: () => Haptics.notification({ type: NotificationType.Success }),
  error: () => Haptics.notification({ type: NotificationType.Error }),
};

// 광고 동의: UMP(필요한 지역이면 폼) -> iOS는 ATT 요청 -> 초기화. 실패해도 게임은 계속(광고만 꺼짐).
async function initAds() {
  const consent = await AdMob.requestConsentInfo();
  if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) await AdMob.showConsentForm();
  if (!isAndroid) {
    const { status } = await AdMob.trackingAuthorizationStatus();
    if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
  }
  await AdMob.initialize({ initializeForTesting: ad.testing });
  AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => {
    bannerActual = size.height;
  });
}

const platform = {
  ...web,
  id: isOneStore ? 'onestore' : isAndroid ? 'android' : 'ios',
  caps: {
    ...web.caps,
    iap: false, // 결제 provider init이 켠다(RevenueCat: revenuecat.apiKey + features.iap, 원스토어: platform.onestore.json).
    ads: false,
    banner: false,
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
    if (f.ads || f.banner || f.rewarded) {
      initAds()
        .then(() => Object.assign(this.caps, { ads: !!f.ads, banner: !!f.banner, rewarded: !!f.rewarded }))
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
    // shortcut: show 직전에 prepare한다(로딩만큼 늦게 뜸) - 출시 전 web처럼 미리 load로 바꾼다.
    async showRewarded() {
      if (!platform.caps.rewarded) return { rewarded: false };
      try {
        await AdMob.prepareRewardVideoAd({ adId: ad.rewarded, isTesting: ad.testing });
        const item = await AdMob.showRewardVideoAd();
        return { rewarded: !!item && item.amount > 0 };
      } catch (e) {
        warn('rewarded', e);
        return { rewarded: false };
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
