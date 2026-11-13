# Gem Guardians 로그인 · 클라우드 저장 계획 v1

> 2026-11-12 · 스레드 "게스트·소셜 로그인과 클라우드 저장 설계하기"
> 저장소에 넣을 때: `docs/auth.md`로 복사. 서버 기준 문서는 `docs/server.md`(§4-1, §11 S5를 이 문서가 대체).
> 2026-11-13 수정: 사전 점검(`docs/auth-precheck.md`) 실측값 반영 — §1-C, §1-E, §3, §5-4, §5-5, §6, §7, §10, §11.
> 근거 코드: `src/game/playerState.js`, `src/platform/storage.js`(KEYS), `src/net/api.js`, `server/supabase/migrations/*`, `server/supabase/config.toml` (2026-11-12 main 기준).

---

## 0. 한 줄 요약

- **처음엔 지금처럼 게스트(익명)로 바로 시작**하고, 원할 때 설정에서 **Google(iOS는 Apple도) 계정을 연결**합니다. 연결하면 **플레이어 id가 그대로**라 결제·출석·랭킹·쿠폰 기록이 다 따라옵니다(Supabase `linkIdentity`).
- 그런데 지금 골드·다이아·아이템·층은 **기기에만** 있어서, 계정만 연결해선 폰을 바꿀 때 진행이 안 옮겨집니다. 그래서 **클라우드 저장(save 한 덩어리를 서버에 올리기)** 을 같이 만듭니다. 이게 이번 작업의 몸통입니다.
- 순서: **L1 클라우드 저장(게스트도) → L2 Google 로그인·계정 충돌 화면·로그아웃 → L3 계정 삭제 완성·정리 cron·데이터 보안 양식 → L4 iOS(Apple)**. L1만 해도 웹에서 바로 테스트됩니다.

---

## 1. 서버에 저장해야 할 데이터 (추린 결과)

지금 기기 저장소 키(`src/platform/storage.js` KEYS)와 서버 표를 하나씩 나눴습니다.

### 1-A. 이미 서버가 주인 — 바꿀 것 없음 (계정 연결하면 자동으로 따라옴)

| 데이터 | 서버 표 | 비고 |
|---|---|---|
| 결제 기록 | `purchases` | 5년 보관 |
| 출석·우편·쿠폰·광고·시즌 보상 수령 | `claims`, `attendance`, `mail`, `ad_views`, `coupons/coupon_tries` | txId로 중복 방지 |
| 랭킹 기록·닉네임·대표 석상 | `normal_best`, `comp_*`, `season_results`, `players.nickname/statue` | |

### 1-B. 새로 클라우드 저장에 올릴 것 — `gemGuardians.save.v2` 블록 통째

필드를 골라 올리지 않고 **기기 save 객체를 그대로 한 덩어리(jsonb)로** 올립니다. 그래야 나중에 정령·수호자 레벨 같은 새 필드가 생겨도 save에만 넣으면 자동으로 따라갑니다.

| 묶음 | 필드 | 왜 서버에 있어야 하나 |
|---|---|---|
| 재화 | `gold`, `diamonds` | 유료 다이아 포함. 잃으면 문의 1순위 |
| 진행 | `floor`, `bestFloor`, `towerLevels[5]` | 게임 진행 자체 |
| 인벤토리 `inv` | `items`(소모품 개수), `loadout`(hotbar·pendingHotbar·preFloor·totems/정령 장착), `perm`(젬 스킬 레벨·**flags: slot4/adFree**·totems/정령 보유) | 유료 상품(4번째 슬롯·광고 제거) 효과가 여기 있음 |
| 〃 | **`grantedTx`** | **중복 지급 방지의 핵심.** 빠지면 새 기기에서 출석·쿠폰·결제 보상이 한 번 더 들어감 |
| 〃 | `seenItems`, `log`(최근 50) | 빨간 점·문의 대응용, 작아서 같이 |
| 상점 `shop` | `purchasedOnce`, `firstBuyUsed`(첫 구매 2배), `passes`(주간·월간 남은 일수, 오늘 받음), `freeClaimedDate`, `day`, `offers`(기간 한정 노출) | 유료 패스 남은 일수, 첫 구매 2배 재사용 방지 |
| 튜토리얼 | `tutorial.done/version` | 새 기기에서 튜토리얼 다시 안 보게 |
| 랭킹 블록 | `ranking.profile`(legacy playerId·닉네임·석상), `normal`, `comp`(이번 주 best·runs·**pending 결과**·history), `lastTab` | 서버에도 있지만 기기 화면이 이걸 읽음 |
| 보상 광고 이어하기 | `adContinue` (하루 5회 기록) — **save 블록 안으로 옮김** | 지우고 다시 깔아 횟수 초기화하는 걸 막음 |

### 1-E. 크기·용량·호출 수 (2026-11-13 실측 반영)

사전 점검이 실제 게임 모듈(playerState·inventory.grant·실제 txId 형식)로 잰 값입니다. 업로드 모양 = save.v2 + adContinue.

**하루에 쌓이는 txId** (매일 접속 기준)

| 플레이어 | 하루 |
|---|---|
| 무과금 (출석 + 매일 무료 + 우편 주 1) | 2.1개 |
| 월간 패스 (+ 패스 + 시즌 보상 주 1, 열리면) | 3.3개 |
| + 주간 패스 | 4.3개 |
| + 광고 상자 하루 3회 (배치를 정하면) | 6.3개 |

**save 크기** (JSON / gzip)

| 경우 | 정리 전 | 90일 정리 후 |
|---|---|---|
| 새 플레이어 | 1.9KB / 0.7KB | 같음 |
| 1개월 | 8.2KB / 1.8KB | 같음 |
| 6개월 | 18.4KB / 3.3KB | 13.0KB / 2.6KB |
| 1년 | 31.3KB / 5.2KB | 15.0KB / 3.0KB |
| 2년 | 56.2KB / 8.7KB | 18.2KB / 3.6KB |
| 2년 + 광고 3회/일 | 107.6KB / 15.2KB | 24.6KB / 4.5KB |

**그래서 하는 것**
1. **날짜가 든 txId는 90일이 지나면 기기에서 지웁니다**: `att:{날짜}`, `free:{날짜}`, `pass:{팩}:{날짜}`, `ad:{배치}:{날짜}:{n}`, 그리고 **`rank:{주}`**(90일 = 약 13주가 지난 것). 지워도 되는 이유는 이렇습니다.
   - `att:`·`ad:`·`rank:` = 서버 `claims` primary key가 중복을 막습니다.
   - `free:`·`pass:` = 기기 전용이지만 오늘 날짜로만 만들어져서 과거 날짜로 다시 받을 수 없습니다. 기기 시계를 90일 넘게 되돌리는 경우만 예외인데, 감수합니다.
   - 평생 한 번짜리(`start:`·`unlock:`·`boss:`·`iap:`·`refund:`·`coupon:`·`mail:`·`tutorial_complete`)는 남깁니다. 정리 후에도 이것들 때문에 1년에 약 3KB씩은 늘지만 문제없는 수준입니다.
