# Gem Guardians 마켓별 빌드 계획 v1

작성 2026-11-08 · 대상 마켓 4개: **일반 웹 / 토스 미니앱 / Google Play / App Store**
→ 저장소에는 `docs/platforms.md`로 옮겨 두면 됩니다.

---

## 0. 한 줄 요약

- 게임 코드는 **하나**로 유지하고, 마켓마다 다른 부분(결제·광고·로그인·랭킹·저장·햅틱·생명주기·안전영역)만 `src/platform/` 아래 **어댑터 4종**으로 갈라 끼웁니다.
- 빌드는 같은 소스에서 `PLATFORM=web | toss | android | ios` 값만 바꿔 4번 뽑습니다. Android/iOS는 Capacitor 껍데기, 토스는 `.ait` 번들, 웹은 정적 파일입니다.
- **추천 출시 순서: 웹(무료 베타) → Google Play → 토스 미니앱 → App Store.** 구글플레이에서 받는 IARC 등급을 토스 심사의 등급 근거로 재사용할 수 있어서 이 순서가 제일 덜 막힙니다. (§7)

---

## 1. 결정해야 할 것 (쑹)

| # | 질문 | 추천 | 이유 |
|---|---|---|---|
| D1 | 개인사업자 등록 시점 | **구글플레이 유료 기능 붙이기 전** | 토스는 인앱결제·광고 둘 다 사업자등록 필수. 구글/애플도 판매자 정보에 사업자 정보가 사실상 필요(한국 전자상거래법상 통신판매업 신고도 같이 검토). |
| D2 | 웹 버전에 결제 넣을지 | **넣지 않음 (무료 + 선택적 광고)** | 웹 PG 연동·환불·통신판매업까지 일이 커지는데 매출 기대는 낮음. 웹은 홍보/베타 창구로. |
| D3 | 세이브를 마켓 간 공유할지 | **v1은 공유 안 함 (마켓마다 따로)** | 공유하려면 계정 서버 + 로그인 연동이 필요. 랭킹 서버(Supabase) 만들 때 같이 검토. |
| D4 | 랭킹 서버 | **v1 출시는 로컬 가짜 리스트 유지, 토스는 토스 리더보드 사용** | 현재 랭킹은 디자인만 있음. 마켓 공통 실서버는 출시 후 2차. |
| D5 | 토스 미니앱 진행 여부 | **진행 (단, 19세 이상 서비스라는 점 감안)** | 토스 앱인토스는 플랫폼 전체가 19세 이상 대상(FAQ). 게임 타깃과 맞는지 확인 필요. |

---

## 2. 공통 코어 vs 마켓 어댑터

```
src/
  core/ … 퍼즐, 전투, 밸런스, 인벤토리, 상점 로직 (플랫폼 모름)
  render/ … 캔버스 렌더
  ui/ … 팝업, 메뉴
  platform/
    index.js         ← PLATFORM 값 보고 어댑터 하나 골라 export
    interface.js     ← 어댑터가 지켜야 할 모양(JSDoc) + 기본 no-op
    web/             ← 브라우저
    capacitor/       ← android + ios 공통 (차이는 Capacitor.getPlatform())
    toss/            ← @apps-in-toss/web-framework
    dev/             ← 개발용 가짜 결제/광고 (지금 dev receipt 쓰는 것 흡수)
```

게임 코드는 **`platform.xxx()`만 부르고**, `window.Capacitor`·`TossAds` 같은 걸 직접 만지지 않습니다. 이미 있는 `haptics.js`, 계획된 `ads.js` 스텁이 이 구조의 첫 조각입니다.

### 2-1. 어댑터 기능표

| 기능 | 웹 | 토스 미니앱 | Android (Capacitor) | iOS (Capacitor) |
|---|---|---|---|---|
| 저장 | localStorage | `Storage.setItem/getItem` (문자열, Promise) · 앱 삭제 시 지워짐 | `@capacitor/preferences` | 동일 |
| 결제(IAP) | 없음 (D2) | `IAP.createOneTimePurchaseOrder` + `processProductGrant` 콜백, `getPendingOrders`/`completeProductGrant`로 미지급 복구 | Google Play Billing (플러그인: RevenueCat 또는 cordova-plugin-purchase) | StoreKit (같은 플러그인) |
| 광고 | 없음 또는 웹 광고(선택) | `loadFullScreenAd`/`showFullScreenAd`(전면·보상), `TossAds.attachBanner`(배너, 높이 102px 고정) | `@capacitor-community/admob` + UMP 동의 | 동일 + ATT 팝업 |
| 사용자 식별 | 로컬 UUID | `User.getAnonymousKey()` → hash | 로컬 UUID (+추후 Play Games) | 로컬 UUID (+추후 Game Center) |
| 랭킹 | 로컬 가짜 | `submitGameCenterLeaderBoardScore({score})` / `openGameCenterLeaderboard()` (보드 1개) | 로컬 가짜 → 추후 서버 | 동일 |
| 햅틱 | `navigator.vibrate`(안드 브라우저만) | `generateHapticFeedback({type})` | `@capacitor/haptics` | 동일 |
| 생명주기(백그라운드) | `visibilitychange` | `visibilitychange` (토스 문서에 전용 이벤트 없음 → 실기기 확인) | `@capacitor/app` `appStateChange` | 동일 |
| 뒤로가기 | 없음 | `graniteEvent` `backEvent` | `@capacitor/app` `backButton` | 없음 |
| 안전영역 | CSS `env(safe-area-inset-*)` | `getSafeAreaInsets()` / `SafeArea.subscribe` | CSS env + 플러그인 | CSS env |
| 외부 링크 | 허용 | **금지** (자기 사이트 이동/iframe 금지) | 허용(정책 범위 내) | 허용(정책 범위 내) |
| 오디오 첫 재생 | 첫 탭 후 | 첫 탭 후 (`mediaPlaybackRequiresUserAction` 기본 true) | 첫 탭 후 권장 | 첫 탭 후 권장 |

