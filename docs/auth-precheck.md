# 로그인·클라우드 저장 사전 점검 (docs/auth.md 가정 vs 실제 코드)

> 2026-11-13 · main 작업 트리 기준. 게임·서버 코드·설정은 고치지 않았고 서버에는 아무것도 배포하지 않았다.
> 측정 스크립트: `node tools/auth-precheck/measure-save.mjs`(크기), `node tools/auth-precheck/count-saves.mjs`(1~10층 save 호출 수).

## 요약

1. **save 크기**(업로드 모양 = save.v2 + adContinue, JSON / gzip): 새 플레이어 **1.9KB / 0.7KB**, 1년 **31.3KB / 5.2KB**, 2년 **56.2KB / 8.7KB**. 90일 정리 후 1년 **15.0KB / 3.0KB**, 2년 **18.2KB / 3.6KB**. 기획(49KB·90KB, 정리 후 20~30KB)보다 작다. 정리 후에도 완전히 멈추지는 않고 1년에 약 3KB씩 는다(rank·mail·coupon·iap).
2. **하루에 쌓이는 txId**: 지금 코드로 매일 접속하면 **무과금 2.1개, 월간 패스 구매자 3.3개**(출석 1 + 매일 무료 1 + 패스 1 + 주 1회 시즌·우편). 기획의 약 5개는 광고 상자가 들어간 경우다. 광고 보상은 `AD_PLACEMENTS`가 비어 있어서 아직 0개이고, 하루 3회로 열면 6.3개가 된다.
3. **월 서버 호출(DAU 1,000, 하루 2번 접속)**: 지금도 **약 30만~60만 회**다(시작할 때마다 4회 + 랭킹·출석·우편). 클라우드 저장(save-get 2 + 업로드 10~25/일)을 더하면 **약 66만~141만 회로 무료 50만 회를 넘는다.** 기획은 기존 호출을 "+ 기존 호출" 한 줄로만 적었다.
4. **DB 용량(1만 명 × save 1 + 백업 3)**: 로컬 DB를 못 띄워서(Docker 없음) 직접 재지 못했다. gzip×1.5~2로 근사하면 90일 정리를 할 때 최악(전원 2년차) **약 170~290MB**, 정리를 안 하면 **약 520~700MB로 500MB를 넘는다**. 그래서 정리는 필수다.
5. **라이브러리**: supabase-js·auth-js **2.119.0**. `linkIdentity`는 ID 토큰 방식을 **지원한다**(`SignInWithIdTokenCredentials`에 `token`, `access_token?`, `nonce?`가 있음). `identity_already_exists` 오류 코드도 타입에 정의돼 있다. `@capgo/capacitor-social-login`은 **8.1.0~8.7.9(최신)**가 `@capacitor/core >=8.0.0`을 요구하므로 Capacitor 8과 맞는다.

> ⚠ **Supabase 프로젝트 id: `jzpjqfbpqzghprqbqexp`가 맞다(쑹 확인 2026-11-13).** 앱이 붙는 곳(`config/server.json` url)과 같다. `docs/auth.md` §7-1·§7-2에 적힌 `zgzwnsvuidydiyavlpyf`는 오타이므로 고쳐야 한다. 리디렉션 URI는 `https://jzpjqfbpqzghprqbqexp.supabase.co/auth/v1/callback`이다.

---

## 1. 저장 키 전수

`initStorage`는 `KEYS`에 있는 키만 캐시에 읽는다. KEYS에 없는 키를 `storage.save`로 쓰면 저장은 되지만 다음 실행 때 읽히지 않는다.