2. 서버 상한은 **256KB**(망가진 save 방어용 — 광고 넣고 정리 안 해도 2년 108KB).

**DB 용량 (무료 500MB)** — 로컬 DB를 못 띄워 근사값(gzip × 1.5~2). 1만 명 × (save 1 + 백업 3):

| 경우 | 1만 명 |
|---|---|
| 전원 1년, 정리 | 180~240MB |
| 전원 2년, 정리 | 220~290MB |
| 전원 2년, **정리 안 함** | **520~700MB (초과)** |

→ **90일 정리는 필수**, 백업 3개는 유지 가능. (Docker 설치 후 `pg_column_size`로 실측하면 더 정확)

**Edge Function 호출 수 (무료 월 50만 회)** — 용량보다 이게 먼저 찹니다.
- **지금(클라우드 저장 전)도** DAU 1,000명·하루 2번 접속이면 월 30만~60만 회. 시작할 때마다 `hello`·`claims-pending`·`att-status`·`mail-list` 4번에, 새 최고 층마다 `rank-normal`이 나갑니다.
- 그래서 클라우드 저장을 붙이면서 **호출을 합칩니다**(프롬프트 A).
  1. **`hello` 하나로 시작 정보 전부**: 서버 save 메타(rev·updatedAt), 출석 상태, 우편 개수·목록, 미지급 claims를 `hello` 응답에 넣습니다. 시작 호출이 4~5번에서 1번으로 줄고, `save-get`은 서버 save가 더 새것일 때만 부릅니다.
  2. **`rank-normal`을 `save-put`에 실어 보냄**: 새 최고 층 기록을 업로드 body에 같이 넣으면 서버가 같은 판정 로직으로 `normal_best`를 갱신합니다. 랭킹 화면에서 바로 반영돼야 하는 경우(랭킹 팝업을 열 때)만 따로 부릅니다.
  3. **업로드 간격 5분**(층 클리어·메뉴 복귀). 결제·보상 지급 직후와 앱 백그라운드는 바로 올립니다.
- 합친 뒤 추정: 1인 하루 약 12~18회 → DAU 1,000명 = 월 36만~54만 회. **Pro 신호 = DAU 약 700명, 또는 대시보드 Usage가 한도의 80%를 넘을 때**($25, 월 200만 회 포함).
- 확인할 곳: Supabase 대시보드 → Usage → Edge Function Invocations / Database size.

### 1-C. 기기에만 남길 것 (올리지 않음)

| 키 | 이유 |
|---|---|
| `sfxVolume`, `bgmVolume`, `muted`, `haptics`, `guardianFx`, `locale` | 기기 취향. 폰마다 다를 수 있음. ※ `locale`은 지금 `storage.js` KEYS에 빠져 있어 **다시 켜면 항상 한국어로 돌아가는 버그**가 있음 → 프롬프트 A에서 한 줄로 고침 |
| `devServer`, `devCheats` | 개발용 |
| `dataEpoch` | 전체 초기화 스위치 |
| `leaderboardSubmitted` | 토스 리더보드 제출 기록(토스 쪽 상태) |
| `gemGuardians.auth` | 로그인 토큰. 절대 올리지 않음 |
| `gemGuardians.save.v1` | 옛 save(마이그레이션 원본, 읽기만) |
| `platformUserId` | 기기 id(웹·Capacitor 공통 UUID). 클라우드 저장의 `device_id`로 **재사용** |
| `pendingVerify`, `pendingPurchases` | **이 기기의 결제 대기열.** 올리지 않는 대신, 계정을 바꾸거나 로그아웃하기 전에 반드시 서버로 보내서 비움(§5-4) |

### 1-D. 이번엔 안 하는 것 (그대로 기기 권위)

- **다이아·골드는 계속 기기가 주인**이고 서버는 "보관"만 합니다(서버 권위 지갑은 큰 작업이라 v2). 대신 서버가 올라온 save를 보고 이상치(다이아가 한 번에 결제 기록보다 크게 늘었는지, bestFloor가 normal_best보다 너무 큰지)를 `server_log`에 **기록만** 합니다. 실제 조작이 보이면 그때 막기.

---

## 2. 계정 구조

```
처음 실행 ─ 익명 로그인(지금 그대로) ─ 플레이어 id = A (게스트)
                │
  설정 > 계정 > [Google로 연결]
                │
     ┌──────────┴───────────┐
 그 Google 계정이 처음      이미 다른 플레이어 B에 연결돼 있음
     │                         │
 linkIdentity 성공          (새 폰에 재설치 / 예전에 연결함)
 id A 그대로 → 끝            → B로 로그인 + 충돌 화면(§4)
```

- 계정 하나 = `auth.users` 한 줄 = `players` 한 줄 = `saves` 한 줄. id는 연결 전후로 같음.
- 한 계정에 Google과 Apple을 둘 다 붙일 수 있음(같은 `linkIdentity`).
- 게스트도 클라우드 저장을 합니다(코드 길이 하나, 연결 즉시 서버에 이미 save가 있음). 단 게스트는 재설치하면 토큰이 없어 다시 못 찾습니다 → 계정 화면에 그 문구를 보여 줌.

### 2-1. 마켓별 로그인 수단

| 빌드 | 로그인 수단 | 방식 | `caps.login` |
|---|---|---|---|
| 웹 | Google | Supabase OAuth 리다이렉트(`linkIdentity({provider:'google'})`, PKCE) | `['google']` |
| Google Play | Google | 기기 Google 로그인 창(Credential Manager) → ID 토큰 → `linkIdentity({provider:'google', token})` | `['google']` |
| 원스토어 | Google | Play와 같은 코드. Google Play 서비스 없는 폰이면 "이 기기에선 Google 로그인을 쓸 수 없어요" | `['google']` |
| App Store | **Apple + Google** | 네이티브 Apple 로그인 / Google 로그인 → ID 토큰. **Google을 넣으면 Apple 로그인 필수(심사 4.8)** | `['apple','google']` |
| 토스 | 없음 | 토스 계정이 곧 로그인. 버튼 숨김. 재설치 복구는 §8 T(선택) | `[]` |

- 앱 플러그인: **`@capgo/capacitor-social-login`** (Google·Apple 둘 다, Capacitor 8 지원 확인 필요). ID 토큰만 받아 Supabase에 넘기고, Google 접근 토큰은 안 씀.
- 요청 범위는 `openid email profile`만(민감 범위 아님 → Google 앱 심사 불필요, 동의 화면 "프로덕션" 게시만).
- Kakao 등은 v1 안 함(Supabase가 지원하니 나중에 같은 방식으로 추가 가능).