### 2-2. 상품 카탈로그는 한 곳에서

`config/products.json` 하나에 상품을 정의하고 마켓별 ID만 매핑합니다.

```json
{ "dia_small": { "grant": {"dia": 100},
    "ids": { "toss": "…", "android": "dia_small", "ios": "com.gg.dia_small" },
    "priceKRW": 1200 } }
```

- 지급은 **무조건 인벤토리 `grant(txId)` 하나로** (txId = `iap:{product}:{주문ID}` 이미 설계됨). 중복 지급 방지가 이미 있으니 그대로 씁니다.
- 토스 가격은 공급가(부가세 제외) 400원~140만원, 10원 단위, 게임은 상품 80개까지, 상품 이미지 1024×1024 필요.
- 토스·구글·애플 모두 **현금화 가능한 상품 금지, 과장된 상품명 금지** 같은 규칙이 비슷합니다. "무제한" 같은 표현은 피하세요.
- 확률형 상품(랜덤 박스류)을 유료로 팔면 **게임산업법상 확률 공개 의무**가 있습니다. 지금 상점에 유료 랜덤 상품이 없다면 그대로 두는 걸 추천.

---

## 3. 마켓별 상세

### 3-1. 일반 웹

- 호스팅: GitHub Pages 또는 Cloudflare Pages (정적). PWA(manifest + service worker)로 홈 화면 추가 가능하게.
- 결제 없음(D2). 광고는 원하면 나중에.
- 저장은 localStorage라 브라우저 데이터 삭제 시 날아간다는 안내를 설정 화면에 한 줄.
- 오디오: 타이틀에서 첫 탭 전엔 BGM 시작 안 함(이미 그렇게 되어 있으면 OK).
- ⚠️ 국내에서 웹으로 게임을 **정식 서비스**하면 원칙상 게임물관리위원회 등급분류 대상입니다. 무료 베타/데모 단계는 위험이 낮지만, 정식 출시 전엔 확인 필요(불확실, §8).

### 3-2. 토스 미니앱 (앱인토스)

조사 결과 핵심만 정리했습니다. 출처는 §9.

**기술**
- WebView SDK로 지금 HTML/JS 게임을 그대로 올릴 수 있음. 패키지 `@apps-in-toss/web-framework`, `npx ait init` → `apps-in-toss.config.ts` (`appName`, `webBundleDir: "dist"`), `npm run build` → `.ait`, `npx ait deploy`.
- SDK는 3.x 기준 (2026-09-14까지 3.x 전환 의무였음). 압축 해제 후 100MB 이하. Android 7+/iOS 16+.
- 번들은 토스가 호스팅. **eval/외부 코드 실행 금지, iframe 금지, 자기 도메인으로 이동 금지.** 서버 호출은 HTTPS만, 서버 CORS에 `https://<appName>.apps.tossmini.com`, `https://<appName>.private-apps.tossmini.com` 추가.
- iOS에서 서드파티 쿠키가 막히므로 서버 인증은 토큰 방식.
- 시스템 다크모드 미지원(라이트 모드 기준). 게임 아트가 어두운 건 문제없을 것으로 보이나 토스 상단 내비게이션바와 어울리는지 실기기 확인.

**심사 체크리스트 중 우리 게임에 걸리는 것**
- 첫 화면까지 10초 이내. → 프리로더가 무거우면 타이틀 먼저 띄우고 나머지 지연 로딩.
- 소리 켜기/끄기 가능, **백그라운드 가면 즉시 정지, 돌아오면 재생**, 무음모드 존중.
- 우측 상단 닫기 버튼 영역(다이내믹 아일랜드 포함)을 침범하지 말 것 → 상단 재화바/일시정지 버튼 위치 점검. 전체화면 게임은 안전영역 미적용 시 반려.
- 모든 화면에서 나갈 수 있어야 하고, 나갈 때 확인 모달. 안드로이드 뒤로가기는 뒤로/종료.
- 진입 시 자동 바텀시트(로그인·알림 동의 등) 금지. → **닉네임 팝업을 첫 진입에 자동으로 띄우면 위험.** 토스 빌드에선 랭킹 팝업 열 때만 띄우기.
- 2초 넘는 멈춤 금지 (보드 생성/층 전환 확인).
- 사용자 식별값을 시작 시 확인·저장하고, 껐다 켜도 진행 유지.
- 결제: 결제 중 BGM 정지, 취소 시 주문 화면으로 복귀, 기기 바꿔도 구매 유지, 결제 내역 보기 제공.
- 광고: 인트로/로딩/컷신/팝업 위 광고 금지, 미리 로드, 배너는 상단/하단만, 광고 중 BGM 정지. **게임 조작 영역이나 버튼 바로 옆 배치 금지** → 아이템 핫바와 배너 사이 간격 필수(광고 메모와 같은 결론).
- 리더보드는 미니앱당 1개, 점수는 문자열 숫자, 게임 끝난 뒤 제출, 서버 검증 없음. → **일반모드 최고층**을 토스 리더보드에 올리고, 경쟁모드(주간)는 자체 서버 생기기 전까지 토스 빌드에서 숨김.

**사업/운영**
- 등급분류 필수: 스토어 링크 또는 게임물관리위원회 서류 제출. → 구글플레이 출시 후 그 링크로 제출하는 게 제일 쉬움.
- 인앱결제·광고·토스 로그인은 **사업자등록 필수**. 간이과세자도 정산 가능(현금영수증 발행).
- 수수료: 인앱결제 = 앱마켓 수수료 15%(또는 30%) + 토스 5% (문서끼리 표현이 엇갈림, CBT 0% 언급도 있음). 광고 15%. 정산은 다음 달 1일 집계, 그다음 달 말 입금.
- 기간: 앱 등록 1~2영업일, 출시 심사 3~5영업일, 게임은 개발~출시 2~4주 잡으라고 안내.
- 플랫폼 이용자는 **19세 이상**.

