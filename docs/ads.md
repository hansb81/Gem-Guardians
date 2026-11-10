# 광고 계획 v1 - 구글플레이 내부 테스트용 (2026-11-10)

쑹 요청: (1) 패배 시 **광고 보고 이어하기** (전체 화면, 10초 이내 광고만), (2) 메인 메뉴 **이벤트 팝업 안에 배너**.
코드 현황(저장소 확인): `src/platform/capacitor/index.js`에 AdMob(`@capacitor-community/admob`) 보상형·전면·하단 배너가 이미 있고, 게임 쪽 입구는 `src/game/ads.js`(광고 중 BGM·SFX 끔). 아직 게임 코드 어디서도 광고를 부르지 않음. `config/platform.android.json` = Google 테스트 id, `features.rewarded:true`, `features.banner:false`.

---

## 1. "10초 이내 광고만" - AdMob에서 되는 것과 안 되는 것

**결론: AdMob은 광고 길이로 거를 수 없습니다.** 광고 단위에 "최대 N초" 설정은 없고, 광고주 소재 길이에 따라 다릅니다. 조절할 수 있는 건 **"몇 초 뒤에 닫을 수 있나"(스킵 시간)** 뿐입니다.

| 설정 (AdMob 앱 설정 > "고참여 광고 / High-engagement ads") | 켜짐(기본값) | **끔** |
|---|---|---|
| 전면(interstitial) | 늦어도 12초 뒤 닫기 가능 | **늦어도 5초 뒤 닫기 가능** |
| 보상형(rewarded) | 늦어도 60초 뒤 보상+닫기 | **늦어도 30초 뒤 보상+닫기** |

- 보상형은 "스킵 시간에 닿으면 보상 지급"이라, 끄면 **최대 30초 안에는 무조건 이어하기 가능**.
- 보상형 광고 단위 고급 설정에서 **"광고 2개 연속(ad pods)" 끄기**, (선택) 인터랙티브 광고 제외 가능 → 길어지는 경우를 줄임.

### 왜 "전면 광고"로 이어하기를 주면 안 되나
"광고 보면 이어하기" = 보상입니다. AdMob 정책상 **보상은 보상형 광고 단위로만** 줄 수 있고, 전면 광고를 보상과 묶으면 정책 위반(광고 게재 제한·계정 정지 위험)입니다. 그래서 전면 광고(5초 스킵)로 10초 조건을 맞추는 길은 막혀 있습니다.

### 추천: 보상형 광고(전체 화면) + 고참여 광고 OFF + ad pods OFF
- 화면은 전체 화면 동영상이라 쑹이 말한 "전체 광고"와 같아 보입니다.
- 실제 길이: 대부분 15~30초, **최대 30초 보장**. "10초 이내"는 보장 못 함 → 버튼 문구는 "광고 보고 이어하기"로 하고 초 수는 적지 않음(상점 무료 아이템 문구 "15~30초"와 맞춤).
- 내부 테스트 동안은 **테스트 광고 id**라 Google 샘플 광고만 나옴(길이 짧음). 실제 길이는 실계정 붙인 뒤에야 확인 가능.
- 대안(비추천): 보상형 전면(rewarded interstitial) - 시작 전 안내 화면+취소 필수, 스킵 가능한 광고만 나옴. 패배 팝업에서 "직접 누르는" 흐름엔 일반 보상형이 더 단순.

## 2. 패배 → 광고 보고 이어하기

**효과 = 불사조 깃털과 동일**: 성벽 HP 50% + 모든 적 2초 정지(보스 x0.5). `battleState.revive(pct, freezeSec, bossMul)` 재사용, 값은 `config/items.json` revive에서 읽음.