---

## 3. 클라우드 저장 동작

### 3-1. 서버 표

```sql
saves (
  player_id   uuid primary key references players on delete cascade,
  data        jsonb not null,          -- 기기 save.v2 블록 그대로 (adContinue 포함)
  save_version int not null,
  rev         bigint not null,         -- 올릴 때마다 +1
  summary     jsonb not null,          -- {bestFloor, floor, diamonds, gold, towerSum, tutorialDone} 충돌 화면·관리용
  device_id   text, platform text, app_version text,
  updated_at  timestamptz default now()
)
save_backups (id bigserial, player_id uuid, data jsonb, rev bigint,
              reason text,              -- daily|overwrite|merge|restore
              created_at timestamptz default now())   -- 한 사람당 최근 3개, 30일 지나면 삭제
```

- RLS 켜고 정책 없음(지금 표들과 같음). 읽기·쓰기는 Edge Function만.
- `device_id` = 이미 있는 기기 id `platformUserId`(웹·Capacitor 공통)를 그대로 씀. 토스는 없으면 새로 만듦.

### 3-2. API

| 함수 | 입력 | 하는 일 |
|---|---|---|
| `save-get` | – | `{ ok, save: { rev, data, summary, updatedAt, deviceId, platform } \| null }` |
| `save-put` | `{ baseRev, data, deviceId, appVersion, rank? }` (`rank` = 새 최고 층 기록이 있을 때만, §1-E) | `saves.rev == baseRev`일 때만 저장(rev+1) → `{ ok, rev }`. 다르면 `{ ok:false, reason:'conflict', server:{rev, summary, updatedAt, deviceId} }`. 256KB 넘으면 `tooBig`. 하루 첫 저장 때 이전 것을 `save_backups(daily)`로 |
| `save-put` + `force:true` | 충돌 화면에서 "이 기기로 덮어쓰기"를 고른 경우만 | 이전 서버 save를 `save_backups(overwrite)`로 남기고 덮어씀 |

`summary`는 서버가 data에서 계산(기기가 보낸 값 안 믿음). 이상치 기록(§1-D)도 여기서.

### 3-3. 기기 쪽 기록 `cloudMeta` (기기 전용 키)

```js
{ owner: '<플레이어 id>', rev: 12, dirty: true, syncedAt: 1731400000000 }
```

- `owner` = 이 기기 save가 누구 것인지. **계정을 바꿀 때 남의 save를 올리는 사고를 막는 장치.**
- `playerState.save()`가 부를 때마다 `dirty = true`.

### 3-4. 언제 올리고 받나

| 때 | 동작 |
|---|---|
| 앱 시작 | `/hello` 응답의 save 메타(rev)로 아래 표대로 판정. 서버 save가 더 새것일 때만 `save-get` |
| 결제·보상 지급 직후, 앱 백그라운드(onPause) | `dirty`면 바로 올림 |
| 층 클리어, 마을(메뉴) 복귀 | `dirty`이고 마지막 업로드 후 **5분** 지났으면 올림 |
| 그 밖 | 올리지 않음(dirty로 두고 위 시점에). 전투 중 매 처치마다 안 올림 |
| 오프라인 | 그냥 `dirty`로 두고 다음 기회에. 게임은 그대로 진행 |

**시작 때 판정 (서버 rev = S, 기기 cloudMeta.rev = L)**

| 상황 | 동작 |
|---|---|
| 서버에 save 없음 | 기기 save 올림(baseRev 0) |
| `owner`가 지금 id와 다름 (토큰이 날아가 새 익명 id가 된 경우 등) | 기기 save를 새 id로 올림(owner 갱신). 예전 계정은 Google 로그인으로 다시 찾음 → §4 |
| S == L | `dirty`면 올림, 아니면 끝 |
| S > L, 기기 `dirty` 아님 | 다른 기기에서 더 했음 → **서버 save 적용** |
| S > L, 기기 `dirty` | 두 기기에서 각각 진행 → **충돌 화면**(§4-2와 같은 카드) |

**서버 save 적용** = 기기 저장소의 `save.v2`·`adContinue`를 서버 data로 바꾸고 flush → **게임을 다시 불러옴**(`location.reload()`, Capacitor 웹뷰에서도 됨). playerState를 실행 중에 갈아끼우는 것보다 안전하고 단순합니다. 다시 뜨면 "다른 기기의 진행을 불러왔어요" 토스트.

---

## 4. 계정 충돌 화면

### 4-1. 언제 뜨나

1. 게스트 A가 [Google로 연결]을 눌렀는데 그 Google 계정이 이미 플레이어 B에 붙어 있을 때 (재설치·새 폰·예전 연결)
2. 시작 때 "S > L이고 기기 dirty"(같은 계정, 두 기기 동시 진행)

**건너뛰는 경우:** 1번에서 A가 **사실상 빈 게스트**(bestFloor ≤ 1, 튜토리얼 전후 상관없이 결제 기록 0, 다이아 ≤ 시작값)면 묻지 않고 바로 B를 불러옵니다. 새 폰에 깔고 로그인하는 가장 흔한 경우가 여기라 화면이 안 뜹니다.

### 4-2. 화면 (팝업, 기존 팝업 틀)

```
┌──────── 저장된 진행이 있어요 ────────┐
│  이 Google 계정에 다른 진행이 있어요.  │
│  어느 쪽으로 계속할까요?              │
│                                        │
│ ┌ Google 계정 ─────┐ ┌ 이 기기 ───────┐│
│ │ 최고 37층         │ │ 최고 12층       ││
│ │ 다이아 1,240      │ │ 다이아 85       ││
│ │ 석상 Lv 합 142    │ │ 석상 Lv 합 40   ││
│ │ 11/10 21:14 저장  │ │ 지금            ││
│ │ (Android)         │ │                 ││
│ │ [이걸로 계속] ★   │ │ [이걸로 계속]   ││
│ └──────────────────┘ └────────────────┘│
│  고르지 않은 쪽 진행은 사라져요.         │
│              [취소]                    │
└────────────────────────────────────────┘
```

- 기본 추천(★, 금색 테두리) = **최고 층이 높은 쪽**. 같으면 Google 계정 쪽.
- **이 기기 쪽을 고르면 한 번 더 확인**: "Google 계정의 최고 37층 진행이 이 기기 진행으로 바뀌어요. 되돌릴 수 없어요." [바꾸기][취소]. (서버엔 `save_backups(overwrite)`로 30일 남아 쑹이 문의 받으면 복구 가능)
- **이 기기에 결제한 게 있으면**(A의 purchases > 0) 이 기기 카드에 "결제 n건 포함" 표시 + Google 계정 쪽을 고를 때 확인 한 번: "이 기기에서 산 다이아 등 소모 상품은 옮겨지지 않아요. 광고 제거·4번째 슬롯·스타터 팩은 계정으로 옮겨져요."
- **두 진행을 합치는 기능은 안 만듭니다**(다이아·아이템 합치면 복사 버그 통로). 고르기만.
- [취소] = 연결 안 함, 게스트 A 그대로(§5-1의 A 세션 복원).

