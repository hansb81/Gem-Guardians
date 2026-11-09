# Gem Guardians 게임 서버 구성 계획 v1

작성 2026-11-09 · 설계만 (코드는 쑹이 Claude Code로) · 관련 문서: `plan/ranking/ranking-proposal.md` §13, `plan/platforms/platform-plan.md` §12·§15·§16, `plan/inventory/inventory-proposal.md` §4

---

## 0. 한 줄 요약

**Supabase 프로젝트 1개(서울 리전)** 로 랭킹·결제 기록·출석·보상 지급을 전부 처리합니다. 서버 코드는 Edge Function 몇 개뿐이고, 결제 확인은 **Supabase 표 화면 + RevenueCat 대시보드 + 각 마켓 콘솔**로 봅니다. 따로 관리자 사이트를 만들지 않습니다.

- 서버가 하는 일은 딱 3가지: **① 이 결제가 진짜인지 확인하고 기록 ② 하루 한 번·한 시즌 한 번 같은 보상을 서버 시계로 판정 ③ 순위 계산.**
- 골드·아이템·석상 레벨 같은 **게임 진행은 지금처럼 기기 저장(로컬)** 에 둡니다. 서버는 "지급해도 된다 + txId"만 돌려주고, 실제 지급은 기존 인벤토리 `grant(bundle, {txId})`가 합니다. 중복 방지 구조를 그대로 씁니다.
- 비용: 베타 0원 → 결제 붙이는 시점부터 **월 약 $25 (3.5만 원 안팎)**.

---

## 1. 서버로 옮길 것 vs 기기에 남길 것

| 기능 | 어디서 판정 | 이유 |
|---|---|---|
| 결제 진짜 여부, 결제 기록 | **서버** | 쑹이 "누가 언제 뭘 샀는지" 볼 수 있어야 하고, 가짜 영수증·환불 처리가 필요 |
| 출석체크, 매일 무료, 패스 매일 받기 | **서버 날짜(KST)** | 기기 시계를 돌려 여러 번 받는 꼼수 차단 |
| 보상형 광고 보상 (다이아처럼 값진 것) | 서버 (광고 SDK 서버 콜백) | 광고 안 보고 보상 받는 조작 차단. 골드 정도는 기기 판정도 OK (§8-2) |
| 이벤트 보상, 우편함, 시즌 보상 | **서버** | 기간·대상·1회 수령을 서버가 관리 |
| 랭킹 (일반·경쟁) | **서버** | 남의 기록이 필요하니 당연 |
| 골드·다이아 잔액, 아이템, 석상 레벨, 층 진행 | **기기** (v1) | 서버 권위 지갑은 일이 몇 배. 혼자 운영 단계에선 과함. 대신 서버에 "지급 내역"이 남아 있어 문의 대응·나중 클라우드 저장의 바탕이 됨 |
| 퍼즐·전투 계산 | **기기** | 서버는 점수 상한 검사만 (경쟁 모드 상위권만 재계산은 나중) |

> 기기 저장은 고칠 수 있다는 한계는 받아들입니다. 대신 **돈과 직결되는 것(결제)과 남과 비교되는 것(랭킹·시즌 보상)** 은 서버가 확인합니다.

---

## 2. 어떤 서버를 쓸까 (비교)

| 후보 | 좋은 점 | 아쉬운 점 | 혼자 운영 적합도 |
|---|---|---|---|
| **Supabase** (Postgres + Auth + Edge Functions + pg_cron) | 익명 로그인 기본 제공, SQL로 순위·백분위 한 줄, **표 편집기가 그대로 관리 화면**, 예약 실행(cron) 내장, 서울 리전 | 무료 요금제는 7일간 요청이 없으면 일시정지, 백업은 유료부터 | ★★★ |
| Firebase (Auth + Firestore + Functions) | 익명 로그인→Google/Apple 연결 쉬움, 푸시·분석 같이 | "내 순위 몇 위" 계산이 비쌈, 결제 내역 집계·검색이 불편, Functions는 종량제(Blaze) 필수 | ★★ |
| Cloudflare Workers + D1 | 거의 무료(월 $0~5), 빠름, mTLS 클라이언트 인증서 지원 | 로그인·관리 화면을 직접 만들어야 함 | ★★ (B안) |
| 작은 VPS (Node + Postgres) | 자유도 최고 | 보안 패치·백업·장애 대응 전부 혼자 | ★ |
| Play Games / Game Center 리더보드 | 무료 | 마켓별로 따로, 결제·보상 검증 불가 | 보조용만 |

**추천: Supabase.** 이미 랭킹 설계(§13)가 Supabase 기준이고, 쑹이 원하는 "결제 확인 화면"을 따로 안 만들어도 표 화면 + 저장해 둔 SQL 몇 개로 끝납니다.

- **B안 대비:** 토스 서버 API는 mTLS(클라이언트 인증서)가 필수입니다. Supabase Edge Function(Deno)에서 인증서 호출이 되는지 **S1 단계에서 먼저 확인**하고, 안 되면 토스 호출만 Cloudflare Worker 1개로 빼서 Supabase를 부르게 합니다(§7-4).

---

## 3. 전체 구조

```
 [게임 (웹/토스/안드/원스토어/iOS)]
      │  platform 어댑터 (이미 있음)  +  새 모듈 src/net/api.js
      │  ── 익명 로그인 토큰(JWT) 붙여서 HTTPS ──▶
      ▼
 [Supabase]
   Auth (익명 사용자)         ── users.id = 서버 플레이어 id
   Edge Functions             ── iap-verify / att-claim / rank-* / mail-claim / webhook-*
   Postgres (표)              ── players, purchases, claims, ranking, mail, ...
   pg_cron                    ── 월요일 00:00 KST 정산, 매일 환불 목록 확인, 오래된 기록 정리
      ▲            ▲             ▲
      │            │             └─ 원스토어 서버 API (OAuth client_secret, 서버에만)
      │            └─ 토스 서버 API (mTLS 인증서, 서버에만)
      └─ RevenueCat 웹훅/REST (Google Play + App Store)
```

- 게임은 **Supabase 테이블에 직접 쓰지 않습니다.** 모든 쓰기는 Edge Function을 거치고, 테이블은 RLS(행 권한)로 "본인 것 읽기만" 또는 "아무도 직접 못 씀"으로 막습니다.
- `service_role` 키, 원스토어 `client_secret`, 토스 인증서 개인키, RevenueCat 비밀키는 **Supabase Secrets에만**. 앱·저장소에 절대 넣지 않습니다. 앱에 들어가는 건 Supabase URL + `anon` 키(공개용)뿐.