| 키 | 쓰는 파일 | 값 모양 | KEYS에 있나 | 제안 |
|---|---|---|---|---|
| `gemGuardians.save.v2` | src/game/playerState.js | save 객체(2번) | ✓ | §1-B 통째 |
| **`gemGuardians.save.v1`** | playerState.js(읽기만, LEGACY_KEYS) | 옛 save | ✓ | 기기만. 마이그레이션 원본이라 올리지 않음 |
| `sfxVolume`, `bgmVolume` | src/audio/AudioManager.js | 0~1 숫자 | ✓ | §1-C |
| `muted` | AudioManager.js | bool | ✓ | §1-C |
| `haptics` | src/platform/haptics.js | bool | ✓ | §1-C |
| `guardianFx` | src/render/guardianFx.js | bool | ✓ | §1-C |
| **`locale`** | src/main.js:37(읽기), src/render/mainMenuScreen.js:1148(쓰기) | `'ko'`/`'en'` | **✗** | §1-C. **KEYS에 없어서 다음 실행 때 읽히지 않는다. 언어가 매번 ko로 돌아가는 기존 버그로 보인다**(이번엔 고치지 않음) |
| `leaderboardSubmitted` | src/main.js:123,127 | 숫자(층) | ✓ | §1-C |
| `devServer` | src/game/serverUi.js | bool | ✓ | §1-C |
| `devCheats` | src/game/devPanel.js | bool | ✓ | §1-C |
| `pendingVerify` | src/shop/iap.js | `[{store, productKey, orderId, bundle}]` | ✓ | §1-C |
| `adContinue` | src/main.js:1230,1250 | `{day, count}` | ✓ | 기획대로 §1-B(save 안으로) |
| `dataEpoch` | src/platform/storage.js(backend 직접) | `'1'` | ✗(의도) | §1-C |
| `gemGuardians.auth` | src/net/api.js(supabase가 platform.storage 직접) | 세션 JSON | ✗(의도) | §1-C. 절대 올리지 않음 |
| `pendingPurchases` | src/platform/capacitor/iap/play.js(Preferences 직접) | `[{id, productKey, startedAt}]` | ✗(의도) | §1-C |
| **`platformUserId`** | src/platform/web/index.js(localStorage 직접, capacitor도 같은 코드) | UUID 문자열 | ✗(의도) | §1-C. 기획이 새로 만들려는 `deviceId`를 **이 값으로 대신할 수 있다** |

- `sessionStorage` 쓰는 곳 없음. 토스 어댑터는 `Storage`(토스 SDK)를 platform.storage로만 쓰고 따로 쓰는 키는 없다.
- 기획 §1-C 표에 없는 키: **`gemGuardians.save.v1`, `platformUserId`**. 그리고 `locale`은 표에는 있지만 KEYS에 빠져 있다.

## 2. save 블록 실제 모양

`playerState.save()`(src/game/playerState.js:52)가 쓰는 객체는 이렇다.

| 필드 | 타입 | 늘어나나 |
|---|---|---|
| `saveVersion` | 숫자(3) | |
| `gold`, `diamonds`, `floor`, `bestFloor` | 숫자 | |
| `towerLevels` | 숫자[5] | 고정 |
| `shop` | 객체(아래) | |
| `inv` | 객체(아래) | **grantedTx** |
| `ranking` | 객체(아래) | 상한 있음 |
| `tutorial` | `{done, version}` | |

**inv** (src/core/inventory/inventory.js `defaultInv`)
| 필드 | 타입 | 상한 |
|---|---|---|
| `items` | `{id: 개수}` | 종류 = config 아이템 수(지금 16), 개수 ≤ `ITEM_CAP` 999. 모르는 id도 보존 |
| `loadout.hotbar` | (id\|null)[4] | 고정 4 |
| `loadout.pendingHotbar` | 배열[4] \| null | |
| `loadout.preFloor` | `{id: bool}` | preFloor 아이템 수(3) |
| `loadout.totems` | 배열 | 정령 장착(아직 기능 없음, 자리만) |
| `perm.skills` | `{key: 0~5}` | 젬 스킬 9개 |
| `perm.flags` | 문자열[] | `slot4`, `adFree` |
| `perm.totems` | 객체 | 정령 보유(자리만) |
| **`grantedTx`** | 문자열[] | **상한 없음. 계속 쌓인다** |
| `log` | `{t, src, d, tx?}`[] | `LOG_MAX` = **50**(normalizeInv·_commit 둘 다 자름) |
| `seenItems` | 문자열[] | 아이템 종류 수 |

**shop** (src/core/shop/shop.js `defaultShopSave`, `skillLv`는 저장에서 빠짐): `purchasedOnce[]`(1회 상품 id), `firstBuyUsed[]`(다이아 묶음 index ≤ 6), `passes{weekly,monthly:{daysLeft, claimedToday}}`, `freeClaimedDate`, `day`, `offers{starter: ms, boss:{floor, expiresAt}}`. 계속 늘어나는 필드는 없다. `purchasedOnce`는 `pack.boss.{층}`까지 쳐도 몇십 개다.

**ranking** (src/ranking/rankingSave.js): `profile{playerId, nickname, statue}`, `normal{bestFloor, reachedAt}`, `comp{seasonId, best{points, floor, at}, runs, pending|null, history[]}`, `lastTab`. `history`는 normalizeRanking에서 `slice(0, 8)`로 **최대 8**이다(config/ranking.json historyMax 8과 같음).

**save 밖에 진행 데이터가 있나**: 없다.
- 정령 = `inv.loadout.totems`·`inv.perm.totems`(save 안, 아직 빈 값)
- 수호자(석상) 레벨 = `towerLevels`(save 안)
- 레벨 FX는 `guardianFx` 켜기/끄기 설정뿐이라 기기 취향이다(§1-C)
- save 밖 진행 데이터는 `adContinue` 하나이고, 기획대로 save 안으로 옮기면 된다.