### 3-3. Google Play (Capacitor Android)

- 2026-08-31 이후 신규/업데이트는 **targetSdk 36(Android 16)** 필요. 1년 뒤 37 예상.
- 2023-11 이후 만든 **개인 개발자 계정은 비공개 테스트 12명 이상 × 14일** 후에야 프로덕션 신청 가능. → 웹 베타 테스터를 여기로 그대로 데려오면 됨.
- 디지털 상품은 Google Play 결제 필수 (한국은 제휴 대체결제 허용되지만 v1은 Play 결제만).
- 필수 서류: 데이터 보안 양식, 개인정보처리방침 URL(웹에 한 페이지 호스팅), IARC 등급 설문, 광고 포함 표시, 앱 접근 권한 안내.
- AdMob: UMP 동의 팝업(유럽 등), `app-ads.txt`를 개발자 웹사이트 루트에 배치.
- AAB 서명: Play App Signing 사용, 업로드 키는 안전한 곳에 백업(분실 시 재발급 절차 번거로움).
- **서명 키는 저장소 폴더 밖에만 둔다**(.gitignore: `*.jks`, `*.keystore`, `*.p12`, `signing-key*`, `android/*.zip`, `keystore.properties`).
  2026-11-09 키(`gemguardians`, SHA-256 `E1:AA:40:…:6D:CE`)가 공개 저장소에 올라가 유출 → 2026-11-12 기록에서 삭제, 새 키로 교체(Play: 앱 서명 키 업그레이드 + 업로드 키 재설정, 원스토어: 처음부터 새 키로 등록). 옛 키는 다시 쓰지 않는다.
  새 키(저장소 밖 `D:\GoogleKeys`, 백업 2곳): 앱 서명 `gemguardians2` SHA-256 `56:D5:4C:45:61:43:66:84:22:B7:A4:DB:B2:78:71:C9:A8:E5:DB:82:0E:8D:60:95:61:84:06:51:87:DC:6A:3A`,
  업로드 `upload2` SHA-256 `92:67:A4:36:89:2B:65:EB:5C:62:C9:18:84:15:DF:61:45:35:6B:DF:0B:39:08:A8:8B:FF:F6:64:27:DE:A6:82`.
  Play 앱 서명 키는 "Java Keystore의 키 내보내기 및 업로드"(PEPK)로 업그레이드 - 원스토어에 같은 키를 쓰기 위해(O1).
- 앱 아이콘·스플래시(`android/app/src/main/res`의 mipmap-*, drawable*)는 `art/store/build_store_art.py`로만 만든다(정수배 nearest). `@capacitor/assets`는 축소 때 보간이 들어가 픽셀아트가 흐려지므로 쓰지 않는다.

### 3-4. App Store (Capacitor iOS)

- **Mac + Xcode 26 필요** (2026-04부터 iOS 26 SDK로 빌드해야 업로드 가능). 개발자 프로그램 연 $99.
- 디지털 상품은 StoreKit(IAP) 필수, **구매 복원 버튼** 필요(비소모성 상품: 광고 제거, 패스 등).
- 앱 개인정보 라벨, 광고 추적 시 **ATT 팝업**, 개인정보처리방침 URL.
- 연령 등급 설문(2025년 개편된 13+/16+/18+ 체계). 한국 스토어는 애플 자체등급으로 처리.
- 웹뷰 게임이어도 게임 자체가 완결되어 있으면 4.2(최소 기능) 문제는 거의 없음. 외부 결제 유도 링크는 넣지 말 것.
- TestFlight로 먼저 내부 테스트.

---

## 4. 공통 이슈별 정리

**오디오**: 모든 마켓 공통으로 "첫 사용자 탭에서 AudioContext unlock → BGM 시작". 백그라운드 시 BGM/SFX 정지, 복귀 시 재개. 광고/결제 중엔 `platform.audio.duck/pause`. 이미 있는 maintenance 팝업 ducking 0.7x와 같은 통로로.
ogg+mp3 둘 다 있으니 iOS(웹뷰)는 mp3, 나머지는 ogg 우선으로 자동 선택하면 됩니다.

**안전영역/레이아웃**: 지금 9:16 고정 캔버스 + 레터박스 구조 그대로. 어댑터가 `getInsets()`로 상하좌우 여백을 주면 `resize()`가 그만큼 빼고 배치. 배너 높이도 어댑터가 알려줌 (토스 102px, AdMob 적응형 ~50-60px).

**저장**: 어댑터 `storage`는 전부 **async**로 통일 (토스 Storage가 Promise라서). 지금 동기 localStorage 호출이 있다면 시작 시 한 번 읽어 메모리 캐시 → 쓰기는 비동기 flush 방식이 가장 덜 고침.

**랭킹/식별**: `platform.identity.getUserId()`로 통일. 랭킹 서비스는 이미 Local/Server 구조라 `TossLeaderboardService`를 하나 더 추가하는 형태.

**광고 제거(adFree)**: `isAdFree()` 그대로. 토스는 배너 붙이면 상점 문구에 "배너 제거"까지 써야 함(광고 메모와 동일).

---

## 5. 빌드 / CI

- 번들러: 지금 순수 HTML/JS라면 **Vite 도입 추천**. 토스(`webBundleDir: dist`)와 Capacitor(`webDir: dist`) 둘 다 빌드 결과 폴더를 요구하고, 마켓별 어댑터를 빌드 타임에 골라 다른 마켓 SDK가 섞이지 않게 할 수 있음.
- 스크립트 예:
  - `npm run build:web` → `dist/` → Pages 배포
  - `npm run build:toss` → `ait build` → `.ait` → `npx ait deploy`
  - `npm run build:android` → `cap sync android` → Android Studio/Gradle로 AAB
  - `npm run build:ios` → `cap sync ios` → Xcode Archive (Mac에서만)
