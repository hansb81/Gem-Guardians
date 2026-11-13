// 마켓 어댑터가 지켜야 할 모양(docs/platforms.md 2장). 게임 코드는 src/platform/index.js의 platform만 부른다 -
// window.Capacitor, TossAds, @apps-in-toss/* 등을 직접 참조하지 않는다.
// 아래 기본 구현은 전부 안전한 no-op이다. 어댑터는 createPlatform(overrides)로 필요한 부분만 바꾼다.

/**
 * @typedef {'web'|'toss'|'android'|'onestore'|'ios'} PlatformId
 * @typedef {'light'|'medium'|'heavy'|'success'|'error'} HapticKind
 * @typedef {{ top:number, right:number, bottom:number, left:number }} Insets
 * @typedef {{ key:string, priceKRW:number, storeId?:string, priceText?:string }} Product
 * @typedef {{ ok:boolean, productKey:string, orderId?:string, reason?:string }} PurchaseResult
 *   ok=true = 결제 + 지급까지 끝남. 어댑터는 인벤토리를 직접 만지지 않고 게임이 넘긴 onGrant 콜백만 부른다(토스
 *   processProductGrant처럼 "지급 성공을 스토어에 알린 뒤에만 완료"). 게임 쪽 지급은 inventory txId `iap:{productKey}:{orderId}`
 *   한 번이라 같은 주문을 여러 번 불러도 두 번 지급되지 않는다.
 * @typedef {(productKey:string, orderId:string) => any|Promise<any>} OnGrant    지급 성공(또는 이미 지급)이면 참 값(게임은 { delta } - 서버 기록용, 어댑터는 참/거짓만 본다)
 * @typedef {(productKey:string, orderId:string) => void} OnRevoke   환불된 비소모성 주문 - 게임이 회수
 *
 * @typedef {Object} Platform
 * @property {PlatformId} id
 * @property {boolean} adTesting  광고가 테스트 모드(테스트 id) - 이벤트 팝업에 배너 목표 위치 테두리를 그린다(실기기 위치 확인용)
 * @property {boolean} dev   개발용 가짜 결제를 덮어쓴 상태(src/platform/dev) - 상점이 마켓 상품 id 없이도 현금 상품을 보여 준다
 * @property {{ iap:boolean, ads:boolean, banner:boolean, rewarded:boolean, leaderboard:boolean,
 *              externalLinks:boolean, haptics:boolean, popupBanner:boolean, backButton:boolean, exit:boolean, restore:boolean, autoRestore:boolean,
 *              storeLinks:'play'|'onestore'|'appstore'|null, coupon:boolean, login:string[] }} caps
 *   restore = 상점에 "구매 내역 복원"을 보일지(iOS 필수). autoRestore = 시작할 때 restore를 자동으로 돌릴지(토스 - 복원 버튼 없음,
 *   앱을 지우면 Storage도 지워지므로 재설치 때 비소모성을 되살린다).
 *   exit = lifecycle.exit()로 앱을 닫을 수 있는지(종료 확인 모달을 띄울지). android: App.exitApp, toss: 미니앱 닫기,
 *   ios: false(애플은 앱이 스스로 끄는 걸 권하지 않음 - 종료 버튼 없음).
 *   storeLinks = 평가하기·업데이트 안내 링크를 보낼 마켓(자기 마켓만 - 원스토어 심사는 다른 마켓 링크 금지). null = 링크 없음.
 *   coupon = 설정 팝업 쿠폰 입력(docs/coupon.md §7). 기본 켬, iOS는 platform.ios.json features.coupon=false로 끔.
 *   login = 계정 연결에 쓸 로그인 수단(docs/auth.md §2-1). 비면 설정의 계정 줄을 숨긴다(토스 - 토스 계정이 곧 로그인).
 * @property {{ providers:string[], redirect:boolean,
 *              getIdToken(provider:string, opts:{webClientId:string}):Promise<{ok:true, idToken:string, nonce?:string, accessToken?:string}|{ok:false, reason:'cancel'|'unavailable'|'error'}> }} auth
 *   redirect = 웹: Supabase OAuth로 Google 페이지에 갔다 온다(getIdToken 안 씀). 앱: 기기 Google 로그인 창 -> ID 토큰.
 * @property {() => Promise<void>} init
 * @property {{ get(key:string):Promise<string|null>, set(key:string, str:string):Promise<void>, remove(key:string):Promise<void> }} storage
 * @property {{ get(key:string):string|null, set(key:string, str:string):void, remove(key:string):void }} session
 *   탭 하나 동안만(동기) - 웹 Google 리다이렉트 왕복 기록(src/net/account.js authIntent). 앱 빌드는 리다이렉트가 없어 안 씀.
 * @property {{ getUserId():Promise<string>, getAnonymousKey?():Promise<string|null> }} identity  getAnonymousKey = 토스만(실패 null)
 * @property {{ getProducts():Promise<Product[]>, purchase(productKey:string, onGrant:OnGrant):Promise<PurchaseResult>,
 *              restore(onGrant:OnGrant, onRevoke:OnRevoke):Promise<PurchaseResult[]>, recoverPending(onGrant:OnGrant):Promise<PurchaseResult[]>,
 *              getStoreStatus():null|'needLogin'|'needUpdate'|'unavailable', fixStoreStatus():Promise<boolean> }} iap
 *   recoverPending = 결제는 됐는데 지급 전에 꺼진 주문을 시작할 때 다시 지급(onGrant 성공 후에만 스토어에 지급 완료).
 *   restore = 완료된 비소모성 주문(config/products.json type) 다시 지급 + 환불된 것은 onRevoke.
 *   getStoreStatus = 결제 전에 사용자가 할 일(원스토어: 서비스 앱 로그인/설치) - null이면 없음. 상점 현금 탭이 안내 + 버튼을 띄우고,
 *   버튼은 fixStoreStatus(로그인·설치 화면 -> 다시 연결, 연결되면 true).
 * @property {{ showInterstitial(placement:string):Promise<boolean>, showRewarded(placement:string, opts?:{loadTimeoutMs?:number}):Promise<{rewarded:boolean, shown:boolean}>,
 *              showBanner():Promise<number>, hideBanner():void, getBannerSlotHeight():number,
 *              showPopupBanner(rectCss:{x:number,y:number,width:number,height:number}):void, hidePopupBanner():void }} ads
 *   showRewarded: shown=false = 못 띄움(로드 실패·noFill·loadTimeoutMs 초과 - 게임은 "불러오지 못했어요"), rewarded = 끝까지 봐서 보상 이벤트를 받음.
 *   showPopupBanner = 이벤트 팝업 광고 칸(docs/ads.md 3장) - 하단 배너(showBanner·#banner-slot)와 별개, caps.popupBanner. rectCss = 화면 CSS px.
 *   showBanner = 실제로 뜬 배너 높이(px), 안 채워지면(noFill) 0. getBannerSlotHeight = 화면에 늘 비워 둘 배너 자리 높이(px, 동기)
 *   - 토스 102 고정, AdMob 적응형은 기기 폭으로 계산. 게임은 이 자리(<div id="banner-slot">)를 배율 변화 없이 항상 비워 두고,
 *   어댑터는 배너를 그 요소(토스 attachBanner 대상) 또는 그 위치(AdMob 하단)에 띄운다.
 * @property {{ submit(score:number):Promise<boolean>, open():Promise<void> }} leaderboard   submit = 성공하면 true
 * @property {{ impact(kind:HapticKind):void }} haptics
 * @property {{ onPause(cb:Function):void, onResume(cb:Function):void, onBack(cb:() => boolean):void, exit():void }} lifecycle
 *   onBack cb가 true를 돌려주면 게임이 처리한 것(앱 종료/뒤로 안 함). exit = 앱(미니앱) 닫기 - 종료 확인 모달의 "종료".
 * @property {{ getInsets():Insets, onInsetsChange(cb:(insets:Insets) => void):void }} layout
 * @property {{ open(url:string):boolean }} links   caps.externalLinks=false면 아무것도 안 하고 false
 */