---

## 4. 플레이어 식별 (계정)

1. 첫 실행 때 서버에 연결되면 **Supabase 익명 로그인** → `auth.users.id`(uuid)가 플레이어 id. 토큰은 platform storage에 저장.
2. 기존 save의 `ranking.profile.playerId`(로컬 uuid)는 첫 로그인 때 서버에 같이 보내 `players.legacy_id`로 남김(문의 대응용).
3. 마켓 계정은 "연결 정보"로만 붙입니다(로그인 수단으로 쓰지 않음, v1).

| 마켓 | 연결하는 값 | 용도 |
|---|---|---|
| Google Play / App Store | RevenueCat `appUserID` = **서버 플레이어 id로 설정** (`Purchases.logIn(id)`) | 웹훅이 누구 결제인지 바로 앎 |
| 원스토어 | `developerPayload`에 productKey + 플레이어 id 앞 8자 (지금은 productKey만 → 바꿈) | 서버 조회 시 대조 |
| 토스 | `User.getAnonymousKey()` 해시 | 토스 쪽 사용자와 연결 |

4. **세이브 공유(D3)는 v1 안 함.** 재설치하면 로컬 세이브와 익명 계정이 둘 다 새로 생깁니다. 대신 비소모성(광고 제거·스타터 팩) 복원은 지금처럼 스토어 복원으로 처리. 클라우드 저장은 §11 S4에서.

### 4-1. 게스트 → 계정 전환 (2026-11-09 쑹 질문)

- Supabase 익명 사용자는 나중에 Google/Apple 로그인을 **연결(linkIdentity)** 하면 **같은 플레이어 id 그대로 정식 계정**이 됩니다. 그래서 게스트 때 한 결제(purchases), 출석, 랭킹 기록이 자동으로 따라옵니다. RevenueCat appUserID도 같은 id라 바꿀 것 없음.
- 단, v1은 골드·다이아·아이템이 **기기 저장**이라, 다른 폰으로 옮기려면 **클라우드 저장(S5)** 이 같이 있어야 합니다. 계정 연결 + 클라우드 저장은 한 묶음으로 S5에서.
  - 클라우드 저장 기본안: `saves(player_id, save jsonb, save_version, updated_at, device)` 1행, 메뉴 복귀·층 클리어 때 업로드, 새 기기 로그인 시 "이 기기 / 서버 저장 중 무엇을 쓸까요?"(층·저장 시각 보여 줌).
- 충돌: 이미 그 Google 계정에 연결된 다른 플레이어가 있으면 연결 실패 → 그 계정으로 로그인 전환 + 게스트 쪽 결제 기록을 서버 함수 `account-merge`가 옮김(`purchases.player_id` 갱신, 비소모성은 다시 복원). 게스트 쪽 로컬 진행은 위 선택 화면으로.
- 그 전(v1)에도 손해 없는 부분: 비소모성(광고 제거·스타터 팩)은 스토어 복원으로 돌아옴. 소모성(다이아)은 폰을 바꾸면 사라지므로 **S5 전까지 설정에 "기기를 바꾸면 진행이 옮겨지지 않아요" 안내**.
- 토스는 토스 계정 자체가 로그인이라 별도 전환 없음(마켓 간 공유는 D3, v1 안 함).

---

## 5. 데이터 모델 (Postgres)

```sql
-- 플레이어
players (
  id uuid primary key references auth.users,
  legacy_id text,                 -- 기존 로컬 playerId
  platform text,                  -- web|toss|play|onestore|ios (마지막 접속)
  nickname text unique,           -- 랭킹 닉네임 (금칙어·중복 서버 검사)
  statue text default 'red',
  toss_key_hash text,             -- 토스만
  created_at timestamptz default now(),
  last_seen_at timestamptz,
  banned boolean default false,
  note text                        -- 쑹 메모 (문의 대응)
);

-- 결제 (마켓 공통 한 표) ★ 쑹이 가장 많이 볼 표
purchases (
  id bigserial primary key,
  player_id uuid references players,
  store text not null,            -- play|ios|onestore|toss
  product_key text not null,      -- config/products.json 키 (dia_small, starter …)
  store_product_id text,
  order_id text not null,         -- 마켓 주문번호 (Play: GPA.xxx, 토스 orderId, 원스토어 purchaseId)
  purchase_token text,            -- 원스토어/Play 토큰 (조회용)
  price_krw int,                  -- products.json 기준 표시 가격 (실매출은 마켓 정산서 기준)
  status text not null,           -- verified|granted|refunded|invalid|pending
  tx_id text not null,            -- 'iap:{product_key}:{order_id}' = 인벤토리 grantedTx와 같은 값
  raw jsonb,                      -- 마켓 응답 원본
  purchased_at timestamptz,
  verified_at timestamptz,
  granted_at timestamptz,         -- 기기가 "지급 완료" 알려 온 시각
  refunded_at timestamptz,
  unique (store, order_id)        -- 같은 주문 두 번 기록 불가 = 서버 쪽 중복 방지
);

-- 하루/한 번짜리 보상 수령 (출석·매일 무료·패스·이벤트·광고·시즌 보상 공통)
claims (
  player_id uuid references players,
  tx_id text,                     -- 'att:2026-11-09', 'free:2026-11-09', 'pass:week:2026-11-09',
                                  -- 'ad:chest:2026-11-09:3', 'event:halloween:day2', 'rank:2026-W45', 'mail:123'
  kind text,                      -- att|free|pass|ad|event|rank|mail
  bundle jsonb,                   -- 서버가 정한 지급 내용 {dia:50} 등
  claimed_at timestamptz default now(),
  granted_at timestamptz,         -- 기기 지급 확인 (없으면 다음 실행 때 다시 내려줌)
  primary key (player_id, tx_id)
);

-- 출석 진행
attendance (
  player_id uuid primary key references players,
  cycle_id text,                  -- 출석판 회차 (예: 'm2026-11' 월간판 또는 'c3' 7일판 3회차)
  days int default 0,             -- 이번 판에서 받은 날 수
  last_date date                  -- 마지막으로 받은 KST 날짜
);

-- 이벤트·우편함 (쑹이 표 화면에서 한 줄 추가하면 지급됨)
events (id text primary key, title_ko text, title_en text, starts_at timestamptz,
        ends_at timestamptz, rules jsonb, enabled boolean)
mail (id bigserial primary key, player_id uuid null,   -- null = 전체 발송
      title_ko text, title_en text, bundle jsonb, expires_at timestamptz, created_at timestamptz)

-- 보상 광고 서버 확인 (AdMob SSV 콜백)
ad_views (transaction_id text primary key, player_id uuid, placement text,
          reward_item text, at timestamptz)

-- 랭킹: ranking-proposal §13-2 그대로 (normal_best, comp_best, comp_runs, season_results)
-- players 표가 위로 합쳐지므로 §13-2의 players는 생략

-- 운영 기록 (웹훅 원본 등, 90일 보관)
server_log (id bigserial, at timestamptz default now(), source text, level text, body jsonb)
```