## 3. txId 형식과 하루 개수

| 형식 예시 | 어디서 | 한 사람이 받는 횟수 | 날짜 있나 |
|---|---|---|---|
| `start:hammer`(15개) | playerState.initItems | 평생 1번(아이템마다) | ✗ |
| `unlock:defuse` | playerState.initItems | 평생 1번(21층) | ✗ |
| `tutorial_complete` | src/tutorial/tutorial.js | 평생 1번 | ✗ |
| `boss:10` … `boss:90` | battleController._grantFirstClearItems | 보스층 첫 클리어마다(최대 9~10) | ✗ |
| `free:2026-11-13` | shop.js buyProduct `free` | 하루 1번 | ✓(기기 날짜 `localDay`) |
| `pass:monthly:2026-11-13`, `pass:weekly:…` | shop.js `passClaim` | 패스 기간 중 하루 1번(팩마다) | ✓ |
| `iap:dia.3:GPA.3312-…` | iap-verify / s2·s3 마이그레이션 `'iap:'‖key‖':'‖order`, shopScreen.grantPaid | 결제마다 | ✗ |
| `refund:iap:pack.adfree:{주문}` | shop.js revokePaidProduct | 환불마다(드묾) | ✗ |
| `att:2026-11-13` | 마이그레이션 s1 `att_claim` `'att:'‖to_char(KST날짜)` | 하루 1번 | ✓(KST) |
| `mail:123` | s1 `mail_claim` | 우편마다(운영 빈도) | ✗ |
| `coupon:{campaign}` | coupons 마이그레이션 | 캠페인마다 1번 | ✗ |
| `rank:2026-W46` | s4 `rank_claim`, rankingService.claim | 주 1번(지금은 `rewardsEnabled:false`, `compUnlocked:false`라 0) | 주 번호(날짜 아님) |
| `ad:chest:2026-11-13:1` | s4 `ad_claim` `'ad:'‖배치‖':'‖날짜‖':'‖n` | 배치×하루 한도 | ✓ — **`AD_PLACEMENTS = {}`라 지금은 0** |

- 서버 `claims-pending`은 위 서버 txId(`att`, `mail`, `coupon`, `rank`, `ad`)를 그대로 내려 줄 뿐 새 형식을 만들지 않는다.
- **`free:`와 `pass:`는 기기 전용이다.** 서버 `claims`에 없다(claims.kind 주석에는 free|pass가 있지만 쓰는 코드가 없다). 기획 §1-E의 "서버 claims PK가 중복을 막는다"는 `att:`·`ad:`에만 맞다. 다만 free·pass는 `today`로만 만들고 과거 날짜로는 다시 받을 수 없으니, 90일 지난 것을 지워도 안전한 건 같다(기기 시계를 90일 넘게 되돌리는 경우만 예외).
- **하루 평균**(매일 접속)

| 플레이어 | 하루 |
|---|---|
| 무과금: 출석 1 + 무료 1 + 우편 주 1 | 2.1 |
| 월간 패스 계속 구매: + 패스 1 + 시즌 보상 주 1(열리면) | 3.3 |
| + 주간 패스도 | 4.3 |
| + 광고 상자 하루 3회(배치를 정하면) | 6.3 |

  기획의 ~5개는 주간·월간 패스와 광고를 다 넣은 쪽에 가깝다.
- **grantedTx를 지우는 코드**: 없다. `expandStartTx`가 옛 `'start'` 한 줄을 `start:{id}`로 바꾸는 것과 dev 전용 `devRevertSaveToV1`이 버리는 것뿐이다.

## 4. 크기 측정 (tools/auth-precheck/measure-save.mjs)

**방법**
- `playerState.js`를 Node에서 **그대로 import**했다. storage.js는 initStorage 전이면 메모리 캐시만 쓰므로 브라우저 API가 필요 없다. 경우마다 `?case=N` 쿼리로 playerState만 새로 평가했다.
- 실제 `initShop`·`initItems`·`completeTutorial`·`inventory.grant`로 3번의 실제 txId 형식을 넣었다. 그래서 log 50줄도 실제 `_commit`이 채운다. 마지막에 `playerState.save()`가 쓴 객체를 쟀다.
- 그 객체에 `adContinue`를 붙인 것을 업로드 모양으로 보고 `JSON.stringify` UTF-8 바이트와 `gzip`(zlib 기본 레벨) 바이트를 쟀다.
- 아이템은 16종 전부(0~79개), 젬 스킬 9개, history 8개 + pending, 결제는 1개월 3 / 6개월 10 / 1년 30 / 2년 60건으로 넣었다. 주문 id는 Play 형식 `GPA.xxxx-xxxx-xxxx-xxxxx`다.
- 자체 확인(assert): 실제 로더(migrateSave·normalizeInv)를 통과해도 grantedTx가 같은지, 그리고 정리가 날짜 든 것만 빼는지 본다.
- 90일 정리 대상은 `att:` `free:` `pass:{팩}:` `ad:{배치}:` 중 날짜가 90일 지난 것이다. `rank:{주}`는 기획대로 남겼다.