**횟수(추천, config로 조절)**
- **층당 이어하기 1회 공유** - 깃털이든 광고든 한 층에 한 번. (둘 다 따로 주면 깃털 50다이아 가치가 사라짐)
- 광고 이어하기 **하루 5회** 상한(KST 0시 리셋, 로컬 저장). 내부 테스트 중엔 넉넉히.
- **광고 제거 구매자**: 광고 없이 바로 이어하기("무료 이어하기") - 기존 규칙 "무료 아이템 광고 없이"와 같은 방식. 횟수 규칙은 같음.

**패배 팝업 버튼**
```
[ 부활 (깃털 n) ]      ← 깃털 보유 + 이번 층 미사용일 때만 (지금 그대로)
[ ▶ 광고 보고 이어하기 ] ← 광고 가능 + 이번 층 미사용 + 오늘 남은 횟수 > 0
[ 재도전 ]
```
- 누르면: 버튼 "불러오는 중…" (8초 타임아웃) → 광고 → **보상 이벤트 받았을 때만** revive. 중간에 닫으면 아무 일 없이 팝업 그대로.
- 실패/noFill: 토스트 "광고를 불러오지 못했어요" + 버튼 잠깐 비활성. 깃털·재도전은 그대로.
- 광고 중: 전투 시간 정지(이미 failed 상태라 진행 없음), BGM·SFX 끔(`src/game/ads.js`), 앱 pause 이벤트로 일시정지 팝업이 뜨지 않게.
- **미리 불러오기**: 지금 코드는 show 직전 prepare(늦게 뜸). 층 시작 시 보상형 1개 미리 load, 쓰고 나면 다음 것 load.
- 튜토리얼 중엔 버튼 숨김. **경쟁 모드는 광고 이어하기·깃털 부활 둘 다 없음**(랭킹 공정성, 쑹 확정 2026-11-10).

**마켓별**
| 빌드 | 동작 |
|---|---|
| android(play)·onestore | AdMob 보상형 |
| dev | 가짜 광고(2초 검은 화면 "TEST AD") → 보상. 브라우저 테스트용 |
| web | 버튼 숨김(caps.rewarded=false) |
| toss | 지금은 숨김. 토스 보상형(`loadFullScreenAd/showFullScreenAd`)은 사업자등록 후 연결 |

## 3. 이벤트 팝업 배너

**이전 결정(2026-11-08 "하단 배너 없음")과 충돌하지 않음** - 하단 고정 배너가 아니라 이벤트 팝업이 열려 있을 때만 뜨는 배너. 단 코드는 **하단 배너(`caps.banner`, `#banner-slot`)와 완전히 분리**해야 함. `features.banner`를 켜면 main.js가 하단 자리를 비워 버리므로, 새 스위치 `features.popupBanner`를 씀.

### AdMob 정책상 지킬 것
- 배너가 **앱 콘텐츠 위에 떠 있거나 움직이면 안 됨**, **버튼 바로 옆 금지**(오클릭 유도). → 팝업 안에 "광고 칸"을 따로 그리고 그 칸 안에만 띄움. 닫기 버튼·다른 버튼과 최소 간격 확보.
- **콘텐츠 없는 화면에 광고만** 있으면 위험 → 지금 이벤트 팝업은 빈 placeholder라, 최소한 이벤트 안내 문구(예: "새 이벤트 준비 중이에요")를 위에 두고 배너는 아래 칸.
- 광고는 콘텐츠와 구분돼야 함 → 칸 위에 작은 "광고" 라벨, 칸 테두리. "이벤트" 보상처럼 보이게 하지 않기.
- 팝업 열고 닫을 때만 show/hide, 스크롤·애니메이션으로 위치 바뀌지 않게.
- (참고: Google 포럼에서 모달 위 배너는 "보이게 두거나 숨기는 것 둘 다 괜찮다"는 SDK팀 답변만 있고 공식 정책 문구는 없음 → 위 규칙으로 안전하게.)