**txId 규칙은 인벤토리 §4 표와 똑같이** 씁니다. 서버 `claims`/`purchases`의 tx_id = 기기 `grantedTx` 값. 그래서 서버가 같은 보상을 두 번 내려줘도 기기에서 무시되고, 기기가 두 번 요청해도 서버 primary key에서 막힙니다(양쪽 다 중복 방지).

---

## 6. API 목록 (Edge Functions)

모든 호출은 `Authorization: Bearer <익명 로그인 JWT>`. 응답 모양은 인벤토리와 맞춰 `{ ok, reason?, ... }`.

| 함수 | 입력 | 하는 일 · 돌려주는 것 |
|---|---|---|
| `POST /hello` | platform, appVersion, legacyId | players 생성/갱신, **서버 시각·KST 날짜**, 받을 보상 목록(미지급 claims·우편 개수), 기능 스위치(`features`) |
| `POST /iap/verify` | store, productKey, orderId/purchaseToken | 마켓에 확인 → purchases 기록 → `{ ok, txId, bundle }` |
| `POST /iap/granted` | txIds[] | 기기가 지급 끝냈다고 알림 → granted_at 기록 |
| `GET /claims/pending` | – | 서버에 기록됐지만 기기가 아직 지급 안 한 것들 (앱이 중간에 죽은 경우 복구) |
| `POST /claims/granted` | txIds[] | 위와 같은 지급 확인 |
| `POST /att/claim` | – | 서버 KST 날짜로 오늘 출석 판정 → `{ ok, day, bundle, txId }` 또는 `reason:'already'` |
| `GET /att/status` | – | 이번 판 진행·오늘 받았는지·다음 보상 |
| `POST /daily/claim` | kind (`free`/`pass:week`…) | 매일 무료·패스 매일 받기, 같은 방식 |
| `POST /ad/nonce` | placement | 광고 보기 전 1회용 값 발급(SSV custom_data에 넣음) |
| `POST /ad/claim` | nonce | SSV 콜백이 도착했으면 보상, 하루 한도 확인 |
| `POST /webhook/admob-ssv` | (Google이 호출) | 서명 확인 → ad_views 기록 |
| `POST /webhook/revenuecat` | (RevenueCat이 호출) | 헤더 비밀값 확인 → 구매 기록·환불 표시 |
| `GET /mail` · `POST /mail/claim` | id | 우편함 목록·수령 |
| `GET /events` | – | 진행 중 이벤트 (메뉴 왼쪽 위 이벤트 버튼) |
| `/rank/*` | – | ranking-proposal §13-3 그대로 (profile, normal, comp/start, comp/finish, top, me, result, claim) |

**지급 흐름 (모든 보상 공통)**

```
기기: 요청 (예: att/claim)
서버: 판정 → claims에 기록 → { txId, bundle } 응답
기기: inventory.grant(bundle, { src:'attendance', txId }) → 저장 → 공통 획득 팝업
기기: claims/granted 로 확인 보냄 (실패해도 괜찮음: 다음 /hello 때 pending으로 다시 오고, txId라 중복 안 됨)
```

---

## 7. 결제 확인 (마켓별)

공통 원칙: **기기에서 결제 성공 → 서버 `iap/verify` → 서버 OK일 때만 grant**. 서버가 꺼져 있거나 오프라인이면? → 지금처럼 기기 지급은 하되(손님이 돈 내고 못 받는 게 최악) `pendingVerify` 목록에 남겨 연결되면 서버에 보냄. 서버가 나중에 `invalid` 판정하면 기록만 남기고 회수는 안 함(v1). 즉 **v1의 서버 확인은 "막기"보다 "기록·추적"이 주목적**이고, 가짜 영수증이 실제로 보이면 그때 "서버 OK일 때만 지급"을 켭니다(`features.iapStrict`).

### 7-1. Google Play · App Store (RevenueCat)

- 앱: `Purchases.configure` 직후 `Purchases.logIn(서버 플레이어 id)`.
- 서버 확인 방법 2가지, **둘 다 RevenueCat이 스토어 검증을 이미 해 준 결과**를 받는 것:
  - **REST 조회 (기본, 요금제 무관):** `iap/verify`가 RevenueCat REST `GET /v1/subscribers/{app_user_id}` (비밀 API 키)로 `non_subscriptions`에서 해당 거래를 찾음 → 있으면 verified.
  - **웹훅 (보너스):** `NON_RENEWING_PURCHASE`(소모성·비소모성 구매), `CANCELLATION`(환불 포함, `cancel_reason`) 이벤트를 받아 기록. 기기가 verify를 못 보내고 죽어도 서버에 결제가 남습니다. 인증은 대시보드에서 정한 Authorization 헤더 값 비교, 이벤트 `id`로 중복 제거, 60초 안에 200 응답. **웹훅은 RevenueCat Pro 플랜 기능**이라고 문서에 적혀 있어 무료 구간 포함 여부는 가입 때 확인(§13).
- 환불: 웹훅 `CANCELLATION` 또는 매일 cron 조회 → `purchases.status = refunded`. 기기 회수는 기존 결정대로 **adFree만** (다음 `/hello`에 `revoke:['adFree']`).

### 7-2. 원스토어

