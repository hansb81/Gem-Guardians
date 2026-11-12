# Gem Guardians 쿠폰 입력 보상 v1

(2026-11-11 · 저장소에는 `docs/coupon.md`로 복사)

## 0. 한 줄 요약

설정 팝업 **왼쪽 위에 [🎫 쿠폰] 버튼** → 쿠폰 입력 팝업 → 서버(Supabase `coupon-redeem`)가 판정하고 `claims`에 `coupon:{캠페인}`으로 기록 → 기기는 출석·우편과 **똑같은 길**(`inventory.grant(bundle, {txId})` → 공통 획득 팝업 → `claims-granted`)로 지급. 쿠폰은 쑹이 **Supabase SQL 편집기에서 함수 한 줄**로 만든다(관리 사이트 없음).

목업: `art/ui/coupon/mockups/coupon_mock_all.png` (1 설정 / 2 빈 입력 / 3 확인 중 / 4 실패 안내)

---

## 1. 화면 흐름

```
설정 팝업 ─ 왼쪽 위 [쿠폰] ─▶ 쿠폰 입력 팝업
                                 │ 코드 입력 → [받기]
                                 ▼
                          서버 판정 (버튼 "확인 중…", 연타 막음)
                    ┌────────────┴────────────┐
                 성공                         실패
    입력 팝업 닫고 설정으로 + 공통 획득 팝업     입력 칸 아래 빨간 한 줄 (칸은 그대로 → 고쳐서 다시)
```