### 크기·위치
- 표준 배너 **320x50dp** (가장 단순, 적응형보다 위치 계산 쉬움).
- 캔버스 기준(540x960 basis)으로 360dp 폰에서 320dp = basis 약 480 → 이벤트 팝업 폭 400 → **500**으로 넓히고 높이 늘려 아래 광고 칸(basis 480x75 + 라벨) 확보. 칸 크기는 실제 화면 배율로 계산해 320x50dp가 들어가게.
- 화면이 너무 작아(캔버스 CSS 폭 < 340dp) 안 들어가면 배너 안 띄우고 칸에 "광고" 빈칸만.
- AdMob 배너는 WebView 위에 뜨는 **네이티브 뷰** → 팝업 칸의 화면 좌표(CSS px = dp)를 계산해 `position: TOP_CENTER, margin: 칸 top`으로 띄움. 플러그인 margin 동작은 Claude Code가 플러그인 소스로 확인.
- 숨겨야 할 때: 팝업 닫힘, 다른 팝업/화면 전환, 앱 백그라운드, 광고 제거 보유자(안 띄움), 창 크기 바뀜(다시 계산).

**마켓별**: android/onestore = AdMob 배너. dev = 칸에 "TEST BANNER 320x50" 회색 박스. web = 빈 칸 없이 기존 placeholder 문구만. **toss = 사용 안 함**(토스는 팝업 위 광고 금지 - platform-plan §5).

## 4. 지금(내부 테스트) vs 실계정 전환 때 할 일

**지금**: 테스트 id 그대로(`ca-app-pub-3940256099942544/5224354917` 보상형, `/6300978111` 배너), `testing:true`. 내부 테스터에게도 테스트 광고만 나와 안전.

**비공개 테스트에서 실광고 id로 돌릴 때** (2026-11-10 준비)
- 코드: `config/platform.android.json` `admob.testDevices`(기기 id 배열)가 있으면 `initialize({initializeForTesting:true, testingDevices})` → 그 폰은 실 id여도 테스트 광고만. 기기 id는 앱 한 번 실행 후 logcat `setTestDeviceIds(Arrays.asList("...")`에 찍힌다. AdMob 콘솔 설정 > 테스트 기기에 등록해도 같음(코드 수정 없이 가능).
- `testing:false`로 바꾸면 이벤트 팝업 분홍 테두리가 안 그려진다 → 배너 위치 확인은 테스트 id(`testing:true`) 빌드로 먼저.
- 순서: 아래 1~3, 6 → Play 비공개 테스트 트랙 업로드. 4(UMP)는 EEA 테스터가 없으면 나중에 해도 광고는 나옴. 5(app-ads.txt)는 없어도 서빙은 되지만 경고·수익 감소.

**실 AdMob 계정 붙일 때** (사업자등록과 별개로 개인도 가입 가능, 지급엔 세금 정보 필요)
1. AdMob 가입 → 앱 추가(Play에 등록된 `com.teamsdb.gemguardians` 연결) → **앱 id**를 AndroidManifest `APPLICATION_ID`에.
2. 광고 단위 2개: 보상형 `revive_continue`, 배너 `event_popup`. 보상형 리워드 설정은 수량 1, 상품 `continue`(코드는 보상 수량·이름을 안 읽고 '보상 받음'만 본다). ad pods 메뉴는 콘솔에 없었음(2026-11-10) - 건너뜀. 서버측 확인(SSV 콜백 URL)은 비워 둠 - 이어하기는 기기에서만 판정하고 서버 SSV(`_shared/ads.ts`)는 배치가 없어 안 씀. 앱 설정에서 **고참여 광고 끔**.
3. `config/platform.android.json` id 교체 + `testing:false`. **본인 폰은 AdMob 테스트 기기로 등록**(실광고 본인 클릭 = 무효 트래픽, 계정 정지 사유).
4. 개인정보 및 메시지 > **GDPR 동의 메시지(UMP)** 만들기(코드는 이미 requestConsentInfo 있음).
5. `app-ads.txt`를 개발자 웹사이트 루트에(웹 베타 도메인).
6. Play Console: "광고 포함" 예, 데이터 보안에 광고 ID 수집 표시, 개인정보처리방침에 AdMob 명시.
7. 원스토어도 같은 AdMob 앱 id 써도 되는지는 그때 확인(별도 앱 등록 권장 가능성).