- 서버만 `client_id/client_secret`으로 OAuth 토큰 발급(`POST /v7/oauth/token`, 1시간짜리, 캐시) — **비밀값은 Supabase Secrets에만** (§16 판정 그대로).
- `iap/verify`: `GET /v7/apps/{clientId}/purchases/inapp/products/{productId}/{purchaseToken}` → `purchaseState == 0`이고 `developerPayload`가 맞으면 verified.
- 소비/확인(acknowledge)은 **지금처럼 기기 SDK가 지급 후에** 함(3일 내 안 하면 자동 환불). 서버 쪽 acknowledge API도 있으니 나중에 "서버 지급" 모드에서 사용 가능.
- 환불: 푸시 알림은 문서에서 못 찾음 → **매일 cron이 `GET /v7/apps/{clientId}/voided-purchases`**(최대 1개월 범위)로 환불 목록을 받아 표시. 이걸로 §16-6 "원스토어 환불 회수 없음"이 해결됨.
- 테스트 서버 `sbpp.onestore.net` / 운영 `iap-apis.onestore.net`, 헤더 `x-market-code: MKT_ONE`.

### 7-3. 토스 미니앱

- 서버 API는 **mTLS 필수**: 콘솔(개발 > mTLS 인증서)에서 인증서·개인키 발급 → 서버에만 보관.
- `iap/verify`: `POST https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/order/get-order-status` {orderId} → `PURCHASED`/`PAYMENT_COMPLETED`면 verified, `REFUNDED`면 환불 표시. 실패도 HTTP 200 + `resultType: FAIL`이라 반드시 그 값을 확인.
- 토스 쪽 결제/환불 웹훅은 문서에서 못 찾음 → 환불은 매일 cron이 최근 30일 토스 주문을 다시 조회(주문 수가 적을 때 충분, 분당 3,000회 한도).
- 기기 흐름은 그대로: `processProductGrant` 안에서 verify → grant → true 반환.

### 7-4. mTLS가 Supabase에서 안 될 때 (B안)

Cloudflare Worker 1개(`toss-proxy`)에 토스 인증서를 mTLS 바인딩으로 넣고, Supabase가 비밀 헤더로 이 Worker를 부르게 함. 무료 구간 안. 토스 출시는 Play·원스토어 다음이라 그때 결정해도 늦지 않습니다.

> **2026-11-09 시험 결과: B안 필요 없음.** Edge Function에서 `Deno.createHttpClient({ cert, key })`로 mTLS 확인 사이트(certauth.cryptomix.com)를 불러 클라이언트 인증서가 서버에 도착하는 것을 확인(Supabase Edge Runtime 1.77.9 / Deno 2.1.4). 시험 함수는 지움.

### 7-5. 웹

결제 없음(caps.iap=false). 서버는 랭킹·출석만.

### 7-6. S3·S4 켜기 전에 넣을 값 (쑹이 따라 할 순서)

프로젝트 주소 = `https://jzpjqfbpqzghprqbqexp.supabase.co` (아래 `<ref>` = `jzpjqfbpqzghprqbqexp`).

**1단계 — cron 비밀값 만들기**
비밀번호 관리자에서 임의 문자열(40자 정도, 영문·숫자)을 하나 만들어 `GemGuardians CRON_SECRET`으로 저장. 2·3단계에 같은 값을 두 번 넣습니다.

**2단계 — Supabase Secrets (Edge Function이 읽는 값)**
대시보드 → Edge Functions → **Secrets** → Add new secret, 한 줄씩:

| 이름 | 값 |
|---|---|
| `CRON_SECRET` | 1단계 값 |
| `ONESTORE_CLIENT_ID`, `ONESTORE_CLIENT_SECRET` | 원스토어 개발자센터 → 앱 → 라이선스 관리 |
| `ONESTORE_ENV` | 처음엔 `test`(검증 서버), 출시 때 `prod` |
| `TOSS_MTLS_CERT`, `TOSS_MTLS_KEY` | 앱인토스 콘솔 → 개발 → mTLS 인증서 zip의 `_public.crt` / `_private.key` **파일 내용 전체**(`-----BEGIN`부터 `END-----`까지) |

여러 줄짜리 인증서가 대시보드 칸에 잘 안 들어가면 Git Bash에서:
`npx supabase secrets set --project-ref <ref> TOSS_MTLS_CERT="$(cat 이름_public.crt)" TOSS_MTLS_KEY="$(cat 이름_private.key)"`

**3단계 — Supabase Vault (pg_cron이 함수 주소·비밀값을 읽는 곳)**
대시보드 → SQL Editor → New query → 아래를 붙이고 두 번째 줄 따옴표 안을 1단계 값으로 바꾼 뒤 Run:
```sql
select vault.create_secret('https://jzpjqfbpqzghprqbqexp.supabase.co', 'project_url');
select vault.create_secret('여기에 1단계 값', 'cron_secret');
```
확인: `select name from vault.decrypted_secrets;` → `project_url`, `cron_secret` 두 줄.
값을 바꿀 때(같은 이름으로 create 하면 오류): `select vault.update_secret((select id from vault.secrets where name = 'cron_secret'), '새 값');` — 2단계 `CRON_SECRET`도 같이 바꿔야 함.

**4단계 — 확인 (마이그레이션 반영 뒤)**
- `select jobname, schedule from cron.job;` → `onestore-voided`(0 19 * * *), `toss-recheck`(17 * * * *), `comp-settle`(31 15 * * 0) 포함.
- 손으로 한 번: `select public.cron_call('settle');` → 몇 초 뒤
  `select at, source, level, body from server_log where source like 'cron-%' order by id desc limit 5;` → `cron-settle` / `info` 줄이 보이면 연결 성공.
  `warning: vault project_url/cron_secret 없음`이 나오면 3단계, `server_log`에 아무것도 없으면 2단계 `CRON_SECRET`이 3단계 값과 다른지 확인.
- `onestore`·`toss`는 2단계 마켓 값을 넣은 뒤에만 돌리기(원스토어는 `ONESTORE_ENV=test`부터).

**5단계 — AdMob (보상형 광고 배치를 정한 뒤)**
AdMob 콘솔 → 앱 → 광고 단위(보상형) → 서버 측 확인 → URL `https://jzpjqfbpqzghprqbqexp.supabase.co/functions/v1/webhook-admob-ssv` → 확인(Verify URL) → 저장.

---

## 8. 출석체크 · 보상 광고 · 이벤트

### 8-1. 출석

- 날짜 = **서버 시각 KST 기준**(매일 00:00 KST 갱신, 랭킹 시즌 기준과 같음). 기기 시계는 표시용으로만.
- 규칙 기본안(바꿔도 됨): **7일판 반복**, 하루 1칸, 빠진 날은 그냥 다음 칸(연속 끊김 벌칙 없음 = 캐주얼 친화), 7일째 큰 보상 후 1일로. 보상표는 `config/attendance.json` → 서버에도 같은 표 복사(랭킹 보상표와 같은 방식).
- 판정 SQL 한 번: `last_date < today_kst`일 때만 `days+1`, claims에 `att:{today}` 삽입(중복이면 거절) — 같은 트랜잭션.
- 오프라인이면 버튼에 "연결이 필요해요". 서버 없는 단계(웹 베타)에서는 출석 버튼을 **잠그거나** 기기 시계로 돌리되 보상을 골드 소량으로만(§11 S0).