### 4-3. 고른 뒤 서버 처리 `account-merge`

A의 기록 중 **사라지면 안 되는 것만** B로 옮기고 A를 지웁니다.

| A의 기록 | 처리 |
|---|---|
| `purchases` | `player_id` → B. (비소모성 효과는 B save의 `perm.flags`에 없으면 기기가 스토어 복원으로 다시 받음 — 지금 복원 로직 재사용) |
| `claims` 중 쿠폰(`coupon:*`)·시즌 보상 | B로 옮김(B에 같은 tx_id가 있으면 버림). **같은 쿠폰을 두 계정으로 두 번 받는 걸 막음** |
| 미지급 `claims`(granted_at null) | 고른 쪽이 B save면 버림, A save를 골랐으면 B로 옮겨 다시 내려줌 |
| `attendance`, 랭킹, 우편 | B 것 유지, A 것 삭제. 단 A save를 골랐고 A의 normal_best가 더 높으면 B의 normal_best를 그 값으로 |
| `players` A | `merged_into = B` 기록 후 `auth.users` A 삭제(관리자 API). RevenueCat 웹훅이 A id로 오면 `merged_into`로 따라가 B로 기록 |

- A의 세션은 B로 바꾸는 순간 사라지므로 **바꾸기 전에** A 토큰으로 `account-merge-ticket`을 받아 둡니다(10분짜리 1회용 표, `merge_tickets(ticket, from_player, expires_at)`). B로 로그인한 뒤 `account-merge { ticket, keep: 'server'|'device' }`를 부르면 서버가 둘 다 확인하고 처리.
- 기기 쪽은 그 뒤 RevenueCat `Purchases.logIn(B)` → 비소모성 복원 → `keep:'device'`면 `save-put force` / `keep:'server'`면 서버 save 적용(다시 불러오기).

---

## 5. 흐름별 순서 (기기)

### 5-1. [Google로 연결] (게스트일 때)

1. 오프라인이면 "인터넷에 연결한 뒤 다시 해 주세요".
2. 기기 save 먼저 올림(`dirty`면). 결제 대기열(`pendingVerify`·`pendingPurchases`)을 서버로 보내 비움 — 실패하면 연결 중단하고 안내.
3. Google ID 토큰 받기(앱: 플러그인 / 웹: §5-5).
4. `supabase.auth.linkIdentity({ provider:'google', token })`
   - 성공 → `/hello` 다시(서버가 `players.linked` 갱신) → 토스트 "Google 계정에 연결했어요. 이제 다른 기기에서도 이어 할 수 있어요."
   - **이미 다른 계정에 연결됨** 오류 → 5번
   - 사용자가 창을 닫음 → 아무것도 안 함
5. 충돌 처리: A 세션(access·refresh 토큰)을 메모리에 복사 → `account-merge-ticket` → `signInWithIdToken({provider:'google', token})` → B로 `save-get` → §4-1 건너뛰기 조건 보고 화면 또는 바로 B → `account-merge` → 적용. [취소]면 `auth.setSession(A 토큰)`으로 A 복귀.

> 같은 ID 토큰을 두 번(link 실패 후 signIn) 쓸 때 nonce가 한 번만 통과하면 한 번 더 받아야 할 수 있음 → 구현 때 확인(§10).

### 5-2. 새 기기에서

새 기기 = 새 게스트 A'. 위와 똑같이 [Google로 연결] → 빈 게스트라 화면 없이 B를 불러옴. 버튼 이름은 상태와 상관없이 **"Google로 로그인 / 연결"** 하나.

### 5-3. 로그아웃 (연결된 계정만)

"로그아웃하면 이 기기는 새 게스트로 시작해요. 진행은 Google 계정에 저장돼 있어요." [로그아웃][취소]
→ save 올리기 + 결제 대기열 비우기(**둘 다 성공해야만** 진행, 실패면 "인터넷 연결 후 다시") → 기기 save·cloudMeta·adContinue 지움(설정 키는 유지) → `signOut` → 다시 불러오기(새 익명).
게스트에는 로그아웃 버튼 없음(누르면 진행이 영영 사라지므로).

### 5-4. 결제 대기열 규칙

계정이 바뀌는 모든 길(연결 충돌·로그아웃·삭제) 앞에서 `pendingVerify`/`pendingPurchases`를 먼저 서버로 보냅니다. 남은 상태로 계정을 바꾸면 그 결제가 엉뚱한 계정에 기록됩니다.

지금은 이 둘을 비우는 코드가 **시작 경로에만** 있고(`recoverPending` → `syncServerIap`), 다 비웠는지 알려 주지 않습니다. 그래서 L2에서 **`flushPendingPurchases()` → `{ ok, left }`** 하나를 만들어 계정 전환 전에 부릅니다(`recoverPending`(withVerify로 감싼 onGrant) → `syncServerIap` 순서, `left === 0`일 때만 `ok`). RevenueCat `Purchases.logIn`도 지금은 시작 때 한 번뿐이라, 계정 전환 흐름에서 직접 다시 부릅니다.

### 5-5. 웹 리다이렉트

웹은 Google 페이지로 갔다 돌아옵니다. 그래서:
- 떠나기 전 save 올리기 + `sessionStorage`에 `authIntent = { mode:'link', ticket }`(충돌 대비 티켓 미리 받음).
- 돌아오면 `detectSessionInUrl: true`(PKCE `?code=`)로 세션 처리 → `authIntent` 보고 이어서 진행. 이미 연결된 계정이면 Supabase가 오류 파라미터로 돌려보냄 → 그때 `signInWithOAuth`로 한 번 더 다녀와 B로 로그인(웹만 두 번 왕복).
- Supabase Redirect URL 허용 목록: `https://gem-guardians.pages.dev/**`, `http://localhost:5173/**`.
- 지금 `createClient`는 `detectSessionInUrl: false`이고 `flowType`이 없어 기본값 `implicit`입니다. 웹 빌드에서만 **`flowType: 'pkce'` + `detectSessionInUrl: true`** 로 바꿉니다(앱 빌드는 그대로).

---

## 6. 계정 삭제

지금 `me-delete`는 "데이터 삭제 요청"(기록만 지우고 익명 계정은 남음)입니다. 로그인이 생기면 **계정 자체 삭제**로 키웁니다. Google Play(계정 만드는 앱은 앱 안 + 웹 삭제 경로 필수)와 App Store(5.1.1(v) 앱 안 계정 삭제 필수) 둘 다 요구합니다.