**main** = 출석 + 무료 + 월간 패스 매일 + 시즌·우편 주 1 + 쿠폰 월 1

| 경우 | grantedTx | JSON | gzip | 정리 후 tx | 정리 후 JSON | 정리 후 gzip | 기획 JSON / gzip |
|---|---|---|---|---|---|---|---|
| ① 새 플레이어(튜토리얼 직후, 시작 아이템, 출석 1) | 17 | 1.9KB | 0.7KB | 17 | 1.9KB | 0.7KB | 3~8KB / ~1KB |
| ② 1개월 | 121 | 8.2KB | 1.8KB | 121 | 8.2KB | 1.8KB | 11KB / 1.6KB |
| ③ 6개월 | 638 | 18.4KB | 3.3KB | 365 | 13.0KB | 2.6KB | 28KB / 2.2KB |
| ④ 1년 | 1,267 | 31.3KB | 5.2KB | 445 | 15.0KB | 3.0KB | 49KB / 2.6KB |
| ⑤ 2년 | 2,508 | 56.2KB | 8.7KB | 591 | 18.2KB | 3.6KB | 90KB / 3.3KB (정리 후 20~30KB) |
| 1년 무과금 | 902 | 22.0KB | 4.1KB | 354 | 12.6KB | 2.7KB | |
| 2년 무과금 | 1,778 | 37.7KB | 6.5KB | 500 | 15.9KB | 3.3KB | |
| 1년 + 광고 3회/일 | 2,362 | 57.0KB | 8.6KB | 718 | 21.4KB | 3.9KB | |
| 2년 + 광고 3회/일 | 4,698 | 107.6KB | 15.2KB | 864 | 24.6KB | 4.5KB | |

- JSON은 기획보다 작고, gzip은 기획보다 크다(주문 id·날짜처럼 압축이 잘 안 되는 문자열 때문). 서버 상한 256KB는 광고를 넣고 정리를 안 해도 2년 108KB라 여유가 있다.
- 정리 후에도 남는 `iap:`(건당 약 35B)·`rank:`·`mail:`·`coupon:` 때문에 1년에 약 3KB씩 는다. 오래 하면 그것도 줄이고 싶을 수 있다. 예를 들어 `rank:`도 90일 지나면 지우는 방법이 있다(서버 claims PK가 막아 주므로).

**지금 브라우저의 실제 save 재기**(`npm run dev`, 게임을 켠 탭의 개발자 도구 콘솔에 한 줄)
```js
(s => console.log(s.length, 'chars /', new Blob([s]).size, 'bytes /', JSON.parse(s).inv.grantedTx.length, 'tx'))(localStorage.getItem('gemGuardians.save.v2'))
```
(저장은 300ms 디바운스라 방금 한 행동은 잠깐 뒤에 반영된다.)

## 5. save 호출 빈도 → 업로드 횟수

**playerState.save()가 불리는 곳**(`inventory._commit`도 마지막에 save를 부른다)

| 행동 | 호출 |
|---|---|
| 석상 레벨업(탭 1번 / MAX / 일괄) | playerState.tryLevelUpTower·levelUpTowerMax·levelUpAllEven — 행동마다 1 |
| 층 시작 | itemController.consumeReservations → `_commit` 1(예약이 없어도) |
| 아이템 사용 | inventory.spend → 사용마다 1 |
| 층 클리어 | battleController._applyClearReward 1 + 보스 첫 클리어 grant 1 + 랭킹 normal 제출(최고 기록일 때) 1 |
| 다음 층 | playerState.advanceFloor 1 (+ initItems 새 해금 grant) |
| 보스층 패배 | offerBossPack이 열리면 1 |
| 장착·해제·자리 바꾸기·예약 켜기 | inventory._editHotbar / setReserve — 행동마다 1 |
| 보관함 열기 | markItemsSeen(새 아이템 있을 때) 1 |
| 상점 구매·무료·패스 받기 | shopScreen env.save + inventory.buy/grant — 구매마다 1~2 |
| 출석·우편·쿠폰·claims-pending 지급 | inventory.grant — 지급마다 1 |
| 결제 지급·복원·환불 회수 | grantPaid / revokeFlags — 1 |
| 랭킹 닉네임·석상·시즌 받기 | rankingService·rankingUi — 1 |
| 튜토리얼 완료 | completeTutorial — 1~2 |
| 처치 골드 | **부르지 않음**(battleController.js:187 shortcut, 다음 save 때 같이) |