const noop = () => {};
const resolved = (v) => () => Promise.resolve(v);

/** @returns {Platform} */
export function defaultPlatform() {
  return {
    id: 'web',
    dev: false,
    adTesting: false,
    caps: { iap: false, ads: false, banner: false, popupBanner: false, rewarded: false, leaderboard: false, externalLinks: false, haptics: false, backButton: false, exit: false, restore: false, autoRestore: false, storeLinks: null, coupon: true, login: [] },
    auth: { providers: [], redirect: false, getIdToken: resolved({ ok: false, reason: 'unavailable' }) },
    init: resolved(undefined),
    storage: { get: resolved(null), set: resolved(undefined), remove: resolved(undefined) },
    session: { get: () => null, set: noop, remove: noop },
    identity: { getUserId: resolved('') },
    iap: {
      getProducts: resolved([]),
      purchase: (productKey) => Promise.resolve({ ok: false, productKey, reason: 'unsupported' }),
      restore: resolved([]),
      recoverPending: resolved([]),
      getStoreStatus: () => null,
      fixStoreStatus: resolved(false),
    },
    ads: { showInterstitial: resolved(false), showRewarded: resolved({ rewarded: false, shown: false }), showBanner: resolved(0), hideBanner: noop, getBannerSlotHeight: () => 0, showPopupBanner: noop, hidePopupBanner: noop },
    leaderboard: { submit: resolved(false), open: resolved(undefined) },
    haptics: { impact: noop },
    lifecycle: { onPause: noop, onResume: noop, onBack: noop, exit: noop },
    layout: { getInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), onInsetsChange: noop },
    links: { open: () => false },
  };
}

// 기본값 위에 어댑터 구현을 한 단계(그룹별) 덮어쓴다 - 빠진 메서드는 no-op으로 남는다.
/** @returns {Platform} */
export function createPlatform(overrides) {
  const base = defaultPlatform();
  for (const [k, v] of Object.entries(overrides)) {
    base[k] = v && typeof v === 'object' && typeof base[k] === 'object' ? { ...base[k], ...v } : v;
  }
  return base;
}