**화면:** 설정 > 계정 > [계정 삭제] (게스트·연결 계정 모두)
1. 설명: "계정과 모든 진행(층·다이아·아이템), 랭킹 기록이 삭제되고 되돌릴 수 없어요. 결제 기록은 법에 따라 5년 동안 이름 없이 보관돼요. 구독 상품은 없어요."
2. 확인: 입력칸에 `삭제` 입력해야 버튼 켜짐 (실수 방지)
3. 서버 `me-delete` (바뀐 내용):
   - 기존 `me_delete` rpc(결제 익명화·기록 삭제) + `saves`·`save_backups`·`merge_tickets` 삭제
   - **`coupon_tries`·`rate_calls`는 FK가 없어 cascade로 안 지워짐** → 직접 삭제(지금 `me_delete`는 `rate_calls`만 지움)
   - Apple 연결이면 Apple 토큰 취소(§7-3, L4)
   - RevenueCat 고객 삭제(REST `DELETE /v1/subscribers/{id}`, 비밀 키는 서버에만) — 실패해도 진행, 로그만
   - 마지막에 `auth.admin.deleteUser(uid)` (players는 cascade)
4. 기기: 결제 대기열 먼저 비우기 시도(실패해도 삭제는 진행) → 기기 save·cloudMeta·adContinue·auth 지움 → 다시 불러오기(새 게스트, 튜토리얼부터).
- 즉시 삭제(유예 기간 없음). 게임 데이터라 유예가 주는 이득보다 복잡도가 큼.
- **웹 삭제 경로:** `docs/privacy.html` 옆에 `delete-account.html` — "앱 설정 > 계정 > 계정 삭제" 안내 + 앱을 지운 사람용 이메일 요청(플레이어 id 또는 닉네임 적어서). Play 콘솔 "데이터 삭제" URL에 이 주소.

### 6-1. 오래된 게스트 정리

Supabase는 익명 사용자를 자동으로 안 지웁니다. 무료 한도(월 활성 5만)는 넉넉하지만 표가 쌓이니 cron 하나:
**익명 + 180일 동안 접속 없음 + 결제 0건 → 삭제.** (그 사람이 다시 켜면 토큰이 무효 → 새 익명 → 기기 save를 새 id로 올림. 손해 없음.)

---

## 7. 설정할 것 (쑹이 콘솔에서 — 코드 전에)

### 7-1. Google Cloud (프로젝트 `gem-guardians`, RevenueCat 서비스 계정 있는 곳)
1. OAuth 동의 화면: 앱 이름 "Gem Guardians", 지원 이메일, 개인정보처리방침 URL, 범위 `openid`·`email`·`profile`만 → **프로덕션으로 게시**(테스트 상태면 등록된 테스트 사용자 100명만 로그인 가능).
2. OAuth 클라이언트 ID 만들기
   - **웹 애플리케이션**: 승인된 리디렉션 URI = `https://jzpjqfbpqzghprqbqexp.supabase.co/auth/v1/callback`. → 클라이언트 ID·비밀번호를 Supabase에. **앱 플러그인도 이 웹 클라이언트 ID를 씀**(ID 토큰 대상).
   - **Android**: 패키지 `com.teamsdb.gemguardians` + **SHA-1을 서명 키마다 하나씩**: ① debug 키 ② 업로드 키 ③ Play 콘솔 > 앱 무결성 > 앱 서명 키 인증서(Play App Signing). 원스토어 빌드가 같은 키면 추가 없음, 다르면 그 SHA-1도.
   - iOS: L4 때.
### 7-2. Supabase (GemGuardians `jzpjqfbpqzghprqbqexp`만)
1. Authentication > Sign In / Providers > **Google 켜기**: Client IDs에 웹 클라이언트 ID(쉼표로 Android·iOS ID도), Client Secret = 웹 클라이언트 비밀번호. "Skip nonce check"는 끔(플러그인이 nonce 처리).
2. Authentication 설정에서 **Manual linking 켜기**(익명 → 소셜 연결에 필수, 아직 beta 표시).
3. URL Configuration: Site URL `https://gem-guardians.pages.dev`, Redirect URLs `https://gem-guardians.pages.dev/**`, `http://localhost:5173/**`.
4. (권장) 익명 가입 Turnstile CAPTCHA — 웹 공개 후 봇이 익명 계정 찍어내는 걸 막음. 급하지 않음.
5. 저장소 `config.toml`도 같게(지금은 `enable_manual_linking = false`, google 섹션 없음, `site_url = "http://127.0.0.1:3000"`): `enable_manual_linking = true`, `site_url`·`additional_redirect_urls`를 3번과 같게(`localhost:5173`), `[auth.external.google] enabled = true, client_id = "env(...)", secret = "env(...)"` (로컬 테스트용).
### 7-3. Apple (L4, App Store 때)
Apple Developer > Identifiers에 Sign in with Apple 켜기, Services ID·Key(.p8) → Supabase Apple provider. 계정 삭제 때 Apple 토큰 취소가 필요(심사에서 봄): 삭제 직전에 Apple 로그인을 한 번 더 받아 `authorizationCode`를 서버로 → 서버가 토큰 교환 후 `appleid.apple.com/auth/revoke`.

---

## 8. 단계

| 단계 | 하는 것 | 테스트 |
|---|---|---|
| **L1 클라우드 저장** | `saves`·`save_backups`, `save-get/put`, `CloudSave` 서비스, cloudMeta, adContinue를 save로 이동, 시작 판정·디바운스 올리기·서버 save 적용(다시 불러오기), 설정에 "마지막 저장 hh:mm" 한 줄 | 웹 두 탭/두 브라우저는 계정이 달라 못 봄 → 개발 패널 "서버 save 받기/덮기" 버튼과 서버 테스트로 |
| **L2 Google 로그인** | 플러그인, `caps.login`, 계정 팝업, 연결·충돌 화면·merge 티켓·account-merge·로그아웃, 웹 리다이렉트, RevenueCat `logIn` 전환 | 웹(pages.dev / localhost) → Play 내부 테스트 AAB |
| **L3 삭제·정리** | `me-delete` 확장(saves·auth 삭제·RevenueCat), 계정 삭제 화면, `delete-account.html`, 익명 정리 cron, 개인정보처리방침 갱신, Play 데이터 보안 양식(§9) | 삭제 후 재실행 = 새 게스트 |
| L4 iOS | Apple 로그인 + 토큰 취소, iOS 클라이언트 ID | App Store 준비 때 |
| T (선택) | 토스: `toss_key_hash`가 같은 기존 플레이어가 있으면 시작 때 "이전 진행 불러오기" | 토스 출시 때 |