**실측**(tools/auth-precheck/count-saves.mjs)
- 실제 BattleController·playerState·LocalRankingService로 1~10층을 돌렸다. 퍼즐 전투는 건너뛰고 클리어로 바로 넘겼으며, 가정은 층당 아이템 1회·석상 강화 탭 2회다.
- 결과: 시작 7 + 층 시작 10 + 아이템 9 + 클리어·보스·랭킹 21 + 강화 20 + 다음 층 10 = **1~10층에 77회(층당 7.7회)**.
- simulation.md 시뮬레이터는 playerState를 쓰지 않아서 이 측정에는 쓰지 못했다.

**업로드 추정**(기획 §1-E 규칙)
- save가 층당 7~8회 불리므로 업로드할 때면 dirty는 사실상 늘 켜져 있다. 업로드 횟수는 "업로드 시점이 몇 번 오나"로 정해진다.
- 층당 시간은 balance-v12 기준 normal 100층 149분이라 재도전을 포함해 약 1.5분이다. 층 클리어가 1.5분마다 오고 3분 간격 제한이 걸리니 **1시간에 약 20회**다.
- 여기에 바로 올리는 것이 더해진다: 보스 첫 보상(1시간 40층이면 4회), 출석·우편·무료·패스 지급(하루 2~4회), 백그라운드 전환(세션당 1).
- 그래서 **1시간 플레이에 약 25회**다. "보상 지급 직후"에 보스·해금 보상까지 넣으면 그만큼 더 는다.
- 하루로 보면: 짧게 2번(각 15분)이면 세션당 5 + 보상 1~2 + 백그라운드 1로 **약 15회/일**, 1시간 넘게 하는 사람은 **25~30회/일**이다. 기획의 "10회 안팎"은 가벼운 플레이어 기준이다.

## 6. 지금 서버 호출 수

**앱 한 번 켜서 1판 하고 끌 때**(src/net/api.js, src/game/serverUi.js, src/net/services.js, src/ranking/serverRankingService.js)

| 함수 | 횟수 | 언제 |
|---|---|---|
| `hello` | 1 | 시작(initNet) |
| `claims-pending` | 1 | 시작(syncClaims) |
| `claims-granted` | 0~1 | pending이 있었을 때 |
| `att-status` | 1 (+출석 팝업 열 때마다 1) | 시작 refresh |
| `mail-list` | 1 (+우편 팝업 열 때마다 1) | 시작 refresh |
| `att-claim` + `claims-granted` | 하루 1번 × 2 | 출석 받기 |
| `mail-claim` + `claims-granted` | 우편마다 2 | |
| `rank-normal` | **최고 층을 새로 깰 때마다 1** | submit normal(updated) |
| `rank-top` + `rank-me` (+`rank-profile` 실행당 1, 서버 기록이 낮으면 `rank-normal`+`rank-me` 한 번 더) | 랭킹 열 때마다 2~5 | |
| `coupon-redeem` + `claims-granted` | 쿠폰마다 | |
| `iap-verify`(1~2) + `iap-granted` | 결제마다 | pendingVerify 재확인은 시작 때 |
| `me-delete` | 삭제 버튼 | |
| `ad-nonce`/`ad-claim` | 0(배치 없음) | |
| (`cron-jobs` 하루 1, `webhook-revenuecat` 결제마다 — 사람 수와 무관하게 작음) | | |

**월 호출 수**(DAU 1,000 × 하루 2번 접속 × 30일)

| 항목 | 1인/일 | 월 |
|---|---|---|
| 지금, 최소(시작 4×2 + 출석 2) | 10 | **30만** |
| 지금, 보통(+ 새 층 rank-normal 세션당 ~3, 랭킹 1회 열기, 팝업 1~2회) | ~20 | **~60만** |
| 클라우드 저장 추가: `save-get` 2 + 업로드 10(기획) ~ 25(5번 추정) | 12~27 | 36만~81만 |
| **합계** | 22~47 | **66만~141만**(무료 50만 회 초과) |