## 5. 결정 (쑹 2026-11-10)
- 층당 1회 공유(깃털·광고) / 광고 하루 5회 - 확정.
- 경쟁 모드: 광고 이어하기 없음, 깃털 부활도 없음 - 확정(`adContinue.competitive:false`).
- 이벤트 팝업 문구: 미정. 넣을 곳 = `src/config/locales/ko.js`·`en.js`의 `menu.event`(title·body).

---

## 6. 구현 (2026-11-10, 내부 테스트)

### 규칙 (config/items.json `adContinue`)
`{ enabled: true, dailyCap: 5, sharePerFloorWithRevive: true, competitive: false, loadTimeoutMs: 8000 }`
- 판정은 `src/game/adContinue.js` `continueOptions` 하나(깃털·광고 버튼 둘 다). 테스트 `tests/adContinue.test.js`, `tests/items2.test.js`.
- 효과 = `items.revive`의 pct/freezeSec/bossMul로 `battleState.revive()`. 깃털 차감 없음(`ItemController.continueFree`).
- 층당 1회 공유 = ItemController `_usesThisFloor.revive` 같은 칸 → `resetFloor()`(층 전환·재도전)에서 같이 리셋.
- 하루 dailyCap: 저장 키 `adContinue` = `{ day(KST 일 번호), count }`, `storage.js` KEYS에 등록(DATA_EPOCH 초기화 대상).
- 광고 제거(`adFree`) 보유자: 광고 없이 "무료 이어하기", 횟수 규칙 같음.
- 튜토리얼 중 광고 버튼 숨김. **경쟁 모드는 깃털·광고 둘 다 없이 바로 종료**(`competitive:false`). 경쟁 모드는 아직 잠김이라 main.js는 `mode:'normal'`을 넘긴다 - 열 때 그 판 모드로 바꾼다.
- 패배 팝업 버튼은 세로로: [부활] / [▶ 광고 보고 이어하기] / [다시 하기]. 누르면 "불러오는 중…"(반투명, 터치 안 됨) → 실패면 팝업 설명 줄이 2초간 "광고를 불러오지 못했어요"(전투 토스트는 팝업 딤 아래라 안 보여서 팝업 안에 띄움).
- **광고가 닫힌 뒤** 보상 받았을 때만 부활. 광고 중엔 `adBusy`라 연타 무시, 앱 pause 때 일시정지 팝업 안 띄움.

### 어댑터
| 빌드 | 보상형 이어하기 | 이벤트 팝업 배너 |
|---|---|---|
| android(play)·onestore | AdMob. AdMob 준비 직후 1개 미리 load, show 뒤 다음 것 load. 결과는 리스너 기준 | AdMob 320x50 `BANNER`, `TOP_CENTER` |
| dev(`?dev=1`) | 2초 검은 화면 "TEST AD" → 보상. `?adfail=1` 못 띄움(문구), `?adclose=1` 중간 닫기(아무 일 없음) | 칸 위치에 회색 div "TEST BANNER 320x50" |
| web | 숨김(caps.rewarded=false) | 칸 없이 안내 문구만 |
| toss | 숨김(`platform.toss.json` rewarded:false - 사업자등록 뒤 켬, 켜면 기존 fullScreen rewarded) | 사용 안 함(팝업 위 광고 금지) |
| ios | `platform.ios.json` 그대로(rewarded:true) | popupBanner 없음 → 꺼짐 |