- GitHub Actions: v1은 **웹 자동 배포 + 테스트만** 추천. 토스는 API 키로 CI 업로드 가능하지만 처음엔 수동. Android AAB 서명 CI는 출시 안정된 후.
- 버전: `package.json` version 하나를 Android `versionName/versionCode`, iOS `CFBundleShortVersionString`, 토스 업로드 메모에 같이 사용.

---

## 6. 개발 단계 (쑹이 Claude Code로 진행)

| 단계 | 내용 | 결과 |
|---|---|---|
| P0 | 현재 코드 조사 + Vite 도입 + `src/platform/` 인터페이스와 web/dev 어댑터 | 웹 빌드가 지금과 똑같이 동작 |
| P1 | 저장 async화, 오디오 unlock/백그라운드 정지, 안전영역/배너 높이 반영, 외부 링크 게이트 | 4마켓 공통 기반 |
| P2 | Capacitor Android: preferences/haptics/app/AdMob/IAP, 상품 카탈로그 | Play 비공개 테스트 시작 (14일 카운트) |
| P3 | 토스 어댑터: Storage, IAP, 광고, 리더보드, 햅틱, 뒤로가기, 닫기 확인 모달 | 토스 콘솔 QR 테스트 |
| P4 | iOS: StoreKit, ATT, 구매 복원, 아이콘/스플래시 | TestFlight |

프롬프트는 [prompt-claude-code-platform-adapter.md](prompt-claude-code-platform-adapter.md) (P0~P1 범위 + P2/P3 어댑터 뼈대).

---

## 7. 출시 순서 (추천)

1. **웹 무료 베타** — 결제 없음. 피드백 + Play 테스터 12명 모집 창구.
2. **Google Play** — 비공개 테스트 14일 → 프로덕션. 여기서 IARC 등급 확보.
3. **토스 미니앱** — 사업자등록 + Play 스토어 링크로 등급 제출, 심사 3~5영업일.
4. **App Store** — Mac 확보 후. 구매 복원/ATT 추가.

토스를 2번으로 당기고 싶다면, 게임물관리위원회 등급분류를 직접 받아야 하는지가 관건이라 그 확인이 먼저입니다.

---

## 8. 불확실한 점 (확인 필요)

1. **토스 인앱결제 수수료**: 문서에 "15% + 5%"와 "15% 또는 30%, CBT 0%"가 같이 있음 → 콘솔 계약 화면에서 확인.
2. **토스 배너 광고 지원 여부**: 배너 API 문서는 있음(앱 5.241.0+), FAQ는 "전면·보상만 지원"이라 적혀 있음 → 실제 지원은 콘솔에서 광고 그룹 만들 때 확인.
3. **토스에서 AdMob SDK 직접 사용**: 명시적 금지 문구는 못 찾았지만 "SDK 외 API 호출 금지"라 사실상 불가로 보고 토스 광고 API만 사용.
4. **토스 백그라운드 이벤트**: 문서엔 `backEvent`/`homeEvent`만 있음. 브라우저 `visibilitychange`가 오는지 실기기 테스트.
5. **웹 정식 서비스 시 등급분류**: 무료 웹게임도 대상인지, 해외 호스팅이면 어떤지 → 게임물관리위원회 문의 권장.
6. **토스 19세 이상 정책**: 플랫폼 공통 조건으로 읽힘. 게임 등급과 별개.
7. **토스 Storage 용량 제한**: 문서에 없음. 세이브 v2 크기(로그 50개 등) 실측 후 문제 있으면 압축.

---

## 9. 출처

- 토스 게임 SDK 가이드(블로그): https://toss.im/apps-in-toss/blog/apps-in-toss-game-sdk-guide
- 게임 출시 체크리스트: https://developers-apps-in-toss.toss.im/landing-page/landing-page-en/checklist/app-game
- 인앱결제: https://developers-apps-in-toss.toss.im/guide/en/monetization/in-app-payment
- 인앱광고: https://developers-apps-in-toss.toss.im/guide/en/monetization/in-app-ad · 전면/보상: https://developers-apps-in-toss.toss.im/documentation/api-and-sdk-en/common/monetization/iaa/interstitial-rewarded-ad.md · 배너: https://developers-apps-in-toss.toss.im/documentation/common/monetization/iaa/web-banner.md
- 리더보드: https://developers-apps-in-toss.toss.im/documentation/api-and-sdk-en/common/growth/game-center
- FAQ: https://developers-apps-in-toss.toss.im/guide/en/faq
- 시작하기: https://developers-apps-in-toss.toss.im/documentation/api-and-sdk-en/integration/getting-started · WebView 튜토리얼: https://developers-apps-in-toss.toss.im/ai-vibe-coding/tutorials/webview.md · 설정: https://developers-apps-in-toss.toss.im/documentation/integration/props.md
- Storage: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/storage.md · SafeArea: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/safearea/getsafeareainsets.md · 햅틱: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/device/device.triggerhaptic.md · 사용자 키: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/user/user.getanonymouskey.md · 이벤트: https://developers-apps-in-toss.toss.im/documentation/sdk/events/graniteevent.md
- Google Play target SDK: https://developer.android.com/google/play/requirements/target-sdk
- Apple SDK 요건: https://developer.apple.com/news/upcoming-requirements/

---

## 10. 프롬프트 A 결과 판정 (2026-11-08)