- 지금 상태로도 보통 플레이어 기준 무료 한도 근처다. 기획 §1-E의 "DAU 1,500명 넘으면 Pro"는 **DAU 약 350~750명**으로 내려야 맞다.
- 줄이는 방법(제안): `save-get`·`att-status`·`mail-list`(·`claims-pending`)를 `hello` 응답 하나로 합치면 시작 4~5회가 1회로 준다. `rank-normal`은 `save-put` 때 서버가 summary.bestFloor로 갱신하게 하면 따로 안 불러도 된다. 업로드 간격은 3분 → 5분.
- 쑹이 볼 곳(직접 조회 안 함): Supabase 대시보드 → 프로젝트 → **Usage**에서 **Edge Function Invocations**(월 누적)와 **Database size**. 함수별 횟수는 Edge Functions → 각 함수 → Invocations/Logs.

## 7. DB 저장 크기

**못 잼.** 이 PC에 Docker가 없어서(`docker: command not found`) `npx supabase start`를 하지 못했다. 원격(--linked)에는 하지 않았다.

**근사**(gzip × 1.5~2)
- jsonb는 텍스트보다 조금 크고, TOAST는 행이 약 2KB를 넘을 때만 pglz로 압축한다. pglz는 gzip보다 압축률이 낮다.
- 새 플레이어(2KB 안팎)는 압축되지 않고 그대로 약 2KB로 저장될 수 있다.

| 1만 명 × (save 1 + 백업 3) | 1행 | 1인(×4) | 1만 명 | 500MB 대비 |
|---|---|---|---|---|
| 전원 새 플레이어 | ~2KB(압축 안 됨) | ~8KB | ~80MB | 여유 |
| 전원 1년, 90일 정리 | 4.5~6KB | 18~24KB | 180~240MB | 안 넘음 |
| 전원 2년, 90일 정리 | 5.4~7.2KB | 22~29KB | 220~290MB | 안 넘음 |
| 전원 2년, 정리 안 함 | 13~17KB | 52~70KB | **520~700MB** | **초과** |

- 행·인덱스 오버헤드와 기존 표(claims는 txId 수만큼 쌓임 — 1년 1인 약 400행)는 별도다. 현실적으로는 신규·이탈자가 섞여서 이보다 작다. 그래도 **90일 정리는 필수**이고 백업 3개는 유지할 수 있다.
- 로컬에서 다시 잴 때: Docker Desktop을 설치한 뒤 `npx supabase start`(server/supabase) → 임시 표 `create table t(data jsonb)` → measure-save.mjs `--json` 출력의 save를 넣고 `select pg_column_size(data)` → `npx supabase stop`.

## 8. 로그인 관련 라이브러리·설정

- `@supabase/supabase-js` package.json `^2.119.0`, lock·설치 **2.119.0**, `@supabase/auth-js` **2.119.0**.
- `linkIdentity`(node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts:2231-2235)
  ```ts
  linkIdentity(credentials: SignInWithOAuthCredentials): Promise<OAuthResponse>;
  /** Links an OIDC identity to an existing user. */
  linkIdentity(credentials: SignInWithIdTokenCredentials): Promise<AuthTokenResponse>;
  ```
  `SignInWithIdTokenCredentials`(lib/types.d.ts:632)
  ```ts
  export type SignInWithIdTokenCredentials = {
      provider: 'google' | 'apple' | 'azure' | 'facebook' | 'kakao' | `custom:${string}` | (string & {});
      token: string;
      access_token?: string;
      /** If the ID token contains a `nonce` claim, then the hash of this value is compared to the value in the ID token. */
      nonce?: string;
      options?: { captchaToken?: string; };
  };
  ```
  구현(GoTrueClient.js:3993)은 `POST /token?grant_type=id_token`에 `{provider, id_token, access_token, nonce, link_identity: true}`를 지금 세션 jwt와 함께 보낸다. **ID 토큰 방식과 nonce를 둘 다 지원한다.**
- `signInWithIdToken`도 같은 타입이라 `nonce?: string`을 받는다.
- 오류 코드(lib/error-codes.d.ts `ErrorCode`): **`identity_already_exists`가 정의돼 있다.** 관련 코드로 `manual_linking_disabled`, `identity_not_found`, `single_identity_not_deletable`, `email_conflict_identity_not_deletable`도 있다. 실제 응답이 이 코드인지는 연결할 때 확인해야 한다(§10-1).
- `@capgo/capacitor-social-login`(npm view, 설치 안 함): 최신 **8.7.9**, 8.x는 **8.1.0부터** 105개이고 peer는 `@capacitor/core >=8.0.0`이다(7.x는 `>=7.0.0`). 프로젝트 `@capacitor/core ^8.6.0`과 맞는다.
- `server/supabase/config.toml`