### 8-2. 보상형 광고 (배치 기획은 아직, 서버 쪽 자리만)

- 값진 보상(다이아·부활): **AdMob 서버 측 확인(SSV)** — 광고 요청에 `custom_data = /ad/nonce 값`, `user_id = 플레이어 id`를 넣으면 Google이 우리 `webhook/admob-ssv`를 서명과 함께 호출 → 확인 후 `ad/claim`이 보상.
- 싼 보상(골드 소량, 쿨다운 줄이기): 기기 판정 + 서버 없이 하루 한도만. 서버 부담·지연을 줄임.
- 하루 한도는 서버 `claims`(kind=ad) 개수로 셈. adFree 보유자는 광고 없이 바로 `ad/claim`(서버가 purchases에서 adFree 확인).
- 토스 광고의 서버 확인 지원 여부는 미확인 → 토스는 기기 판정 + 하루 한도.

### 8-3. 이벤트 · 우편함

- 쑹이 Supabase 표 화면에서 `events`/`mail`에 한 줄 추가 = 배포 없이 이벤트·보상 발송. 점검 사과 보상, 문의 보상(특정 player_id)도 이걸로.
- 이벤트 문구는 ko/en 두 칸.

---

## 9. 랭킹 (ranking-proposal §13에서 바뀌는 점만)

- players 표를 공통으로 합침(§5). 닉네임 금칙어·중복 검사는 `rank/profile`.
- 일반 모드 `rank/normal`: 서버가 이전 값보다 높을 때만 갱신 + **층 상승 속도 상한**(예: 가입 후 경과 시간 대비 최대 층) 넘으면 `hidden=true`로 숨김.
- 토스: 토스 리더보드(보드 1개)를 그대로 쓰고, 우리 서버 랭킹에는 **토스 사용자를 넣지 않음**(v1). 토스 안에서 우리 랭킹 팝업은 "토스 랭킹 보기" 버튼만 동작.
- 정산 cron(월 00:00 KST = 일 15:00 UTC), 보상 지급은 `claims`의 `rank:{seasonId}`로 통일.
- 참여 보상 골드(`goldFloorMul`) = 배수 × 그 시즌 최고 판 층의 골드 기준가. 서버 표 `functions/_shared/floor_gold.json`(1~300층, 넘으면 300층 값)은 `node tools/gen_floor_gold.mjs`로 생성 — 밸런스 config를 바꾸고 다시 안 돌리면 `tests/iap.test.js`가 실패(§22 C3-5).

---

## 10. 쑹이 보는 관리 화면

새 사이트를 만들지 않고 이렇게 봅니다.

| 보고 싶은 것 | 어디서 |
|---|---|
| 오늘/이번 달 결제 목록, 누가 뭘 샀나 | Supabase 표 편집기 → `purchases` (최근순 정렬 저장) 또는 저장한 SQL "오늘 결제" |
| 마켓별 매출 합계 | 저장 SQL `v_sales_daily` (store × 날짜 × 합계). **실제 정산액은 각 마켓 정산서가 기준** (수수료·부가세·환율 차이) |
| Play·App Store 매출 그래프, 환불 | **RevenueCat 대시보드** (무료로 이미 제공) |
| 원스토어·토스 | 원스토어 개발자센터 판매 현황, 앱인토스 콘솔 |
| 문의 대응: "결제했는데 안 들어왔어요" | 문의자 설정 화면의 **플레이어 코드**(id 앞 8자, 설정 > 게임 정보에 표시)로 `purchases`·`claims` 검색 → granted_at 비었으면 `mail`로 재지급 |
| 출석·광고 지급 현황 | `claims` (kind별 저장 SQL) |
| 이상 기록 | `server_log` level=warn, 랭킹 hidden 목록 |

**알림(선택):** 결제 1건마다 또는 하루 요약을 쑹의 디스코드/텔레그램 웹훅으로 보내는 함수 1개. 출시 초기에 "결제 들어왔다"를 바로 알 수 있어 추천(무료).

---

## 11. 단계 (출시 순서에 맞춤)

| 단계 | 언제 | 하는 것 | 서버 비용 |
|---|---|---|---|
| **S0** | 지금~웹 베타 | 서버 없음. `src/net/api.js` 자리와 `features.server=false`만. 출석 버튼은 "준비 중" 또는 기기 시계 + 골드 소량 | 0 |
| **S1** | 웹 베타 중 | Supabase 생성(서울), 익명 로그인, `/hello`, 출석, 랭킹(일반 모드) 실서버 + 우편함. `fakeBoard:false` | 무료 |
| **S2** | **Play 결제 켜기 전** | purchases 표, RevenueCat `logIn` + `iap/verify` + 웹훅, `claims/pending` 복구, 결제 알림. **무료 유지 + 직접 백업·깨우기**(§13-1). Pro는 매출이 월 $25를 넘을 때 | 0 (→ $25/월) |
| **S3** | 원스토어 출시 전 | 원스토어 서버 조회 + 매일 환불 목록 cron | – |
| **S4** | 토스 출시 전 | 토스 mTLS 조회(안 되면 §7-4), 경쟁 모드 + 시즌 정산·보상(rewardsEnabled:true), AdMob SSV | – |
| S5 (나중) | 필요해지면 | 게스트→계정 전환(§4-1) + 클라우드 저장 한 묶음, account-merge, 서버 권위 다이아 | – |

> 결제 기록 서버(S2)는 **Play 첫 유료 상품 출시 전에** 있어야 합니다. 나머지는 없어도 출시 가능.

---

## 12. 기존 코드와 연결