| # | 내용 | 판정 |
|---|---|---|
| 1 | dev 없는 웹에서 현금 상품 = 결제 실패 토스트 | **현금 탭 숨김.** `caps.iap=false`면 상점의 현금 탭(패키지/다이아/상품) 자체를 렌더하지 않음. 실패 토스트 경로는 남겨 두되 도달 불가. |
| 2 | web 어댑터 navigator.vibrate로 안드 크롬 진동 생김 | **수용.** 단, 설정의 진동 토글을 반드시 거치게(어댑터가 아니라 래퍼에서 체크). |
| 3 | 상품 키 = 기존 id(pack.starter, dia.0~5) | **수용.** `dia.N`은 순서 의미가 고정된 레거시 키로 동결, 순서 변경 금지 주석 + products.json 키 목록 스냅샷 테스트. 새 상품부터는 이름 키(`dia.big` 등). |
| 4 | 마켓별 ids 전부 null | **수용.** 해당 마켓 id가 null인 상품은 그 마켓 빌드에서 숨김(dev 제외). |
| 5 | 다이아 = 기본+보너스, 첫 구매 시 기본만큼 추가, 패스 = 즉시 지급분 | **수용.** 첫 구매 여부는 인벤토리 grantedTx에 `iap:{key}:*`가 있는지로 판정. 스토어 상품 설명엔 기본 지급량만 쓰고 첫 구매 2배는 게임 안 표시로만(스토어 심사 과장 표현 회피). |
| 6 | dev 덮어쓰기는 ?dev=1 + web 빌드에서만 | **수용.** |
| 7 | ads.js 없음, 가짜 광고 없음 | **수용.** 광고 호출부는 처음부터 platform.ads로 작성. |

미룬 항목(storage 동기 호출, AudioManager visibilitychange, resize insets)과 미검증(getInsets, links.open)은 프롬프트 B 범위 그대로. serve.py 경로는 B 끝날 때까지 유지, 이후 Vite dev로 일원화 검토.

## 11. 프롬프트 B 결과 판정 (2026-11-08)

| # | 내용 | 판정 |
|---|---|---|
| 1 | 설정 팝업 진동 토글 신설(터치 기기만, +56px) | **수용.** 9:16 최소 높이에서 팝업이 프레임 안에 들어가는지만 확인. |
| 2 | lifecycle.exit() 추가 | **수용.** Android = `App.exitApp()`, iOS = 종료 버튼 숨김(애플은 앱 스스로 종료 비권장), 토스 = 미니앱 닫기 SDK 함수(C단계에서 이름 확인), 웹 = no-op + 버튼 숨김. |
| 3 | 뒤로가기 세부 | 타이틀 = OS 기본 **수용**. 화면 전환 중 무시 **수용**. 랭킹 통째 닫기 **수용**(닉네임은 다음에 열 때 다시 뜸). **변경:** 튜토리얼 = 건너뛰기 확인 모달, 층 클리어/패배 팝업 = 종료 확인 모달. 토스 심사는 "뒤로가기는 뒤로 가거나 종료"여야 하고 막으면 다크패턴으로 봄. |
| 4 | 배너 시점 | **변경:** 메인 메뉴 + 전투 화면에서만 표시. 타이틀, 로딩/프리로더, 문 전환, 튜토리얼에서는 숨김(토스: 인트로·로딩·컷신 광고 금지). 팝업은 캔버스 안이라 배너와 안 겹치므로 팝업 중 유지. 광고 제거 시 미표시 그대로. |
| 5 | pauseFor('ad') 미연결 | **수용.** 광고 붙일 때 연결. |
| 6 | 결제·광고 중 BGM만 끔 | 결제 = BGM만 **수용**. 광고 = **SFX도 끔**(AudioContext suspend). 광고 자체 소리와 겹침 방지. |
| 7 | 저장 키 목록 고정, DATA_EPOCH는 목록 키만 삭제 | **수용.** platform/ 밖에서 localStorage 직접 호출이 없는지 검사하는 테스트 추가. |
| 8 | 백그라운드 자동 일시정지 | **앱 빌드(toss/android/ios) = 전투 중 onPause 시 일시정지 팝업 열기.** 웹은 지금대로. |
| - | 300ms 지연 저장 | **수용** + 웹은 `pagehide`에서도 즉시 flush. |

### 11-1. B 후속 판정 (2026-11-08)
- 배너 켜고 끌 때 캔버스 배율이 바뀜 → **배너 자리 상시 확보.** 배너를 쓰는 빌드이고 광고 제거를 안 샀으면, 화면과 상관없이 하단 배너 높이를 항상 레이아웃에서 뺌. 숨기는 화면(타이틀/로딩/문 전환/튜토리얼)에서는 그 자리를 #0d0a10으로 비워 둠. 배율 재계산은 광고 제거 구매 시와 insets 변경 시만. noFill이어도 자리 유지.
- 메뉴↔전투 페이드 중 배너 유지 → **수용.**
- 나가기 모달 "전투를 끝내고 마을로 돌아갈까요?" [마을로/취소] → **수용.**
- (10:24) 쑹: 배너 자리 상시 확보는 보류. C 먼저 진행 후 배너 위치를 다른 곳으로 빼는 안을 함께 검토.
- 토스 닫기: `import { Screen } from "@apps-in-toss/web-framework"; await Screen.close();` (별칭 closeView, 최소 앱 버전 미표기). 자체 종료 버튼·안드 backEvent → 우리 확인 모달 → Screen.close(). 토스 상단 X는 가로채는 API 문서 없음(미확인) → 심사 전 토스 문의. 출처: https://developers-apps-in-toss.toss.im/documentation/sdk/domains-api/screen/screen.close.md

## 12. 프롬프트 C 결과 판정 (2026-11-08)