| 항목 | 값 |
|---|---|
| `enable_anonymous_sign_ins` | true |
| `enable_manual_linking` | **false** |
| `[auth.external.google]` | **섹션 없음** |
| `skip_nonce_check` | false — `[auth.external.apple]` 안에 있는 값이고, apple은 enabled=false |
| `site_url` | `"http://127.0.0.1:3000"` |
| `additional_redirect_urls` | `["https://127.0.0.1:3000"]` |
| `project_id` | `"gem-guardians"` |

  기획 §5-5의 `http://localhost:5173/**`과 다르다. vite 개발 포트가 5173이다.
- `src/net/api.js` createClient: `storageKey: 'gemGuardians.auth'`, `persistSession: true`, `autoRefreshToken: true`, **`detectSessionInUrl: false`**, `flowType`은 **지정 안 함**(auth-js 기본값 `'implicit'`). 기획 §5-5(웹 리다이렉트 PKCE `?code=`)를 하려면 `flowType: 'pkce'`와 `detectSessionInUrl: true`(또는 직접 `exchangeCodeForSession`)가 필요하다.

## 9. 계정 전환에 걸리는 기존 코드

**결제 대기열을 비우는 함수**
| 대기열 | 비우는 함수 | 언제 불리나 |
|---|---|---|
| `pendingVerify`(src/shop/iap.js) | `syncServerIap()` — 각 항목을 `iap-verify` → 지급 → `iap-granted` 하고 판정이 나면 목록에서 뺌(연결 오류는 남김) | main.js:381, hello 뒤 한 번 |
| `pendingPurchases`(play.js) | `platform.iap.recoverPending(onGrant)` — RevenueCat `getCustomerInfo` 거래와 맞춰 지급하고, 전부 성공하면 목록을 줄임 | main.js:375, 시작 때 |

  둘 다 따로 "지금 비우기" 함수가 없고 시작 경로에서만 불린다. 계정을 바꾸기 전에는 `recoverPending(withVerify 감싼 onGrant)` → `syncServerIap(...)` 순서로 불러야 한다. 그리고 비웠는지 알려면 `pendings().length === 0`을 확인해야 하는데, 그런 export가 없다. 성공 여부를 돌려주는 함수 하나가 필요하다.

**FK**(server/supabase/migrations)
| 표 | player_id FK | on delete |
|---|---|---|
| players.id | auth.users | cascade |
| purchases | players | **set null** ✓(기획과 같음) |
| ad_views | players | set null |
| claims, attendance, mail, normal_best | players | cascade |
| comp_runs, comp_best, season_results, ad_nonces | players | cascade |
| rate_calls, coupon_tries | **FK 없음** | 지워지지 않고 남음(me_delete가 rate_calls는 직접 지움, coupon_tries는 안 지움) |
| server_log, events, coupons, seasons_settled | 플레이어 열 없음 | |

**RevenueCat `Purchases.logIn`**
- 위치: src/platform/capacitor/iap/play.js:60-63 `logIn(appUserId)`
- 시점: `syncServerIap` 첫 줄(`net.playerId`가 있으면), 즉 앱 시작 hello 뒤 한 번뿐이다. 원스토어는 같은 자리에서 `onestore.logIn`이 payload용 id만 기억한다.
- 계정을 바꿀 때 다시 부르는 곳은 없다.

**데이터 삭제 버튼**
- 있다. 메뉴 → 설정 → **정보(about) 팝업** 안 서버 영역의 삭제 버튼(src/render/mainMenuScreen.js:1098 `ABOUT_NET.del`)이다. 서버가 켜져 있을 때만 보인다.
- 누르면 확인 모달("서버의 출석·우편·랭킹 기록을 지울까요?") → `me-delete` → `forgetSession()`(로컬 signOut)으로 이어진다. 기기 save는 그대로 남는다.
- `me_delete` rpc는 claims·attendance·normal_best·mail·rate_calls·comp_*·season_results·ad_nonces를 지우고, ad_views·purchases는 연결만 끊고, players는 익명화(deleted_at)한다. auth.users는 남는다.

---

## 기획(docs/auth.md)에서 고쳐야 할 것