- 새 모듈 **`src/net/api.js`**: fetch 래퍼(타임아웃 8초, 재시도 1회, 오프라인 큐), 토큰 보관은 `platform.storage`. 게임 코드는 서비스만 부름.
- **`RankingService`**: `Local → Server`로 교체 (함수 모양 그대로, Promise). `config/ranking.json` `fakeBoard:false`.
- **결제 어댑터**: 각 어댑터의 `onGrant(productKey, orderId)` 콜백 안에서 `IapService.verify()` → grant. pendingPurchase(§15)는 유지하고, 서버가 있으면 `claims/pending`이 한 겹 더 지켜 줌.
- **새 서비스** `AttendanceService`, `MailService`, `AdRewardService` — 다 `{ ok, reason, txId, bundle }` 돌려주고 지급은 인벤토리 `grant`.
- **config** `config/server.json`: `{ enabled, url, anonKey, features: { iapStrict:false, attendance:true, mail:true, compRanking:false, adSsv:false } }`. `/hello` 응답의 features가 덮어씀 → **배포 없이 기능 끄기 가능**(문제 생기면 서버에서 끔).
- 토스 빌드는 외부 링크 금지지만 **API 호출(fetch)은 별개**. 다만 토스 심사에서 외부 서버 통신 도메인을 묻는지 확인 필요(§14).
- 저장소 구조: `server/supabase/migrations/*.sql`, `server/supabase/functions/*` (Supabase CLI). 게임 빌드(Vite)와 분리. 비밀값 파일은 `.gitignore`.

---

## 13. 비용 추정 (2026-11 기준, 가입 때 다시 확인)

| 항목 | 금액 | 메모 |
|---|---|---|
| Supabase Free | $0 | DB 500MB, 월 활성 5만 명, Edge Function 50만 회. **7일 동안 요청 없으면 일시정지** → 베타 중엔 사용자 있으니 OK |
| Supabase Pro | **$25/월** | 결제 붙일 때부터. 일일 백업, 일시정지 없음, DB 8GB. 이 게임 규모(DAU 수천)는 Pro 기본 포함량 안 |
| RevenueCat | 월 매출 $2,500까지 무료(으로 알려짐), 이후 매출의 1% | 웹훅이 무료 구간에 포함되는지 확인. 안 되면 REST 조회만으로 운영 가능(§7-1) |
| Cloudflare Worker (B안) | $0 | 무료 하루 10만 요청 |
| 도메인 (개인정보처리방침·이용약관·삭제 요청 페이지) | 연 1~2만 원 | GitHub Pages면 0원 가능 |
| 합계 | 베타 0원 / 출시 후 **월 약 3.5만 원** | |

### 13-1. 무료로 계속 운영하기 (2026-11-09 쑹 질문 반영 — 기본안)

무료로도 됩니다. 무료 요금제에서 빠지는 건 두 가지라 이렇게 메웁니다.

| 무료에서 빠지는 것 | 메우는 법 (0원) |
|---|---|
| 7일 동안 요청이 없으면 일시정지 | 게임 사용자가 있으면 해당 없음. 그래도 GitHub Actions 예약 작업이 하루 1번 `/ping`(JWT 없음, DB 한 번)을 부르게 함 — §20-12 |
| 자동 백업 없음 | GitHub Actions 주 1회 `supabase db dump` → 암호화(age/gpg) 후 비공개 저장소나 쑹 구글 드라이브에 보관. 결제는 RevenueCat·각 마켓 콘솔에도 원본이 있어 DB를 잃어도 다시 맞출 수 있음 |

- 그 외 한도(DB 500MB, 월 활성 5만 명, 함수 50만 회)는 이 게임 초기 규모에 충분.
- 무료 프로젝트는 계정당 2개 → **운영 1개 + 테스트 1개**로 딱 맞음(로컬은 `supabase start`).
- Pro로 넘어갈 신호: 월 매출이 $25를 넘거나, 활성 사용자 3만 명 이상, 또는 일시정지·용량 경고가 처음 뜰 때.

용량 감: 플레이어 1명당 수 KB(출석·결제·랭킹 기록). 10만 명이어도 수백 MB.

**백업 복원** (`.github/workflows/server-backup.yml`, 매주 + Actions 탭 Run workflow로 수동. 암호 문구는 GitHub Secrets `BACKUP_PASSPHRASE`와 쑹 비밀번호 관리자 둘 다에 보관 — §20-13)

1. GitHub → Actions → server-backup → 실행 하나 → Artifacts `db-backup` 내려받기(zip) → 풀면 `backup-YYYYMMDD.tar.gz.gpg`
2. 복호화·풀기: `gpg -d backup-YYYYMMDD.tar.gz.gpg | tar xz` (암호 문구 입력) → `roles.sql`, `schema.sql`, `data.sql`
3. 로컬에 복원(시험): `cd server/supabase && supabase start` 후
   `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f roles.sql -f schema.sql -c "SET session_replication_role = replica" -f data.sql`
   (`session_replication_role = replica` = 외래키·트리거를 잠시 끄고 데이터 넣기. 이미 있는 표와 겹치면 `supabase db reset` 대신 빈 DB에서)
4. 확인: `select count(*) from purchases; select * from v_sales_daily limit 5;`

---

## 14. 개인정보 · 사업자 관련

서버에 사용자 데이터를 저장하는 순간 생기는 일입니다. (법률 자문 아님, 등록 전에 확인)

1. **개인정보처리방침에 추가**: 수집 항목(기기 무관 랜덤 id, 닉네임, 결제 기록[주문번호·상품·시각], 출석·보상 기록, 접속 시각, IP 로그), 목적, 보관 기간, **처리 위탁·국외 이전**(Supabase Inc.(미국) — 서버는 서울 리전이어도 회사가 해외라 적어 두는 게 안전, RevenueCat Inc.(미국), Cloudflare(B안), 각 마켓).
2. **보관 기간**: 전자상거래법상 **대금 결제·재화 공급 기록 5년**. 그래서 탈퇴·삭제 요청이 와도 `purchases`는 player 연결만 끊고(익명화) 5년 보관, 나머지는 삭제.
3. **데이터 삭제 요청 경로**: Google Play는 계정을 만드는 앱에 앱 안 + 웹 삭제 요청 경로를 요구합니다. 익명 id라도 닉네임을 받으니 **설정 > "내 데이터 삭제 요청"** 버튼 + 웹 페이지(폼 또는 메일)를 두는 걸 추천. 서버 함수 `POST /me/delete`.
4. **만 14세 미만**: 닉네임 외 개인정보를 안 받으면 부담이 적음. 이메일·전화번호는 받지 않는 설계 유지.
5. **사업자등록(D1)**: 결제 기록 서버(S2)와 같은 시점 = **Play 유료 기능 전**. 통신판매업 신고도 같이 검토. 개인정보처리방침의 "개인정보 보호책임자"에 사업자 정보 표기.
6. Play 데이터 보안 양식 / App Store 개인정보 라벨 / 토스 심사 항목에 위 수집 항목을 똑같이 적기.