L1·L2는 **Play 비공개 테스트(12명×14일)를 시작하기 전에** 넣는 걸 추천합니다. 테스터가 폰을 바꾸거나 재설치하면 지금은 진행이 사라지기 때문입니다.

**계정 연결 권유:** 설정 말고도 **15층 첫 클리어 때 한 번**, **첫 결제 직후 한 번** 작은 팝업 "진행을 Google 계정에 안전하게 저장할까요?" [연결하기][나중에]. 거절하면 다시 안 띄움.

---

## 9. 바뀌는 신고·문서

### 9-1. Google Play 데이터 보안 (L3 배포 전에 수정)
| 항목 | 바꿀 값 |
|---|---|
| 계정 생성 | **예** — "OAuth(Google)" 선택 + 익명 계정. **계정 삭제 URL** = `delete-account.html` 주소, 앱 안 삭제 경로 있음 |
| 개인 정보 > **이메일 주소** | 수집함 · 공유 안 함 · **선택(사용자가 로그인할 때만)** · 목적: 계정 관리 |
| 개인 정보 > **이름** | 수집함(Google 프로필 이름이 Supabase 인증 기록에 같이 저장됨) · 선택 · 계정 관리. (안 쓰지만 저장되므로 신고하는 쪽이 안전) |
| 앱 활동 > 기타 작업(게임 진행) | 수집함 · 앱 기능 · 필수 (클라우드 저장) |
| 기기 또는 기타 ID / 구매 기록 | 이미 신고한 값 유지(확인만) |
| 보안 | 전송 중 암호화 예, 삭제 요청 가능 예 |

### 9-2. 개인정보처리방침 (`docs/privacy.html`)
수집 항목에 "Google·Apple 로그인 시 이메일·이름(계정 식별용, 표시하지 않음)", "게임 진행 저장 데이터" 추가 / 보관: 계정 삭제 시 즉시 삭제(결제 기록 5년 익명 보관) / 처리 위탁에 Google(로그인) 추가 / 삭제 방법에 앱 경로와 웹 페이지.

### 9-3. App Store (L4)
개인정보 라벨: 연락처 정보 > 이메일(사용자와 연결, 앱 기능), 식별자 > 사용자 ID, 사용 데이터 > 게임 플레이 콘텐츠. 4.8(Apple 로그인), 5.1.1(v)(앱 안 삭제) 충족.

### 9-4. 이용약관 한 줄
"게스트 계정은 기기를 바꾸거나 앱을 지우면 복구할 수 없어요" — 계정 화면에도 같은 문구.

---

## 10. 확인 필요 (구현하면서)

사전 점검(2026-11-13)으로 확인된 것:
- ✓ supabase-js·auth-js **2.119.0**의 `linkIdentity`가 ID 토큰 방식(`{ provider, token, access_token?, nonce? }`)을 지원합니다. `signInWithIdToken`도 `nonce?`를 받습니다.
- ✓ 오류 코드 `identity_already_exists`가 타입에 정의돼 있습니다(`manual_linking_disabled`도 있음).
- ✓ `@capgo/capacitor-social-login` **8.1.0 이상**(최신 8.7.9)이 Capacitor 8과 맞습니다.

남은 것 (실기기에서만 확인 가능):
1. 실제 "이미 연결됨" 응답이 `identity_already_exists`인지 로그로 확인.
2. link 실패 뒤 **같은 ID 토큰으로 signInWithIdToken** 이 되는지(nonce 재사용). 안 되면 Google 창을 한 번 더 띄움.
3. RevenueCat: B로 `logIn` 뒤 비소모성 복원 시 "구매 이전(transfer)" 설정이 기본값(새 사용자로 이전)인지 대시보드에서 확인.
4. 원스토어 단말 중 Google Play 서비스가 없는 경우 — 버튼은 그냥 두고 실패 문구만.
5. DB 실제 저장 크기(Docker 설치 후 로컬 `pg_column_size`) — 급하지 않음.

---

## 11. 쑹이 정할 것 (기본값으로 진행해도 됨)

| # | 질문 | 기본값 |
|---|---|---|
| A-1 | 게스트도 클라우드에 올릴까 | **올림** (코드 단순, 연결 즉시 진행 보존) |
| A-2 | 충돌 화면 추천 쪽 | **최고 층 높은 쪽** |
| A-3 | 두 진행 합치기 | **안 함**, 고르기만 |
| A-4 | 계정 삭제 유예 | **없음(즉시)** |
| A-5 | 연결 권유 시점 | **15층 첫 클리어 + 첫 결제 직후**, 각 1번 |
| A-6 | 게스트 정리 | **180일 미접속 + 결제 0건** 삭제 |
| A-7 | L1·L2 시점 | **Play 비공개 테스트 전** |
| A-8 | `rank:{주}`도 90일 정리 | **함** (서버 PK가 막아 줌, 1년 52개 절약) |
| A-9 | 시작 호출을 `hello` 하나로 합치기 | **함** (무료 호출 한도 때문에 사실상 필수) |

---

## 출처
- Supabase Identity Linking (manual linking, `linkIdentity` ID 토큰 예시): https://supabase.com/docs/guides/auth/auth-identity-linking
- Supabase Anonymous Sign-Ins (전환·충돌 처리 3가지 전략, 익명 정리 SQL, CAPTCHA 권장): https://supabase.com/docs/guides/auth/auth-anonymous
- supabase-js `linkIdentity`: https://supabase.com/docs/reference/javascript/auth-linkidentity
- Capgo Social Login + Supabase Google 설정: https://capgo.app/docs/plugins/social-login/supabase/google/general/
- App Store 심사 지침 4.8, 5.1.1(v) / Google Play 계정 삭제 요구사항 (2026-11 기준 내용, 제출 전 다시 확인)

---

## 12. L1 구현 메모 (2026-11-13)

**시작 판정 변경(L1 결과 판정, §3-4 표를 대신함)**

| 상황 | 동작 |
|---|---|
| 서버에 save 없음 | 기기 save 올림(baseRev 0, owner 갱신) - owner가 달라도 같음 |
| owner 다름 + 서버 save 있음 | 올리지 않고 충돌 팝업(카드 "이 계정" / "이 기기") → 고른 대로 applyServer / forceUpload |
| S == L | dirty면 올림, 아니면 끝 |
| S > L, dirty 아님 | 서버 save 적용 |
| S > L, dirty | 충돌 팝업("다른 기기" / "이 기기") |
| S < L (dirty 상관없음) | 기기 save를 force로 올림(`reason:'rewind'`, `localRev`). 서버는 덮기 전 save를 `save_backups(rewind)`로, `server_log` source `save-rewind`(warn, `{serverRev, localRev}`) |

S < L = DB를 옛 백업으로 복구한 경우라 기기가 더 새것이다.