| # | 내용 | 판정 |
|---|---|---|
| 1 | 타이틀 뒤로가기 = 바로 닫기/종료 | **변경:** 토스·안드로이드 모두 종료 확인 모달 후 종료(토스 체크리스트 "종료 시 확인 모달"). |
| 2 | 지급을 어댑터 결제 흐름 안으로 | **수용**(토스 processProductGrant는 지급 성공 후 true 반환이라 필요). 단 어댑터는 인벤토리를 직접 import하지 말고 게임이 넘긴 `onGrant(productKey, orderId)` 콜백만 호출 → 그 안에서 grant(txId). |
| 3 | 목록에 없는 상품 복구 = products.json 지급만 | **수용.** |
| 4 | 토스 복원 = 미지급 복구 재실행 | **보완:** 미지급 복구만으로는 기기 변경/재설치 시 비소모성(광고 제거, 1회 팩 기록)이 사라짐(토스 Storage는 앱 삭제 시 삭제). `IAP.getCompletedOrRefundedOrders`로 완료 주문을 받아 비소모성만 다시 grant(txId 중복 방지로 안전), 환불 주문은 플래그 회수. 앱 시작 시 1회 + 복원 버튼. |
| 5 | 토스 배너 테마 dark | **수용.** |
| 6 | 리더보드 제출 = 메뉴로 나갈 때 | **보완:** 메뉴 복귀 + 패배 + onPause(앱 이탈) 때, 마지막 제출보다 최고층이 올랐을 때만 제출. 앱을 그냥 닫으면 기록이 안 올라가는 문제 방지. |
| 7 | "토스 랭킹 보기" = 일반모드 내 줄 바로 위 | **수용.** |
| 8 | Android features.iap=false | **수용.** 플러그인은 RevenueCat(@revenuecat/purchases-capacitor) 추천: 영수증 서버 검증·복원·환불 처리를 서버 없이 제공, 매출 일정 규모까지 무료. 대안 cordova-plugin-purchase는 무료지만 검증 서버를 따로 둬야 함. |

## 13. 배너 위치 검토 (2026-11-08)

전제: 캔버스 9:16 고정 + 레터박스. 19.5:9 폰(예: 360×780)은 위아래 여유 ~140px, 안전영역(iOS 상단 ~59, 하단 ~34)과 토스 상단 내비바를 빼면 남는 여유가 크게 줄어듦. 토스 배너는 102px 고정이라 대부분 기기에서 캔버스가 줄어듦(AdMob 적응형 ~50-60px는 들어가는 기기가 많음).

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A | 하단 상시 확보 | 배율 변화 없음 | 토스에선 항상 캔버스 ~5-12% 작음, 숨김 화면엔 빈칸 |
| B | 하단, 화면 따라 켬/끔 (현재) | 쓰는 화면만 작아짐 | 튜토리얼 시작/끝 등에서 배율 깜빡임 |
| C | **장면 전환 페이드 때만 레이아웃 변경** | 배율 변화가 검은 페이드 속에 숨음 | 튜토리얼은 빈 자리로 둬야 함(1층만) |
| D | 상단 배너 | — | 재화바/일시정지·토스 닫기 버튼 근처라 오클릭 위험, 비추천 |
| E | **배너 없이 보상형 광고만** (부활·골드 2배 등) | 레이아웃 손 안 댐, 유저 거부감 적고 단가 높음, 토스 배너 지원 여부 불확실성 회피 | 노출 수 적음 |

추천: **v1은 E**, 배너를 넣는다면 C(타이틀→메뉴 문 전환 페이드 때 슬롯 확보, 메뉴·전투·튜토리얼 모두 같은 슬롯, 튜토리얼에선 광고 대신 빈칸).
- **결정(2026-11-08 쑹): v1 = 보상형 광고만, 배너 없음.** 배너 코드는 caps.banner=false로 꺼 둠(삭제 X). 레이아웃 배너 높이 0. 상점 "광고 제거" 문구는 배너 언급 없이 유지.

---

## 14. 원스토어 추가 (2026-11-08)

마켓이 5개가 됩니다: web / toss / android(Google Play) / **onestore** / ios.
원스토어는 Android 앱이라 **Capacitor 어댑터를 그대로 쓰고 결제 모듈만 바꾼 별도 빌드**로 만듭니다.

### 14-1. 핵심 사실 (출처는 §14-6)

| 항목 | 내용 |
|---|---|
| 결제 의무 | 디지털 상품은 **원스토어 인앱결제(또는 원스토어 외부결제 API)만** 허용. 한 앱에서 원스토어 IAP + 다른 결제 혼용 금지. → Play 결제 코드를 뺀 **별도 빌드 필수**(Play Billing이 들어 있으면 반려되는지는 문서에 명시 없음, 빼는 게 안전). |
| SDK | IAP SDK V21 (API V7), `com.onestorecorp.sdk:sdk-iap:21.04.00`. 저장소는 문서상 2026-04부터 mavenCentral, GitHub README는 repo.onestore.net → 둘 다 넣고 빌드 확인. |
| API 모양 | `PurchaseClient` → `startConnection` → `queryProductDetailsAsync` → `launchPurchaseFlow` → `onPurchasesUpdated` → 소모성은 `consumeAsync`, 비소모성은 `acknowledgeAsync`. **3일 안에 consume/acknowledge 안 하면 자동 환불.** 시작·onResume 때 `queryPurchasesAsync`로 미처리 구매 복구. |
| 플러그인 | **Capacitor/Cordova 플러그인 없음, RevenueCat도 원스토어 미지원(확인 안 됨, 미지원 가정).** → 얇은 Capacitor 네이티브 플러그인(Kotlin)을 직접 작성. |
| 원스토어 서비스 앱 | 기기에 설치돼 있어야 결제 가능. `RESULT_NEED_LOGIN` → `launchLoginFlow`, `RESULT_NEED_UPDATE` → `launchUpdateOrInstallFlow`. Manifest에 `<queries>` 블록 필수. |
| 서버 검증 | 문서는 서버에서 purchaseToken 검증 권장(`iap-apis.onestore.net`, OAuth client_credentials). v1은 서버 없음 → 클라이언트 지급 + txId 중복 방지로 시작, 랭킹 서버(Supabase) 생길 때 검증 추가. |
| 수수료 | 기본 20%. **월 매출 $5,000 이하 소규모 개발자 10%.** 외부결제 5%. (Play는 첫 $1M까지 15%) |
| 등급 | 게임은 **IARC**. Play에서 받은 IARC 인증 ID를 그대로 등록 가능. |
| 서명/패키지 | 같은 패키지명 사용 가능. Play와 같은 서명 키를 쓰려면 원스토어에 "Java keystore에서 키 내보내기 업로드"(PEPK)로 등록. 원스토어가 새 키를 만들게 하면 Play 버전과 키가 달라짐. AAB로 바꾸면 APK로 못 돌아감(APK로 시작해도 됨). |
| 심사 | 상품별 **샌드박스 결제 테스트 완료해야 심사 요청 버튼 활성화.** 가격은 KRW 표시, 앱 안 가격과 일치. 미지급 구매 확인/환불 경로 제공. **다른 마켓 링크 금지**(예: "구글플레이에서 평가하기"). |
| 광고 | AdMob 금지 규정은 못 찾음(금지 콘텐츠 페이지는 읽지 못함). |
| 판매자 | 개인/사업자 모두 가능, 세금 정보 등록 필수. 사업자등록·통신판매업 필요 여부는 미확인(세무 상담 권장). |