---

## 15. 부정 방지 기본 (요약)

| 위험 | 막는 법 |
|---|---|
| 기기 시계 돌려 출석 여러 번 | 서버 KST 날짜, `claims` primary key |
| 같은 영수증 재사용 | `purchases unique(store, order_id)` + 마켓 조회 |
| 가짜 영수증 | 마켓 서버 조회. 실제 피해 보이면 `iapStrict:true` |
| 같은 요청 연타 | txId 양쪽 중복 방지, 함수 안에서 한 트랜잭션 |
| 랭킹 조작 | 층·시간 상한, 경쟁 모드 상위권 재계산(나중), 1~10위 정산 전 수동 확인, `banned` |
| 광고 안 보고 보상 | AdMob SSV 서명 확인 + nonce 1회용 |
| 비밀키 유출 | 앱엔 anon 키만, RLS로 직접 쓰기 차단, 비밀값은 Secrets |
| 서버 과부하·요금 폭탄 | 함수마다 플레이어당 분당 호출 제한(간단히 `server_log` 카운트), Supabase 사용량 알림 켜기 |

---

## 16. 쑹이 정할 것

| # | 질문 | 추천 |
|---|---|---|
| S-1 | 서버 종류 | **Supabase** (서울 리전) |
| S-2 | 출석 방식 | **7일판 반복, 빠져도 안 끊김**, 7일째 큰 보상 |
| S-3 | 웹 베타의 출석 | 서버(S1) 전엔 **"준비 중"으로 잠금** (나중에 기기 기록과 섞이지 않게) |
| S-4 | 결제 서버 확인이 실패할 때 | v1은 **기기 지급 + 서버에 기록만**(`iapStrict:false`), 문제 생기면 켬 |
| S-5 | 결제 알림 받을 곳 | 디스코드 또는 텔레그램 중 쓰는 것 |
| S-6 | 토스 사용자를 공통 랭킹에 넣을지 | **v1 안 넣음** (토스 리더보드 사용) |

---

## 17. 확인 필요 (불확실)

1. ~~Supabase Edge Function(Deno)에서 클라이언트 인증서(mTLS)로 외부 호출 가능한지~~ → **됨**(2026-11-09, §7-4).
2. RevenueCat 웹훅이 무료 구간에 포함되는지, 현재 요금 구조.
3. 원스토어·토스 결제/환불 **서버 푸시 알림** 유무 (문서에서 못 찾음 → 지금 설계는 매일 조회).
4. 토스 광고 SDK 보상 서버 확인 지원 여부, 토스 심사에서 외부 API 도메인 신고 필요 여부.
5. 개인정보 국외 이전 표기 범위(서울 리전 + 해외 법인) — 개인정보처리방침 작성 때 확인.
6. Supabase 무료/Pro 정확한 한도 (요금표는 자주 바뀜).

## 18. 출처

- 앱인토스 서버 API(mTLS·도메인·IP·한도): https://developers-apps-in-toss.toss.im/documentation/integration/server-api
- 앱인토스 IAP 주문 상태 조회: https://developers-apps-in-toss.toss.im/documentation/api/iap
- 원스토어 인앱결제 서버 API V7: https://onestore-dev.gitbook.io/dev/tools/billing/v21/serverapi
- RevenueCat 웹훅·이벤트: https://www.revenuecat.com/docs/integrations/webhooks , https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
- Supabase 요금 정리(2026): https://designrevision.com/blog/supabase-pricing.md , https://automationatlas.io/answers/supabase-free-tier-limits-2026/

---

## 19. 프롬프트 A 결과 판정 (2026-11-09)

| # | 구현에서 정한 것 | 판정 |
|---|---|---|
| 1 | 우편함 = 메뉴의 기존 우편 버튼, 이벤트 버튼은 빈 팝업 | **수용.** 이벤트 팝업은 이벤트 API를 만들 때 같이 |
| 2 | 출석 보상 임시값 (다이아 10/염료 1/다이아 15/망치 1/다이아 20/섞기 1/다이아 50+무지개 1) | **임시로 수용.** 주당 다이아 95개는 상점 다이아 가격과 맞춰 봐야 함 → 밸런스 작업 때 확정. 값은 config/attendance.json 한 곳에서만 바꾸게 유지 |
| 3 | 데이터 삭제 후 익명 세션 버림 + 개인 우편 삭제 | **수용.** purchases는 S2에서 player 연결만 끊고 5년 보관(§14-2) |
| 4 | 랭킹 도달 시각 = 서버 now() | **수용** |
| 5 | rank-top에 남의 player id 안 넣음 | **수용** |
| 6 | 서버 전 닉네임은 첫 서버 랭킹 때 올림, 중복·금칙어면 비우고 다시 고르게 | **수용 + 보완:** 다시 고르는 팝업에 이유 한 줄("이미 쓰는 이름이에요" / "쓸 수 없는 단어가 있어요") |
| 7 | 오프라인 기록 큐 없음, rank-me 때 기기 기록이 높으면 재전송 | **수용** |
| 8 | 시작 시 미지급 복구는 팝업 없이 조용히 | **보완:** 팝업은 없어도 되지만 **토스트 한 줄**("받지 못한 보상을 받았어요")은 띄움. S2부터 결제 복구도 이 길로 오니, 손님이 다이아가 늘어난 이유를 알아야 문의가 줄어듦 |
| 9 | 날짜 바꾸기 시험 기능은 실제 함수에 없음, 테스트에서만 | **수용** |
| 10 | 출석 아이템 아이콘 = 회색 자리표시 | **변경:** 망치·염료·섞기 부적·무지개 결정은 **하단 바 아이템 아이콘이 이미 있음**(gem-guardians-items.zip, 2차 포함) → 그걸 그대로 씀. 없는 것만 알려 주면 그림 |
| 11 | 안 넣은 것: 층 상승 속도 상한, 분당 호출 제한, 이벤트 API, 우편함 스크롤(6통) | **지금은 수용.** 기한: 속도 상한 = 서버 랭킹을 일반 사용자에게 공개하기 전 / 호출 제한 = S2(결제) 전 / 우편함 스크롤 = 전체 우편을 처음 보내기 전 / 이벤트 API = 첫 이벤트 때 |

---

## 20. 프롬프트 B 결과 판정 (2026-11-09)