### 12-운영: 한 사람의 진행을 옛 백업으로 되살리기

rev를 **지금 rev + 1**로 올려서 넣는다. 그래야 S > L이 되어 기기가 다음 시작 때 받아 간다(rev를 그대로나 낮게 넣으면 S ≤ L이라 기기가 다시 덮는다).
```sql
-- 백업 찾기
select id, rev, reason, created_at, data->'bestFloor' as best from public.save_backups
 where player_id = '<플레이어 uid>' order by created_at desc;
-- 되살리기
update public.saves s set data = b.data, rev = s.rev + 1, updated_at = now()
  from public.save_backups b where b.id = <백업 id> and s.player_id = b.player_id;
```
(summary는 같이 바꾸지 않으면 충돌 화면에 옛 값이 보인다 - 필요하면 `summary = public.save_summary(b.data)`도 같이.)

### 12-파일

**서버**
- 마이그레이션 `server/supabase/migrations/20261113000000_saves.sql`: 표 `saves`·`save_backups`(RLS, 정책 없음), `save_summary(jsonb)`·`save_int(jsonb)`·`save_kst_date(timestamptz)`, `save_put(p_player, p_base_rev, p_data, p_device, p_platform, p_app, p_force default false, p_dia_by_key default '{}', p_reason default null, p_local_rev default null)`(p_reason 'rewind' = §12 S < L), `me_delete`에 saves·save_backups 삭제 추가, cron `save-backups-cleanup`(매일 04:37 UTC, 30일).
- 이상치(`server_log` source `save-put`, level warn, 막지 않음): `kind:'diamonds'` = 새 다이아 − 이전 다이아 > (이전 저장 뒤 verified/granted 결제의 상품별 상한 합 + 5000). 상품별 상한 = products.json grant.diamonds × 2(첫 구매 2배), save-put이 `p_dia_by_key`로 넘김. `kind:'bestFloor'` = 새 bestFloor > normal_best + 50(normal_best 없으면 0).
- Edge Functions: `save-get`, `save-put`(분당 6회 - `_shared/ratelimit.ts` `LIMITS`), 본문은 `_shared/save.ts`(`saveGet`·`savePut`·`saveMeta`).
- `_shared/start.ts`: `attStatus`·`mailList`·`claimsPending`·`startInfo` - att-status·mail-list·claims-pending 함수와 hello가 같은 코드. hello 응답에 `save`(메타)·`att`·`mail`(**mail-list 응답 객체 - 예전 숫자 개수 대신**)·`claims` 추가, `features.cloudSave: true` 기본(끄기: `FEATURES='{"cloudSave":false}'`).
- `_shared/ranking.ts` `submitNormal(db, uid, floor)`: rank-normal과 save-put `body.rank`가 같이 씀. `_shared/result.ts`(`fail`·`must`, auth.ts 안 부름 - 테스트용), `_shared/mail.ts` `visibleMail(db, uid)`(db 인자 추가).
- 테스트 `server/supabase/tests/saves_test.ts`(PGlite + supabase-js 흉내 `pgdb`).

**기기**
- `src/net/cloudSave.js` `CloudSave`(`createCloudSave()`로 새로 만들 수 있음 - 테스트용): `init`·`syncOnStart`·`markDirty`·`flush`·`noteRank`·`applyServer`·`applyConflictServer`·`forceUpload`·`status`·`takeLoadedNotice`·`devFakeConflict`, `saveSummary(data)`, `UPLOAD_GAP_MS`.
- `src/game/playerState.js`: `snapshot()`(save()가 씀), `onSaved` 훅, `saveBlocked`(서버 save 적용 → reload 사이 저장 막기), `adContinue`(save 안).
- `src/platform/storage.js`: KEYS에 `locale`(버그 수정)·`cloudMeta`, `storage.remove(key)`.
- 바뀐 키: `adContinue`(save 밖 키) → `gemGuardians.save.v2`의 `adContinue`(첫 실행 때 옮기고 옛 키 삭제). 새 기기 전용 키 `cloudMeta { owner, rev, dirty, syncedAt, lastUploadAt, loadedNotice? }`. 기기 id는 `platform.identity.getUserId()`(= `platformUserId`).
- `src/core/inventory/inventory.js` `pruneGrantedTx(list, todayKst, keepDays = 90)` - main.js가 시작 때 한 번(`startCloudSave`).
- `src/main.js` `startCloudSave()`: 정리 → `CloudSave.init` → 불러옴 토스트 → `inventory.grant` 성공 뒤 `flush('grant')` → `onPause` `flush('pause')` → `serverUi.started` 뒤 `syncOnStart(net.hello.save)`. 층 다음(`advanceFloor`) `flush('floor')`, 메뉴 복귀 `flush('menu')`.
- `src/game/serverUi.js`: `ui.started`(hello → claims → 출석·우편 상태를 hello 값으로), 충돌 팝업 액션 `cloudUseServer`·`cloudUseDevice`. `src/net/api.js` `syncClaims(inventory, pending)`.
- `src/ranking/serverRankingService.js` submit normal: `CloudSave.noteRank` → 다음 save-put에 실음(못 실으면 예전처럼 rank-normal).
- 충돌 팝업: `src/render/mainMenuScreen.js` `openSaveConflict({ bodyKey, titles, server, device })`, 팝업 id `saveConflict`, 문구 `menu.saveConflict.*`(ko/en). 게임 정보 팝업 플레이어 코드 아래 "클라우드 저장 · MM/DD HH:mm" 한 줄.
- 개발 패널: 클라우드 올리기 / 서버 save로 덮기(받기) / rev 충돌 흉내(새로고침).
- 테스트: `tests/cloudSave.test.js`, `tests/pruneGrantedTx.test.js`, `tests/storageKeys.test.js`. 측정: `tools/auth-precheck/measure-save.mjs`(실제 pruneGrantedTx 사용), `count-saves.mjs`(save-put 횟수 추가).

---

## 13. L2 구현 메모 (2026-11-13)

**서버** (`migrations/20261114000000_account.sql`)
- `players.linked text[]`(hello가 요청 JWT 사용자 identities로 갱신 - `_shared/http.ts` Ctx에 `user` 추가, 관리자 API 호출 없음).
- `merge_tickets(ticket, from_player, expires_at, used)`, `player_merges(from_player pk, to_player, keep, at)` - A의 players 줄은 auth.users 삭제 때 cascade로 지워지므로 A -> B 기록은 따로 표에(그래서 `players.merged_into` 열은 만들지 않음).
- `merge_ticket_new(uuid)` -> `{ok, ticket, purchases}`, `account_merge(from, to, keep)`(§4-3 표), `merge_ticket_redeem(ticket, to, keep)`(표 확인 + 옮기기 + used를 한 트랜잭션), `player_resolve(uuid[])`(웹훅용, 여러 번 합쳐져도 따라감). `me_delete`에 merge_tickets 삭제. cron `merge-tickets-cleanup`.
- Edge Functions `account-merge-ticket`(익명 아니면 notGuest), `account-merge`(B가 익명이면 guest, 성공 뒤 `auth.admin.deleteUser(A)`, 실패해도 ok + server_log). `webhook-revenuecat`은 `player_resolve`로 플레이어를 찾음.
- `config.toml`: manual linking, google provider(env), site_url·redirect를 localhost:5173 / pages.dev.