- **버튼 위치**: 설정 카드 왼쪽 위 `[14, 12, 100, 36]`(카드 기준 basis px). 닫기 버튼(오른쪽 위)과 같은 높이 띠, 가운데 문장(emblem)과 겹치지 않음. `btn_secondary` 9-slice + `icon_coupon`(16×16, 화면 32) + "쿠폰"/"Coupon".
- **쿠폰 팝업**: `popup = 'coupon'`, 카드 400×312. X·뒤로가기는 **설정으로 돌아감**(도움말·게임 정보와 같은 규칙). 문장 = `emblem_coupon`.
  - 안내 `y100`: "받은 쿠폰 코드를 입력하세요" (#a59cb2, 13)
  - 입력 칸 `[40,124,320,56]`: `menu/inset` 9-slice + **실제 HTML `<input>`을 위에 겹침**(랭킹 닉네임 입력 `rankingUi._createInput/_placeInput`과 같은 방식). 빈 칸이면 회색 `XXXX-XXXX-XXXX`.
  - 메시지 줄 `y206`: 실패 이유(빨강 #ec6a6a). 
  - 버튼 `y236`: 취소 `[40,236,150,46]` btn_secondary / 받기 `[210,236,150,46]` btn_primary. 받는 중엔 "확인 중…".
- **입력 칸 규칙**: 대문자로 바꿔 보여 줌, 최대 24자, `autocomplete=off`, `autocapitalize=characters`, `spellcheck=false`, Enter = 받기. 붙여넣기 가능(DOM input이라 길게 눌러 붙여넣기 자동).
- **버튼이 안 보이는 경우**: 서버가 꺼진 빌드(`net.enabled=false`), `/hello` features에서 `coupon:false`, 플랫폼 `caps.coupon=false`(iOS 기본값, §7). 오프라인일 땐 버튼은 보이고 팝업에서 "인터넷 연결이 필요해요".

### 문구 (ko / en)

| 키 | 한국어 | English |
|---|---|---|
| button | 쿠폰 | Coupon |
| title | 쿠폰 입력 | Enter Coupon |
| hint | 받은 쿠폰 코드를 입력하세요 | Enter your coupon code |
| ok / busy / cancel | 받기 / 확인 중… / 취소 | Redeem / Checking… / Cancel |
| notFound | 없는 쿠폰이에요. 코드를 다시 확인해 주세요 | Invalid code. Please check and try again. |
| already | 이미 사용한 쿠폰이에요 | You've already used this coupon. |
| expired | 기간이 끝난 쿠폰이에요 | This coupon has expired. |
| notStarted | 아직 사용할 수 없는 쿠폰이에요 | This coupon isn't active yet. |
| soldOut | 선착순 수량이 모두 소진됐어요 | This coupon has run out. |
| platform | 이 버전에서는 쓸 수 없는 쿠폰이에요 | This coupon can't be used on this platform. |
| tooMany | 잘못 입력한 횟수가 많아요. 10분 뒤에 다시 해 주세요 | Too many attempts. Try again in 10 minutes. |
| badCode | 영문과 숫자만 입력해 주세요 | Letters and numbers only. |
| offline | 인터넷 연결이 필요해요 | Internet connection required. |
| error (그 외) | 잠시 후 다시 시도해 주세요 | Please try again later. |

성공하면 공통 획득 팝업에 받은 것 표시(팝업이 제목 줄을 지원하면 쿠폰 이름 `title_ko/en`, 아니면 기본 제목).

---

## 2. 쿠폰 종류

| 종류 | 예 | 규칙 |
|---|---|---|
| **공용 쿠폰** | `GEMSOPEN` (출시 기념, SNS 공지) | 모두 같은 코드, **계정당 1번**, 기간·총 수량(선착순) 선택 |
| **1회용 쿠폰 묶음** | 방송·이벤트 당첨자 100명에게 코드 하나씩 | 코드마다 **딱 1번**, 같은 묶음(캠페인)에서는 계정당 1장만 |
| 특정 한 명에게 보상 | 문의 보상, 점검 사과 | 쿠폰 말고 **우편**(`mail` 표, 기존 방식) |

핵심: **계정당 1번은 "캠페인" 단위**. tx_id = `coupon:{campaign}`.
- 공용 쿠폰은 campaign = 코드 자신 → 계정당 1번.
- 1회용 묶음은 100장이 campaign 하나를 공유 → 친구 코드 여러 장 받아도 한 계정은 1장만.

### 코드 규칙
- 서버·기기 모두 **정규화**: NFKC → 대문자 → 영문·숫자 말고 전부 제거(공백·하이픈 무시). 결과가 4~20자 `A-Z0-9`가 아니면 `badCode`.
- 공용 쿠폰 코드는 쑹이 자유롭게(읽기 쉬운 단어).
- 1회용 코드는 자동 생성 **12자**, 헷갈리는 글자 `0 O 1 I L` 뺀 31자에서 → 표시는 `XXXX-XXXX-XXXX`. 경우의 수 31¹² ≈ 7.9×10¹⁷이라 맞혀 보기는 불가능.

---

## 3. 서버 (Supabase, 기존 프로젝트 `zgzwnsvuidydiyavlpyf`)

> ⚠ 같은 계정의 **Routory(ffzjgiknrrgwvgobybdq)에는 절대 올리지 않음**. `db push --linked` 전에 연결된 프로젝트 확인.

### 3-1. 표

```sql
coupons (
  code        text primary key,          -- 정규화된 값 'GEMSOPEN', '7KQ2MX9RHT4W'
  campaign    text not null,             -- 계정당 1번 단위. 공용 = code와 같음
  title_ko    text not null,
  title_en    text not null,
  bundle      jsonb not null,            -- { diamonds?, gold?, items?: {id:n} } 만 허용 (§3-3)
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,               -- null = 끝 없음 (권장하지 않음)
  max_uses    int,                       -- 이 코드 전체 사용 한도. null = 무제한. 1회용 = 1
  uses        int not null default 0,
  platforms   text[],                    -- null = 전부. 예 '{android,onestore}' (players.platform = 기기 PLATFORM_ID: web|toss|android|onestore|ios. 구글 플레이는 'android' — purchases.store의 'play'와 다름)
  enabled     boolean not null default true,  -- 문제 생기면 false로 바로 끔
  note        text,                      -- 쑹 메모 (어디 뿌렸나)
  created_at  timestamptz default now()
)
coupon_tries (player_id uuid, at timestamptz default now(), ok boolean)  -- 틀린 입력 제한용, 7일 뒤 cron 삭제
```
- RLS 켜고 정책 없음(클라이언트는 직접 못 읽음 — 함수로만). `claims`는 기존 표 그대로, kind = `'coupon'`.

### 3-2. 판정 함수 `coupon_redeem(p_player, p_code)` (한 트랜잭션)

순서:
1. `players.banned` → `banned` (화면엔 error 문구)
2. 최근 10분 `coupon_tries` 실패 ≥ 5 → `tooMany`
3. 정규화 실패 → 실패 기록, `badCode`
4. `select … from coupons where code = p_code for update` (같은 코드 동시 사용을 줄 세움). 없거나 `enabled=false` → 실패 기록, `notFound`
5. 이 계정의 `claims`에 `coupon:{campaign}`이 이미 있으면 → `already` (소진·만료보다 먼저: 이미 받은 사람에게는 이 말이 맞음)
6. `now() < starts_at` → `notStarted` / `ends_at <= now()` → `expired`
7. `platforms` 있고 `players.platform`(서버가 /hello로 아는 값 — 기기가 보낸 값은 안 믿음)이 없으면 → `platform`
8. `max_uses` 있고 `uses >= max_uses` → `soldOut`
9. `claims` insert (`coupon:{campaign}`, kind `coupon`, bundle) → `uses + 1` → `coupon_tries` ok 기록
10. `{ ok:true, txId, bundle, title:{ko,en} }`
- unique_violation(동시에 두 번 누름) → `already`. 이후 기기는 `syncClaims`로 혹시 못 받은 걸 복구(우편과 같음).
- 5·6·7·8의 실패는 `coupon_tries`에 **실패로 세지 않음**(진짜 코드라서) — 3·4만 셈.

### 3-3. 지급 내용 검사 `coupon_bundle_ok(bundle)` (표 check 제약)
- 키는 `diamonds`, `gold`, `items`만. **`flags`(광고 제거·4번째 슬롯)·`skills`는 쿠폰으로 못 줌** — 유료 상품을 쿠폰으로 실수로 뿌리는 걸 막음.
- 숫자는 양의 정수, 상한: 다이아 ≤ 5,000, 골드 ≤ 1,000,000, 아이템 개당 ≤ 99.
- 아이템 id는 `config/items.json`의 16종만(hammer, scythe_h, scythe_v, rainbow, glove, repair, hourglass, dye, shuffle, barrier, defuse, drum, booster_line, booster_bomb, gold_coin, revive). 서버 함수에 목록 복사 + 테스트가 config와 같은지 비교(출석표와 같은 방식).
- 오타(`"diamond": 100`)가 있으면 **쿠폰 만들 때 바로 에러** → 손님이 빈 보상 받는 사고 없음.

### 3-4. Edge Function `coupon-redeem`
- `POST {code}` → 기존 `handle()`(로그인·분당 30회 제한·에러 로그) 안에서 `db.rpc('coupon_redeem', …)`.
- features: `config/server.json` features에 `coupon: true` 추가. 끌 때 `FEATURES` 비밀값에 `"coupon":false`(값 전체를 덮어쓰므로 기존 키도 같이 적기).

### 3-5. 데이터 삭제(me-delete)
- 기존대로 claims 삭제됨. coupon_tries도 삭제. 쿠폰 `uses`는 그대로(전체 수량 기록).

---

## 4. 쑹이 쿠폰 만드는 법 (관리 사이트 없음)

Supabase 대시보드 → **SQL Editor** → 아래를 "저장된 스니펫"으로 만들어 두고 값만 바꿔 실행. 이 함수들은 앱(익명 사용자)에서는 못 부름.

```sql
-- ① 공용 쿠폰: 다이아 100 + 망치 3, 12월 31일 23:59(KST)까지, 선착순 무제한
select public.coupon_create(
  p_code     => 'GEMS-OPEN',              -- 하이픈·소문자 OK (정규화돼서 GEMSOPEN)
  p_title_ko => '출시 기념 쿠폰',
  p_title_en => 'Launch Gift',
  p_bundle   => '{"diamonds":100,"items":{"hammer":3}}',
  p_ends_at  => '2026-12-31 23:59:59+09',
  p_max_uses => null,                     -- 선착순 1000명이면 1000
  p_platforms => null,                    -- 원스토어만이면 '{onestore}', 구글 플레이는 '{android}'
  p_note     => '오픈 공지 인스타'
);

-- ② 1회용 쿠폰 100장 (결과 표 → CSV 내려받기로 받아서 나눠 줌)
select * from public.coupon_batch(
  p_campaign => 'stream-2026-12',
  p_count    => 100,
  p_title_ko => '방송 이벤트 보상', p_title_en => 'Stream Event Reward',
  p_bundle   => '{"diamonds":300}',
  p_ends_at  => '2027-01-31 23:59:59+09'
);  -- → code 열에 'XK7Q-M2RT-9HWA' 형식 100줄

-- ③ 현황
select * from public.v_coupon_stats;      -- 캠페인별 코드 수, 사용 수, 지급 확인 수, 마지막 사용

-- ④ 급히 끄기 (잘못 만든 쿠폰, 유출)
update public.coupons set enabled = false where campaign = 'stream-2026-12';

-- ⑤ 누가 썼나 (문의: 플레이어 코드 = id 앞 8자)
select player_id, claimed_at, granted_at from public.claims
 where tx_id = 'coupon:GEMSOPEN' order by claimed_at desc;
```

- 시간은 **`+09`를 붙여 KST로** 적기(안 붙이면 UTC로 들어가 9시간 어긋남).
- 문의 "쿠폰 넣었는데 안 들어왔어요" → ⑤로 확인 → `granted_at` 비어 있으면 다음 실행 때 자동 복구됨(출석·우편과 같음). 그래도 안 되면 우편으로 재지급.

---

## 5. 기기 코드 (요약 — 자세한 건 프롬프트)

| 곳 | 할 일 |
|---|---|
| `src/net/services.js` | `CouponService.redeem(code)` — 정규화 → `call('coupon-redeem')` → 성공이면 `grantClaim(inv, res, 'coupon')`, `already`면 `syncClaims` 후 already 돌려줌 |
| `src/game/serverUi.js` | `ui.coupon = feature('coupon') && platform.caps.coupon !== false ? new CouponService(inv) : null`, `menu.server.coupon`, action `couponRedeem` 처리 → 성공 시 `rewardPopup.show(...)` + 팝업 닫고 설정으로 |
| `src/render/mainMenuScreen.js` | 설정 카드 왼쪽 위 버튼, `popup:'coupon'`(400×312), 입력 DOM 겹치기/떼기, 메시지 줄, X·뒤로가기 → 설정 |
| `src/render/ui/` (선택) | 랭킹 닉네임과 쿠폰이 같이 쓰는 DOM 입력 도우미로 빼기 (`domInput.js`) — 두 번째 사용처가 생겼으니 추천 |
| `src/config/locales/ko.js·en.js` | `menu.coupon.*` (§1 표) |
| `config/server.json` | features `coupon: true` |
| `config/platform.ios.json` | features `coupon: false` (§7) → `caps.coupon` |
| `assets/ui/menu/` | `icon_coupon.png` 16×16, `emblem_coupon.png` 24×24 (+ manifest·README 줄) |

공통 지급 규칙은 그대로: txId(`coupon:{campaign}`)가 인벤토리 `grantedTx`에도 남아 같은 쿠폰을 두 번 지급하지 않음.

---

## 6. 부정 방지 · 한계

| 위험 | 막는 법 |
|---|---|
| 코드 맞혀 보기 | 1회용 코드 12자(31¹²), 계정당 10분에 실패 5번이면 잠금, 함수 분당 30회 제한 |
| 같은 코드 여러 번 | `claims` primary key(`coupon:{campaign}`) + 기기 `grantedTx` |
| 선착순 초과 | `for update` 줄 세우기 + `uses < max_uses` 확인을 한 트랜잭션에서 |
| 실수로 큰 보상·유료 혜택 | `coupon_bundle_ok` 상한 + flags 금지 |
| 유출된 1회용 코드 | 1번 쓰이면 끝. 묶음 전체를 끄려면 ④ |
| **앱 지우고 다시 깔기 → 새 익명 계정 → 공용 쿠폰 또 받기** | **v1에서는 막지 못함**(계정 연동 전엔 기기를 구분할 방법이 없음). 그래서 **공용 쿠폰은 작은 보상**, 큰 보상은 1회용 묶음으로. S5(계정 연동) 뒤에 다시 조임. 토스는 `toss_key_hash`로 막을 수 있음(나중에 선택) |

---

## 7. 마켓 정책 (확인 필요 표시 포함)

- **쿠폰 코드를 돈 받고 팔지 않는다.** 무료 배포(이벤트·공지·보상)만. 유료 재화·혜택을 외부에서 팔고 코드로 열어 주면 Google Play 결제 정책·App Store 3.1.1에 걸림.
- **App Store**: 3.1.1에 "자체 방식(라이선스 키·QR 코드 등)으로 콘텐츠를 여는 것" 제한 문구가 있어서, 국내 게임 다수가 **iOS에서는 게임 안 쿠폰 입력을 숨기고 웹 쿠폰 페이지**를 씀. → **iOS는 `caps.coupon=false`로 시작**(App Store는 출시 순서상 마지막). iOS 출시 때 심사 기준 다시 확인. *(확인 필요)*
- **앱인토스(토스)**: 쿠폰 입력 허용 여부 문서에서 못 찾음 → 토스 출시 전에 확인. 그때까지 토스도 `false`로 둘지 결정. *(확인 필요)*
- 원스토어·웹: 문제 없음으로 봄.

---

## 8. 기본값 (바꾸고 싶으면 말만 하면 됨)

| # | 정한 것 | 기본값 |
|---|---|---|
| C-1 | 버튼 위치 | 설정 팝업 카드 **안쪽** 왼쪽 위(닫기 버튼 맞은편). 팝업 밖 메뉴 화면 왼쪽 위는 출석 버튼 자리라 피함 |
| C-2 | iOS·토스 | iOS 숨김, 토스는 확인 전까지 숨김 |
| C-3 | 틀린 입력 제한 | 10분에 5번 |
| C-4 | 오프라인 | 버튼은 보임, 팝업에서 "인터넷 연결이 필요해요" |
| C-5 | 지급 가능 | 다이아·골드·아이템만 (광고 제거·슬롯·스킬 불가) |
| C-6 | 쿠폰 만들기 | SQL 편집기 함수(관리 사이트 없음) |

## 9. 나중에 (v1 아님)
- 웹 쿠폰 페이지(iOS용): 플레이어 코드 + 쿠폰 코드 → 우편으로 지급. 같은 `coupon_redeem`을 재사용.
- 딥링크 `gemguardians://coupon?code=…`로 입력 칸 자동 채움.
- 계정 연동(S5) 뒤 공용 쿠폰 재사용 막기.

---

## 10. 구현 결과 판정 (2026-11-12)

| # | 구현에서 정한 것 | 판정 |
|---|---|---|
| 1 | 플랫폼 값 = 기기 PLATFORM_ID (구글 플레이 = `android`) | **수용.** §3-1·§4 예시 고침. 주의: 결제 표 `purchases.store`는 `play`라서 두 표의 이름이 다름 — 쿠폰 만들 때는 `android` |
| 2 | 빈 묶음·빈 items·문자열 숫자 거절 | **수용** |
| 3 | gen_random_bytes 우선, 없으면 uuid 14바이트, 248 이상 버림 | **수용** (편향 없앤 처리 좋음) |
| 4 | 통계 뷰 enabled = 하나라도 켜져 있으면 true, ends_at = 가장 늦은 값 | **수용** |
| 5 | 획득 팝업 기본 제목 그대로 | **수용.** 쿠폰 이름 표시는 나중에 획득 팝업에 제목 기능이 생길 때 같이 |
| 6 | 토스 caps.coupon = true | **변경: false.** 기획 §8 C-2와 맞춤 — 프롬프트 문구가 기획과 어긋났던 것(내 실수). 토스 출시 전 정책 확인 후 켬. `config/platform.toss.json` features에 `"coupon": false` 한 줄 |
| 7 | 카드 바깥 탭은 완전히 닫힘 | **수용** (다른 팝업과 같은 규칙). 닫힐 때 DOM 입력 칸이 꼭 같이 사라지는지만 확인 |
| 8 | 오프라인 문구는 받기 누른 뒤 | **수용** |
| 9 | 정리 cron 매일 04:23 UTC | **수용** |
| 10 | 운영 함수는 service_role에도 실행 권한 없음 | **수용** (더 안전). 나중에 웹 쿠폰 페이지를 만들면 그때 따로 권한 설계 |