| # | 구현에서 정한 것 | 판정 |
|---|---|---|
| 1 | store 이름 play/ios/onestore/toss/dev, products.json 키 android ↔ play 변환, 실제 키 dia.0 | **수용** |
| 2 | revoke + revokeOrders, 그 주문으로 받은 adFree만 한 번 회수, 다시 산 adFree가 살아 있으면 안 보냄 | **수용** (계획보다 정확함) |
| 3 | 서버 bundle은 안 쓰고 기기 상점 규칙(첫 구매 2배)으로 지급 | **수용 + 보완:** `iap-granted`에 기기가 실제로 지급한 bundle을 같이 보내 purchases에 저장. 문의 때 "몇 개 받았나"를 서버에서 볼 수 있게 |
| 4 | 이미 확인된 내 주문은 RevenueCat 재조회 없이 ok | **수용.** 단 refunded 상태면 ok 주지 않음(확인만) |
| 5 | pendingVerify는 다시 물을 만한 실패만 | **수용** |
| 6 | 원스토어·토스 notImplemented, dev+DEV_IAP 없음 → badStore | **수용** |
| 7 | 호출 제한 DB 오류 시 통과, 웹훅 제외 | **수용** |
| 8 | 주인 없는 웹훅 결제 기록 → 나중 verify 때 주인 연결, aliases 확인 | **수용** |
| 9 | v_sales_daily = verified·granted, 서버 기록 시각 기준 | **수용** |
| 10 | 삭제 시 purchases는 연결만 끊음 | **수용** |
| 11 | 알림 {content, text} | **수용** |
| 12 | 깨우기가 매일 익명 사용자 1명 생성 | **변경:** 1년에 365명의 가짜 사용자가 쌓이고 활성 사용자 수가 부풀려짐. JWT 없이 부를 수 있는 `ping` 함수(DB `select 1`만, 응답 "ok")를 만들고 깨우기는 그걸 부름. 이미 생긴 `gh-keepalive` 줄은 삭제 |
| 13 | 백업 = Actions artifact 90일, gpg AES256 | **수용, 조건:** 암호 문구는 GitHub Secrets **와 쑹 비밀번호 관리자 둘 다**에 보관(잃으면 백업 못 엶). 복원 시험 1번 |
| 14 | Purchases.logIn은 hello 뒤 | **수용** |
| 위험 | transactionIdentifier = store_transaction_id 가정 | 첫 내부 테스트 실결제 1건으로 확인(purchases 줄이 verified가 되는지) |
| 위험 | products.json ids 전부 null | Play 콘솔에서 상품 만든 뒤 채우고 `_shared/products.json`에도 복사 |
| 위험 | 워크플로 미실행 | Actions 탭에서 수동 실행(Run workflow)으로 한 번씩 확인 |

## 21. 프롬프트 B-fix 결과 판정 (2026-11-09)

| # | 내용 | 판정 |
|---|---|---|
| 1 | ping = IP(해시) 호출 횟수 쿼리 1번 (select 1 대신) | **수용** (DB 활동이라 깨우기 효과 같음) |
| 2 | onGrant가 true 대신 { delta } 반환 | **수용 + 확인:** 토스 `processProductGrant`에는 객체가 아니라 **boolean true**를 넘겨야 함. 확인 완료: 모든 어댑터가 `!!`로 변환 |
| 3 | iap-granted 한 건씩 {txId, bundle} | **수용** (복구 여러 건은 여러 번 호출) |

## 22. 프롬프트 C 결과 판정 (2026-11-09)

**C1 원스토어**
| # | 내용 | 판정 |
|---|---|---|
| 1 | 주문번호 = purchaseToken, 환불도 토큰으로 맞춤 | **수용 + 보완:** 원스토어 콘솔·문의에서 쓰는 `purchaseId`도 purchases.raw와 별도 칸(`store_order_ref`)에 저장해 콘솔과 대조 가능하게 |
| 2 | payload `상품키\|id8`, 로그인 전 결제는 뒤 칸 비어도 통과 | **수용** |
| 3~4 | payload 불일치·NoSuchData → invalid(재확인 시 바뀔 수 있음), purchaseState 1 → refunded | **수용** |
| 5 | pg_cron → cron-jobs 함수 하나가 원스토어·토스·정산 담당, Vault 값 2개 필요 | **수용.** 쑹이 Vault 값 넣기(docs/server.md §7-6) |
| 6 | 토큰 메모리 캐시 | **수용** |

**C2 토스**
| # | 내용 | 판정 |
|---|---|---|
| 1 | Supabase에서 바로 mTLS (Worker 불필요) | **수용** — §17-1 해결 |
| 2 | sku 불일치 → invalid | **수용** (좋음) |
| 3 | 상태별 처리 | **수용** |
| 4 | 매시간 100건, 주문당 하루 1회 | **수용** |
| 5 | getAnonymousKey 실패 시 로컬 UUID 해시가 저장됨 | **변경:** 실패하면 `toss_key_hash`를 **보내지 않음(null)**, 다음 실행 때 다시 시도. 가짜 값이 들어가면 토스 사용자 판정(C3-9)이 틀어짐 |

**C3 경쟁 랭킹·광고**
| # | 내용 | 판정 |
|---|---|---|
| 1 | 시즌당 고정 시드 | **수용** (주간 같은 퍼즐 = 공정·검증 가능) |
| 2 | 점수 상한 임시값 | **수용**, 경쟁 모드 규칙 정할 때 확정 |
| 3 | 정산 일 15:31 UTC, 놓친 주 다음에 같이 | **수용** |
| 4 | 닉네임 있고 밴·삭제 아닌 사람만 | **수용** |
| 5 | 참여 보상 골드 뺌 | **결정 필요 → 추천:** 상품표처럼 **층별 골드 기준표를 서버 `_shared`에 복사**(밸런스 config와 다르면 테스트 실패)하고, 서버가 comp_best의 층으로 계산. 쑹이 원하면 대신 고정 보상(예: 다이아 소량)으로 단순화 |
| 6 | rank-top/rank-me에 mode:'comp' | **수용** |
| 7~8 | 광고 배치 표 비어 있음, 한도는 배치별 | **수용** (보상형 광고 배치 기획 때 채움) |
| 9 | 토스 광고 = 기기 판정 + 토스 키 해시 있는 사용자만 | **수용** (보상 가치 낮게 유지) |
| 10 | 게임 쪽 연결 안 함 | **수용** (경쟁 모드·광고 배치 기획 후) |