### 플러그인 사실 (@capacitor-community/admob 8.3.0, Android 소스 확인)
- `showRewardVideoAd()`는 **보상을 받았을 때만 resolve**, 중간에 닫으면 promise가 끝나지 않는다 → `Rewarded`는 플래그만, `Dismissed`/`FailedToShow`로 끝냄, 리스너는 매번 remove, 안전 타임아웃 90초.
- **margin은 위·아래 여백에 둘 다 들어간다** → 2*margin+높이 > 화면이면 배너 높이 0(실기기 2026-11-10). 칸이 아래 절반이면 BOTTOM_CENTER(margin = 화면 높이 - 칸 아래끝).
- `showBanner` margin 단위 = **dp**(x density) = WebView CSS px. `TOP_CENTER`면 플러그인이 남은 safe-area top을 **더한다** → margin = 칸 y - `layout.getInsets().top`.
- 배너는 **1개만**(`mAdView` 하나). 이미 있으면 `showBanner`는 광고만 다시 불러오고 position/margin은 무시 → 위치를 바꾸려면 `removeBanner` → `showBanner`. 팝업 열 때마다 remove→show.
- **가드**: 하단 배너(`features.banner`)가 켜지면 `caps.popupBanner`를 끈다(한 개 배너를 두 곳이 같이 쓰지 않게).

### 이벤트 팝업 배너
- 팝업 520x640 basis(폭 = 360dp 폰에서 320dp = basis 480 + 여백이 들어가게). 위는 이벤트 배너 목록(`mainMenuScreen.events`, 줄 110 basis, 보기 영역 안에서 드래그·휠 스크롤), 광고 칸은 카드 아래에 고정 - 스크롤해도 배너 좌표 안 바뀜. 이벤트 없으면 목록 자리에 `menu.event.body`. "광고" 라벨 + `panel_inset` 칸, 칸 = 320x50 CSS px + 여백 4. 닫기 버튼과 100 basis 이상 떨어짐, 칸 옆 버튼 없음.
- 좌표 계산은 `MainMenuScreen.adBannerCss(canvas)` 한 곳. 칸이 배너보다 작거나, 화면 밖이거나, 캔버스 CSS 폭 < 340이면 배너 없이 빈 칸.
- show/hide는 main.js `syncPopupBanner()`가 매 프레임 "띄울 위치"를 구해 바뀔 때만 부른다: 열림 = show, 닫힘·다른 팝업·씬 전환·백그라운드 = hide, 복귀·resize = 다시 계산. 팝업 애니메이션은 없음(열리자마자 show).
- 테스트 광고(`admob.testing:true`, dev)면 칸 가운데에 배너 목표 위치 테두리(분홍)를 그린다 → 실기기에서 네이티브 배너가 이 테두리에 딱 맞는지 눈으로 비교(노치 폰 포함).

### 실기기 확인 (2026-11-10, 실광고 id + 테스트 기기)
- 완료: 보상형 "테스트 광고" 라벨 → 리워드 지급 → 닫으면 부활. 이벤트 팝업 배너가 칸에 맞게 뜨고(BOTTOM_CENTER margin 178), 누르면 Chrome으로 열림. 360dp급 1대(1080x2400, density 450)만 확인.
- 보상형이 "광고 1/2"처럼 2개 연속 나옴(ad pods) - 콘솔에서 끄는 메뉴를 못 찾음.

### 실기기 확인 - 남은 것
- 테스트 보상형 끝까지 보기 → 부활 / 중간 닫기 → 팝업 그대로 / 홈 갔다 오기.
- 이벤트 팝업 배너가 분홍 테두리와 맞는지: 360dp 폰, 큰 폰, 노치 폰. 어긋나면 상태바 높이만큼인지 먼저 볼 것(safe-area 처리).

## 출처
- 고참여 광고 설정: https://support.google.com/admob/answer/15525707
- 보상형 광고 개요(닫기 5~30초, ad pods): https://support.google.com/admob/answer/7372450
- 보상 제공 광고 정책: https://support.google.com/admob/answer/7313578
- 보상형 전면: https://support.google.com/admob/answer/9884467
- 배너 비권장 구현: https://support.google.com/admob/answer/6275345
- 모달 위 배너(SDK 포럼): https://groups.google.com/g/google-admob-ads-sdk/c/GFJkydU_kAQ