### 14-2. 결정 필요

| # | 질문 | 추천 |
|---|---|---|
| O1 | Play와 같은 서명 키를 쓸지 | **같은 키 + 같은 패키지명.** 한 기기에서 마켓을 바꿔도 업데이트가 이어지고, 다른 키면 설치 충돌. 이를 위해 **Play App Signing을 "구글이 키 생성"이 아니라 "내 키 업로드"로 설정**해야 함(Play 첫 업로드 전에 정해야 하는 것!). |
| O2 | 출시 시점 | **Google Play 직후.** IARC 재사용, 같은 Android 빌드에 결제 모듈만 교체. |
| O3 | 원스토어 서비스 앱이 없는 기기 | 상점 현금 탭에 "원스토어 앱 로그인/설치 필요" 안내 + 설치 흐름 호출. 게임 자체는 정상 진행. |

### 14-3. 빌드 구조 변경

- `__PLATFORM__` 값에 `'onestore'` 추가. 어댑터는 `capacitor/`를 같이 쓰고 **`capacitor/iap/` 아래 provider만 교체**: `play.js`(RevenueCat) / `onestore.js`(자체 플러그인).
- Android 프로젝트에 **productFlavors `play` / `onestore`**. onestore flavor에만 sdk-iap 의존성과 `<queries>`, play flavor에만 Play Billing(RevenueCat).
- `config/products.json`의 `ids`에 `onestore` 키 추가.
- `caps`에 `storeLinks: 'play' | 'onestore' | 'appstore' | null` → 평가하기/업데이트 안내 링크는 자기 마켓으로만.
- 스크립트: `npm run build:onestore` → vite (`__PLATFORM__='onestore'`) → `cap sync android` → `./gradlew assembleOnestoreRelease`.

### 14-4. 출시 순서 (수정)

웹 베타 → **Google Play → 원스토어** → 토스 → App Store

### 14-5. 불확실

- Play Billing 코드가 들어 있으면 반려되는지(명시 없음 → 빼는 쪽으로).
- Maven 저장소 위치 두 가지 표기.
- 원스토어 금지 콘텐츠/확률형 상품 규정(페이지 읽기 실패).
- 갤럭시 스토어 동시 배포 여부(원스토어 문서에 없음).

### 14-6. 출처

- 개발자 문서: https://onestore-dev.gitbook.io/dev
- IAP V21 SDK: https://onestore-dev.gitbook.io/dev/tools/billing/v21/sdk.md · 준비: https://onestore-dev.gitbook.io/dev/tools/billing/v21/pre.md · 서버 API: https://onestore-dev.gitbook.io/dev/tools/billing/v21/serverapi.md
- 결제 심사 가이드: https://onestore-dev.gitbook.io/dev/eng/docs/review/one-store-review-guideline/payment.md
- 수수료: https://onestore-dev.gitbook.io/dev/docs/payment/service_fee/korea.md
- 등급: https://onestore-dev.gitbook.io/dev/eng/docs/apps/product/common-info/age-rating.md
- 앱 서명: https://onestore-dev.gitbook.io/dev/eng/docs/apps/product/android/app-signing.md
- 심사 FAQ: https://onestore-dev.gitbook.io/dev/eng/help/faq/review.md
- SDK 저장소: https://github.com/ONE-store/onestore_iap_release

## 15. §12 보완 결과 판정 (2026-11-08)

| # | 내용 | 판정 |
|---|---|---|
| 1 | 환불 시 adFree만 회수(4번째 슬롯은 회수 안 함) | **수용.** |
| 2 | RevenueCat 환불 회수 TODO | **수용(후순위).** 붙일 때: 시작 시 CustomerInfo 권한(entitlement) `ad_free`가 비활성이고 adFree 출처가 IAP(grantedTx `iap:*`)일 때만 회수. |
| 3 | RevenueCat 소모성: 결제 직후 지급 전 앱이 죽으면 복구 불가 | **서버 없이 막기:** 결제 호출 **직전**에 storage에 `pendingPurchase {productKey, startedAt}` 저장(즉시 flush). 시작 시 pending이 있으면 `CustomerInfo.nonSubscriptionTransactions`에서 같은 상품·`purchaseDate >= startedAt`인 거래를 찾아 txId `iap:{key}:{transactionId}`로 grant 후 pending 삭제. 재설치 시엔 pending도 지워지므로 과거 결제 재지급 없음. 웹훅/서버 지급은 서버 생길 때. |
| 4 | 스타터 팩 = 비소모성(재설치 시 내용물 재지급) | **수용.** 재설치하면 로컬 세이브가 사라지므로 재지급이 이득이 아님. 대신 **모든 스토어 콘솔에서 상품 유형을 비소모성으로 통일**해 등록. |
- 쑹 세부값(수용): 시계 오차 여유 5분(startedAt-5분 이후 거래까지), 못 찾으면 pending 24시간 보관 후 삭제. 보완: 사용자가 결제를 **취소했거나 스토어가 명확히 실패를 반환하면 pending 즉시 삭제**. 같은 상품을 여러 번 연속 구매하면 pending을 상품별 1개가 아니라 목록으로 보관.