**기기**
- `src/net/account.js` `Account`(`createAccount()`): `state`·`link`·`handleRedirect`·`resumeSwitch`·`signOut`, `maskEmail`.
- `platform.auth { providers, redirect, getIdToken }`, `caps.login`(web·dev `['google']` 리다이렉트, android·onestore `['google']` 플러그인, ios·toss `[]`), `platform.session`(sessionStorage - 웹 리다이렉트 authIntent).
- Capacitor: `@capgo/capacitor-social-login@8.7.9`, `capacitor.config.json` plugins.SocialLogin.providers(google만). `login()`에 scopes를 안 넘김(기본 BridgeActivity에서 scopes를 주면 플러그인이 거절 - email·profile은 기본 포함). nonce = raw를 Supabase에, sha256(hex)를 Google에.
- `src/net/api.js`: 웹 빌드만 `detectSessionInUrl: true, flowType: 'pkce'`, `authClient()`, `refreshSessionUser()`, `net.user`, `net.googleWebClientId`(config/server.json).
- `src/shop/iap.js` `flushPendingPurchases(env)` -> `{ok, left}`(계정 전환 전), `pendingCount()`(+ play.js `iap.pendingCount`). 시작 경로는 `startPendingPurchases(env, ready)`: 미지급 복구(기기 지급)는 바로, 서버 확인(syncServerIap)만 hello 뒤 - 로그인·hello가 16초 넘게(익명 로그인은 타임아웃 없음) 걸릴 수 있어서.
- 빈 게스트(§4-1) = 최고 1층 + 결제 0건(다이아는 안 봄 - 무료 보상뿐).
- Google 버튼 글자: `500 14px Roboto, 'Noto Sans', system-ui, sans-serif`, 높이 40. 번들 Noto Sans는 라틴 Regular뿐 - 한글은 시스템 글꼴.
- `CloudSave.ensureUploaded()`·`hold(v)`(전환 중 다른 계정 id로 이 기기 save를 올리지 않게).
- 화면: 설정 [계정] 줄(`ACCOUNT_BUTTON`, 진동 줄 위), 팝업 `account`·`linkNudge`, 저장 충돌 팝업에 `cancel`·`purchases`·`onPick`(L2: "Google 계정"/"이 기기", [취소], 결제 있으면 서버 쪽 고를 때 안내). Google 버튼 = 공식 PNG(`assets/ui/auth/`, CREDITS.md).
- 연결 권유: `playerState.nudges`(save 안) - `'floor15'`(최고 층 16 이상으로 메뉴 복귀), `'firstPurchase'`(iap: 지급 뒤 메뉴).
- 테스트: `tests/account.test.js`, `server/supabase/tests/account_test.ts`.

---

## 14. L3 구현 메모 (2026-11-15)

**서버**
- `me-delete` = `_shared/account.ts` `deleteAccount`: `me_delete` rpc(기록 삭제 + 결제 익명화 - saves·save_backups·merge_tickets·coupon_tries·rate_calls 포함, 20261114 본문) -> RevenueCat `DELETE /v1/subscribers/{uid}`(`REVENUECAT_SECRET_KEY`가 있을 때만, 실패해도 계속) -> `auth.admin.deleteUser`(players는 cascade) -> server_log. 사용자 삭제가 실패하면 `{ok:false, reason:'error'}`(기기는 데이터를 남기고 다시 시도). Apple 토큰 취소는 L4 자리 주석.
- `purchases.player_id`는 S2부터 `on delete set null` - auth.users 삭제 cascade로 결제 줄이 지워지지 않는다(고칠 것 없음). `ad_views`도 set null.
- 마이그레이션 `20261115000000_account_delete.sql`: `anon_cleanup(p_limit default 500)` = 익명 + `coalesce(last_seen_at, created_at)` 180일 전 + purchases 0줄(어떤 상태든) -> auth.users 삭제, 지운 수를 server_log(`anon-cleanup`). cron `anon-cleanup` 매일 05:13 UTC.
- 테스트 `server/supabase/tests/delete_test.ts`.

**기기**
- `src/net/api.js`: `getSession`·`signInAnonymously`(initNet)와 `call` 안 `getSession`에 8초 상한. 넘으면 hello 없이 오프라인(net.on false). `forgetSession` 삭제.
- `Account.deleteAccount()`: 결제 대기열 비우기 시도(실패해도 진행) -> `me-delete` -> 성공했을 때만 `gemGuardians.save.v2`·`cloudMeta`·`adContinue`·`gemGuardians.auth` 삭제(nudges는 save 안, 설정 키·pendingVerify는 남김) -> 로컬 signOut -> reload. 다시 뜬 첫 화면 토스트는 `platform.session` `accountDeleted`(`Account.takeDeletedNotice`).
- 화면: 계정 팝업 맨 아래 빨간 [계정 삭제] -> 팝업 `deleteAccount`(설명 -> DOM 입력 칸에 "삭제"/"DELETE" -> [삭제] 켜짐). 게임 정보 팝업의 옛 삭제 버튼(`ABOUT_NET.del`, `exitKind 'deleteData'`)과 문구는 없앰. **계정 줄은 서버가 켜져 있으면 모든 빌드에 보인다**(토스·iOS도 앱 안 삭제 경로 필요) - Google 연결 부분만 `caps.login`이 있을 때.
- 웹: `docs/delete-account.html`(ko/en), `docs/privacy.html` 갱신(§9-2). `vite.config.js` 웹 빌드가 두 파일을 dist 루트로 복사 -> `https://gem-guardians.pages.dev/delete-account.html`. 서비스 워커는 게임 페이지(`./`, `index.html`) 이동만 가로챈다(다른 페이지는 그대로).
- 테스트: `tests/account.test.js`(삭제), `tests/netTimeout.test.js`.
- pendingVerify 항목에 `granted`(이 기기에서 이미 지급) 저장. 재확인(syncServerIap) 때 `granted`(예전 항목은 bundle 있음)면 iap-verify·iap-granted로 서버 기록만 하고 다시 지급하지 않는다 - 계정 삭제·계정 전환 뒤 새 save(grantedTx 비어 있음)에 같은 결제가 또 들어가지 않게. 테스트 `tests/pendingVerifyRegrant.test.js`.