| 항목 | 기획 | 실제 | 제안 |
|---|---|---|---|
| Supabase 프로젝트 | `zgzwnsvuidydiyavlpyf`(§7-1, §7-2) | 앱은 `jzpjqfbpqzghprqbqexp`(config/server.json) | **`jzpjqfbpqzghprqbqexp`로 확정**(쑹). §7-1 리디렉션 URI `https://jzpjqfbpqzghprqbqexp.supabase.co/auth/v1/callback`, §7-2 제목의 id 고치기 |
| 하루 txId | 약 5개(§1-E) | 무과금 2.1 / 월간 패스 3.3 / 광고 3회 열면 6.3 | 표 근거를 "광고 상자 포함 시"로. 지금은 2~4 |
| save 크기 표 | 새 3~8KB, 1년 49KB, 2년 90KB, 정리 후 20~30KB | 새 1.9KB, 1년 31KB, 2년 56KB, 정리 후 15~18KB(광고 3회면 21~25KB) | 4번 표로 바꿈. 정리 후에도 1년 ~3KB씩 는다고 적기 |
| 정리 근거 | "서버 claims PK가 중복을 막아서" | `free:`·`pass:`는 서버에 없음(기기 전용) | 근거를 "과거 날짜는 다시 지급될 수 없어서"로. 시계 되돌리기 90일 넘으면 예외 |
| 정리 대상 | att·free·pass·ad | `rank:{주}`도 서버 PK로 보호됨 | `rank:`도 90일 정리 대상에 넣을지 결정(1년 52개) |
| 업로드 횟수 | 1인 하루 10회 안팎 | 가벼운 플레이 ~15회, 1시간 이상 25~30회 | 업로드 간격 5분 또는 층 클리어는 업로드 시점에서 빼기 검토 |
| Edge Function 한도 | DAU 1,000 → 월 약 30만(+ 기존), 1,500명부터 Pro | 기존만 30만~60만, 저장 더하면 66만~141만 | `save-get`·`att-status`·`mail-list`·`claims-pending`을 `hello`에 합치기, `rank-normal`을 `save-put`에 합치기. Pro 신호를 DAU ~400으로 |
| DB 용량 | 1만 명 200~400MB | 근사 180~290MB(정리 시), 정리 안 하면 520~700MB | 정리가 필수라고 명시. 로컬 실측은 Docker 설치 뒤 |
| `deviceId` 새 키(§3-1) | 새 랜덤 id 키 | `platformUserId`(웹·Capacitor 공통 UUID)가 이미 있음 | 그 값을 재사용 |
| §1-C 표 | — | `gemGuardians.save.v1`, `platformUserId` 빠짐. `locale`은 KEYS에 없어 저장해도 안 읽힘 | 표에 추가. `locale` KEYS 누락은 별도 버그로 처리 |
| config.toml(§7-2-5) | manual linking·google 설정 | `enable_manual_linking=false`, google 섹션 없음, site_url `127.0.0.1:3000` | L2 때 수정 목록에 site_url/redirect(`localhost:5173`) 추가 |
| 웹 리다이렉트(§5-5) | PKCE `?code=` + detectSessionInUrl | `detectSessionInUrl:false`, flowType 미지정(implicit) | `flowType:'pkce'` + 돌아왔을 때 처리 코드 명시 |
| 결제 대기열 비우기(§5-4) | "서버로 보내서 비움" | 전용 함수 없음. 시작 경로(recoverPending·syncServerIap)에서만, 결과(남았나)를 안 돌려줌 | `flushPendingPurchases()` → `{ok, left}` 하나 만들기를 L2 작업에 넣기 |
| RevenueCat logIn(§4-3) | B로 logIn | 시작 때 한 번만 부름 | 계정 전환 흐름에서 직접 호출(기획대로)하고, 그 전에 대기열을 비웠는지 확인 |
| 계정 삭제(§6) | me-delete 확장 | `coupon_tries`·`rate_calls`는 FK가 없어 cascade 안 됨(coupon_tries는 me_delete도 안 지움) | auth.users 삭제 때 둘 다 직접 지우기 |
| §10-1·2·4 확인 필요 | 오류 코드·nonce·capgo 버전 미확인 | `identity_already_exists` 정의됨, `nonce?` 지원, capgo 8.1.0+ | 실제 응답 확인만 남김 |

## git status (작업 후)

```
 M config/balance.json
 M docs/balance.md
 M docs/battle.md
 M docs/plan.md
 M src/config/combo.js
 M src/config/locales/en.js
 M src/config/locales/ko.js
 M src/core/economy/economy.js
 M src/core/gameState.js
 M src/game/battleController.js
 M src/main.js
 M src/render/canvasRenderer.js
 M src/render/screenFit.js
 M src/render/uiKit.js
 M tools/sim/config.js
 M tools/sim/floorSim.js
 M tools/sim/run.js
 M tools/sim/tests/t3.js
 M tools/sim/tests/t4.js
 M tools/sim/tests/t7.js
?? docs/auth-precheck.md
?? docs/auth.md
?? tests/comboGold.test.js
?? tools/auth-precheck/
?? tools/sim/combo.js
```

- 작업 시작 때와 같은 M/?? 목록(쑹의 진행 중 변경)이고, 이번에 새로 생긴 것은 `docs/auth-precheck.md`, `tools/auth-precheck/`(measure-save.mjs, count-saves.mjs)뿐이다. 기존 파일은 바꾸지 않았다.