## 16. 프롬프트 D 결과 판정 (2026-11-08)

| # | 내용 | 판정 |
|---|---|---|
| 1 | flavor별 capacitor.plugins.json 사본을 Gradle이 덮어씀 | **수용.** 확인 추가: onestore APK에 `com.revenuecat`·`com.android.billingclient` 클래스가 없는지, play APK 목록에 OneStoreIap가 없는지 빌드 후 자동 검사(Gradle task 또는 스크립트). |
| 2 | 원스토어 저장소를 `com.onestorecorp.sdk` 그룹만 받게 제한 | **수용.** |
| 3 | 라이선스 키(base64 공개키)를 JS에서 connect로 전달 | **수용**(공개키라 앱에 들어가도 됨). 서버 API용 client_secret은 절대 앱/저장소에 넣지 않음. |
| 4 | 로그인 전에도 현금 탭 표시 + 토스트 | **수용.** 단 구매 버튼을 누르면 토스트만 띄우지 말고 `launchLogin` 흐름까지 호출. |
| 5 | 시작 시 비소모성 자동 복원, 복원 버튼 없음 | **수용**(Android). iOS는 복원 버튼 필수 유지. |
| 6 | 원스토어 환불 회수 없음 | **수용**(서버 검증 때 처리). |
| 7 | developerPayload = productKey | **수용.** |
| 8 | storeLinks 값만, 링크 UI 없음 | **수용.** |
| 9 | JDK 21 경로 필요 | 저장소에 개인 경로를 넣지 말고 **사용자 홈의 `~/.gradle/gradle.properties`에 `org.gradle.java.home=...`** 지정. docs에 한 줄 안내. |
| - | play/onestore가 같은 public 폴더 공유 | **안전장치 추가:** vite 빌드가 `public/platform.txt`(예: `onestore`)를 쓰고, 각 flavor의 preBuild task가 값이 자기 flavor와 다르면 빌드 실패. Android Studio에서 바로 빌드해도 잘못된 JS가 들어가지 않음. |

## 17. 웹 배포 (Cloudflare Pages, 2026-11-13)

### 17-1. Pages 설정값 (대시보드)
| 항목 | 값 |
|---|---|
| 프레임워크 프리셋 | None |
| 빌드 명령 | `npm run build:web` (vite build + `tools/check-bundle-secrets.mjs` - 비밀 키가 섞이면 실패) |
| 출력 디렉터리 | `dist` |
| 루트 디렉터리 | (비움 = 저장소 루트) |
| 환경 변수 | `NODE_VERSION=22` 하나. Supabase URL·anon 키는 `config/server.json`(공개값)에서 읽으므로 환경 변수 아님. |

- 본 주소: `https://gem-guardians.pages.dev`
- 미리보기: PR·브랜치마다 `https://<커밋해시 또는 브랜치>.gem-guardians.pages.dev` (서버 CORS 허용 목록에 이미 포함)
- 롤백: 대시보드 → Workers & Pages → gem-guardians → Deployments → 이전 배포의 `...` → **Rollback to this deployment**. 재빌드 없이 바로 바뀐다.

### 17-2. 웹 빌드에만 들어가는 것
- `public/` 전체(`_headers`, `manifest.webmanifest`, `sw.js`, `icons/`)를 `vite.config.js`가 **웹 빌드에서만** dist로 복사한다. 토스·Capacitor 빌드에는 없다.
- `_headers`: `/_app/*`(해시 붙은 JS/CSS) = 1년 immutable, `/`·`index.html`·`sw.js`·`manifest.webmanifest` = no-cache. `assets/`·`config/`는 Pages 기본값(매번 재검증).
- 서비스 워커(`public/sw.js`, 등록은 `src/boot.js`): 웹 프로덕션 빌드에서만 등록. 빌드마다 내용 해시로 캐시 이름이 바뀐다. 앱 뼈대(index·`_app`·config)는 설치 때 받고, `assets/`는 처음 쓸 때 캐시. `skipWaiting` 없음 = 새 버전은 열린 탭을 모두 닫은 **다음 실행**에 적용(게임 중 새로고침 없음).
- 설정 화면 맨 아래 "브라우저 데이터를 지우면 진행 상황이 사라져요"(§3-1).

### 17-3. 공개 빌드 안전장치
- `?dev=1`(가짜 결제·광고, 개발 패널, `window.__gg`, 서버 덮어쓰기)과 `?sfxtest`는 `DEV_ALLOWED`(`src/platform/index.js`) = `!import.meta.env.PROD`일 때만. **vite build 결과물(웹·토스·Capacitor 모두)에서는 URL로 켤 수 없고 코드 자체가 빠진다.** vite dev·`serve.py`에서는 그대로 동작.
- 웹 어댑터 caps: iap·ads·rewarded·banner 모두 false → 현금 상품 안 보임.

### 17-4. 서버 CORS
- 허용 목록은 `server/supabase/functions/_shared/cors.ts` 한 곳. Pages 본·미리보기, localhost:5173/4173, serve.py(localhost·127.0.0.1:8000), Capacitor(`https://localhost`, `capacitor://localhost`), 토스(`*.apps|private-apps|web|private-web.tossmini.com`).
- 목록 밖 origin(예: LAN IP, trycloudflare 터널)에서는 브라우저가 서버 호출을 막는다 - 서버 기능만 꺼지고 게임은 돈다.
- 배포: `npx supabase functions deploy --project-ref jzpjqfbpqzghprqbqexp` (GemGuardians, 서울).
