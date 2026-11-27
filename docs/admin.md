# Gem Guardians 운영 관리자 페이지 계획 v1

작성 2026-11-13 · 쑹 요청: "특정 플레이어에게 레벨/골드/다이아/아이템 지급" → "보상뿐 아니라 전반적으로 관리할 수 있는 관리자 페이지"
→ 저장소로 옮길 때 `docs/admin.md`. 이 문서는 docs/server.md §10("새 사이트를 만들지 않는다")을 대체한다.

---

## 0. 한 줄 요약

- **별도 정적 사이트**(`admin/` → `dist-admin`, Cloudflare Worker `gem-guardians-admin`)에서 **Supabase 로그인(이메일+비밀번호+OTP 2단계)** 으로 들어오고,
  모든 조회·변경은 **Edge Function `admin` 하나**가 `admins` 표·2단계 인증을 확인한 뒤 처리한다. 서비스 키는 브라우저에 절대 없다.
- **지갑은 여전히 기기가 주인**이라 서버가 골드·다이아를 직접 바꿀 수 없다. 지급은 이미 있는 두 길로만 한다.
  1. **우편**(기본): `mail`에 그 플레이어 앞으로 한 통 → 플레이어가 우편함에서 [받기].
  2. **바로 지급**(결제 누락 복구 등): `claims`에 `admin:{id}` 한 줄(granted_at 비움) → 다음 접속 때 `claims-pending`으로 자동 지급 + 토스트.
- 모든 변경은 **사유 필수 + `admin_audit` 기록**. 지급 상한·전체 발송 2단계 확인·같은 요청 두 번 방지.
- 단계: **A 서버**(표·RPC·admin 함수) → **B 관리자 페이지** → **C 게임 쪽**(레벨 지급 키, 바로 지급 토스트, 버전 확인).

---

## 1. 지금 구조에서 되는 것 / 안 되는 것

| 하고 싶은 것 | 지금 | 이 계획 |
|---|---|---|
| 골드·다이아·아이템 지급 | 표 편집기로 `mail`에 줄 추가 (JSON 손으로) | 화면에서 폼으로, 우편 or 바로 지급 |
| 젬 스킬 레벨·영구 플래그(slot4, adFree) | 번들 `skills`/`flags`가 기기에서 이미 동작 | 그대로 지원 (플래그는 확인 한 번 더) |
| **수호자(타워) 레벨** | 번들에 없음 (towerLevels는 playerState, 인벤토리 밖) | **C단계에서 번들 키 `levels` 추가** (§4) |
| **층(최고 층) 올려 주기** | 없음 | `levels.floor` 같은 키로 (§4). 랭킹은 안 바뀜 |
| 골드·다이아 **회수(차감)** | 불가 | v1 **안 함** (§4-4). 필요하면 제재로 |
| 플레이어 save 직접 고치기 | 불가 (기기가 주인, rev 충돌) | v1 **읽기만** (요약·아이템·타워 레벨 표시) |
| 결제 확인·누락 복구 | 표 편집기 | 결제 목록 + [바로 지급으로 복구] 버튼 |
| 쿠폰 만들기·끄기 | SQL 편집기 `coupon_create`/`coupon_batch` | 화면에서 (같은 RPC 사용) |
| 닉네임·랭킹·제재 | 표 편집기 | 화면에서 (닉네임 초기화, 랭킹 숨김, 정지) |

---

## 2. 화면 구성 (메뉴 7개 + 플레이어 상세)

PC 브라우저 기준(폭 1200 이상), 휴대폰에서는 한 줄로 쌓이게만. 한국어 전용. 게임 에셋·폰트 안 씀(일반 시스템 폰트, 단순 표).

1. **대시보드** — 오늘(KST) 접속 수(`players.last_seen_at`), 신규 가입, 오늘·7일 매출(`v_sales_daily`), 미지급 claims 수, 오늘 오류 로그 수(`server_log level=error`), 탈퇴 요청 수. 숫자 카드 + 최근 결제 10건 + 최근 오류 10건.
2. **플레이어 찾기** — 검색창 하나: 플레이어 코드(앞 8자) / 전체 uid / 닉네임 / 결제 주문번호 / legacy_id. 결과 목록(코드, 닉네임, 플랫폼, 최고 층, 마지막 접속, 정지 여부).
3. **플레이어 상세** (탭)
   - 요약: uid(복사), 코드, 닉네임, 플랫폼, 가입·마지막 접속·앱 버전, 계정 종류(게스트/Google), 정지, 메모(`players.note` 편집)
   - 저장: `saves.summary` + data에서 골드·다이아·층·최고 층·타워 레벨 5개·아이템 개수·스킬·플래그 (읽기 전용, "기기 기준 마지막 업로드 시각" 같이 표시)
   - 결제: `purchases` (상태, 지급 여부, 환불) + 미지급이면 [복구 지급]
   - 받은 보상: `claims` (최근 100, kind 필터, 미지급 표시)
   - 우편: 이 사람 앞 우편 + 받았는지, [회수](안 받은 것만)
   - 랭킹: 일반 최고 층, 경쟁 기록, [랭킹 숨김/해제], [닉네임 초기화]
   - 로그: 이 uid가 들어간 `server_log`, 이 사람에 대한 `admin_audit`
   - 오른쪽 위 버튼: **[보상 지급]** [정지/해제]
4. **보상 지급** (상세에서 열거나 메뉴에서 여러 명)
   - 받는 사람: 1명 또는 코드/uid 여러 줄 붙여넣기(최대 200명) — 각 줄 확인 결과(찾음/없음/정지) 표시
   - 내용: 골드, 다이아, 아이템 16종(config/items.json 순서, 아이콘은 `assets/` 아이템 이미지 그대로 써도 됨), 젬 스킬(+1 / 레벨 지정), 플래그(slot4, adFree), **레벨**(타워 5개 각각 "최소 Lv", 층 "최소 N층")
   - 방식: (●) 우편 — 제목 ko/en(기본 "운영자 선물" / "A gift from the team"), 만료일(기본 30일) / ( ) 바로 지급 — 다음 접속 때 자동
   - 사유(필수, 자유 글) + 내부 메모
   - [미리보기] → "OOO 외 N명에게 다이아 500, 망치 5 / 우편 / 만료 12-13" 확인창 → [보내기]
5. **우편함** — 보낸 우편 목록(개인·전체), 받은 사람 수, 만료, [회수]. **[전체 발송]** 은 여기서만 (§5-3 2단계 확인).
6. **결제** — `v_purchases_recent` 필터(마켓·상태·기간), 주문번호 검색, 환불 목록(`v_refunds`), 일별 매출(`v_sales_daily`). 실제 정산은 마켓 정산서가 기준이라는 안내 한 줄.
7. **쿠폰** — `v_coupon_stats` 목록, [새 쿠폰](공용 코드) / [일회용 묶음 만들기](개수 → CSV 다운로드), [끄기/켜기]. 번들 검사는 기존 `coupon_bundle_ok` 그대로.
8. **로그·감사** — `server_log`(level·source·기간 필터), `admin_audit`(누가 언제 무엇을, 전·후 값).
9. **랭킹**(2026-11-27 추가, 비정상 계정 찾기) — 일반 최고 층 / 경쟁 시즌 순위 상위 100~500명. 게임 순위표와 달리 숨김·정지·탈퇴도 포함해 상태 칸에 표시. 가입→도달 시간·층당 초·save 요약(탑 합·다이아·골드)·플랫폼. action `rank.list {mode, seasonId?, limit, hiddenOnly}`(viewer).

(나중) 이벤트 표(`events`) 편집, 공지 팝업, 점검 모드 스위치는 **이벤트 API를 만들 때** 같은 함수에 action만 추가.

---

## 3. 보안 구조 (가장 중요)

```
[쑹 브라우저] --(Cloudflare Access: 쑹 이메일 OTP)--> gem-guardians-admin.<sub>.workers.dev (정적 HTML/JS만)
      |  supabase-js: anon 키 + 쑹 로그인 JWT(이메일+비밀번호 → TOTP 2단계, aal2)
      v
[Edge Function admin]  1) JWT 확인 2) aal == 'aal2' 3) uid ∈ admins 표 4) Origin 허용 목록(관리자용 따로)
      |  5) 분당 호출 제한 6) action별 입력 검사 7) service_role로 RPC/쿼리 8) admin_audit 기록
      v
[Postgres]  admin_* RPC는 service_role만 실행 가능(anon/authenticated revoke)
```

- **서비스 키·관리자 비밀번호를 페이지에 넣지 않는다.** 페이지가 가진 건 공개 anon 키뿐(게임과 같음).
- **관리자 계정**: Supabase 대시보드 Authentication → Users → Add user(이메일+비밀번호, 이메일 확인 완료로)로 쑹 전용 1개. 게임에 쓰는 Google 계정과 **다른 계정**(관리자 uid가 플레이어가 되지 않게). 첫 로그인 때 페이지가 TOTP 등록(QR) 화면을 띄움 → 이후 6자리 필수.
- **`admins` 표**: `user_id uuid pk references auth.users, role text check in ('owner','viewer'), created_at`. 쑹 uid를 SQL 편집기로 1줄 넣음. viewer = 조회만(나중에 도와줄 사람용).
- **익명 가입은 그대로 켜져 있어도 됨**: 아무나 가입해도 admins 표에 없으면 403. 그래도 Email 제공자는 "Confirm email" 켜 두기.
- **Cloudflare Access**(Zero Trust 무료 50명까지)로 관리자 사이트 자체를 쑹 이메일 OTP 뒤에 숨김 → 페이지 존재도 안 보임. Workers 설정 → Domains & Routes → workers.dev의 "Cloudflare Access" 켜기. (2중 잠금. Access가 귀찮으면 빼도 서버 검사만으로 안전함)
- **CORS**: admin 함수는 게임 목록이 아니라 `ADMIN_ORIGINS`(관리자 workers.dev 주소 + `http://localhost:5180`)만 허용. 게임 함수 허용 목록에는 관리자 주소를 넣지 않음.
- **게임 빌드에 관리자 코드가 들어가지 않게**: `admin/`은 별도 vite 설정·별도 dist. `npm run build:web` 결과에 admin 파일이 없어야 함(테스트로 확인).
- 세션: 30분 무동작이면 로그아웃, 페이지는 토큰을 sessionStorage에만(탭 닫으면 끝).

---

## 4. 지급 방식 상세

### 4-1. 번들 모양 (기존 + 추가)

```json
{ "gold": 50000, "diamonds": 500,
  "items": { "hammer": 5, "revive": 1 },
  "skills": { "spike": "+1" },
  "flags": ["slot4"],
  "levels": { "towers": [null, 30, null, null, null], "floor": 40 } }
```

- gold/diamonds/items/skills/flags: 기기 `inventory.grant()`가 이미 처리.
- **`levels`(새로 추가, C단계)**: "최소 보장" — 지금 값보다 **낮으면 그 값으로 올리고, 높으면 그대로**(절대 내리지 않음). towers 순서는 playerState.towerLevels 순서(빨/파/초/…, Claude Code가 config에서 확인해 문서에 적기). `floor`는 `floor`와 `bestFloor`를 그 층 이상으로(층 해금 = 최고 도달 층 기준인 아이템 unlockFloor·슬롯 해금도 따라 열림). **랭킹 기록(normal_best)은 안 바꿈** — 랭킹은 실제로 깬 기록만.
- 상한(서버 `admin_bundle_ok`, 쿠폰보다 넉넉): 다이아 ≤ 50,000 · 골드 ≤ 1억 · 아이템 개당 ≤ 999 · 스킬 0~5 · 플래그 slot4/adFree만 · 타워 레벨 ≤ 밸런스 최대 · floor ≤ 300. 넘으면 거절(오타 방지). 다이아 10,000 이상·플래그·레벨은 확인창에 빨간 줄로 한 번 더.

### 4-2. 우편 vs 바로 지급

| | 우편 (기본) | 바로 지급 |
|---|---|---|
| 기록 | `mail`(player_id) + 받으면 `claims mail:{id}` | `claims admin:{grantId}` (granted_at null) |
| 플레이어 경험 | 우편함 빨간 점 → [받기] → 획득 팝업 | 다음 접속 때 자동, 토스트 "운영자 지급: …" + 획득 팝업 |
| 회수 | 받기 전이면 가능 | 기기가 받기 전(granted_at null)이면 가능 |
| 쓰는 곳 | 사과 보상, 이벤트 당첨, 문의 보상 | 결제했는데 안 들어온 경우, 버그로 잃은 것 복구 |

- 두 방식 모두 txId가 있어 기기에서 두 번 들어가지 않음.
- 한 요청 = `admin_grants` 1줄(받는 사람 수만큼 mail/claims 생성) → 묶음 단위로 회수·조회.

### 4-3. 옛 앱 버전 문제 (레벨 키)

지금 깔린 앱은 `levels` 키를 모르고 **무시한 채 txId만 기록** → 레벨이 사라짐. 그래서:
- C단계에서 기기 `grant()`가 **모르는 키가 있으면 지급하지 않고 `unsupported`로 거절**(claims는 미지급으로 남아 업데이트 후 다시 내려옴, 우편은 "앱을 업데이트해 주세요").
- 관리자 화면은 `levels`가 든 지급을 만들 때 받는 사람의 `players.app_version`이 C단계 버전보다 낮으면 경고.

### 4-4. 회수(차감)를 v1에서 안 하는 이유

지갑이 기기에 있어서, 서버가 "다이아 -500"을 보내면 이미 써 버린 경우 음수·충돌 처리가 필요하고 클라우드 저장 rev 충돌도 생김. 악용·환불 악용은 v1에선 **정지(banned) + 랭킹 숨김**으로 대응하고, 필요해지면 "음수 번들(0 밑으로는 안 감) + 기기 확인" 을 v2로.

---

## 5. 서버 (A단계)

### 5-1. 새 표

```sql
admins(user_id uuid pk → auth.users, role text 'owner'|'viewer', created_at)
admin_audit(id bigserial, at, admin_id uuid, action text, target_player uuid null,
            target text null, request_id uuid unique, reason text, before jsonb, after jsonb, ip text)
admin_grants(id bigserial, at, admin_id, mode 'mail'|'direct', bundle jsonb, reason text, note text,
             title_ko, title_en, expires_at, player_ids uuid[], count int, revoked_at timestamptz)
```
- `mail`에 칸 추가: `grant_id bigint null`, `revoked_at timestamptz null`(회수된 우편은 목록·받기에서 빠짐 — `visibleMail`, `mail_claim` 둘 다 고침).
- `players`에 `app_version text`(hello가 이미 받는 값 저장 — 없으면 추가), 랭킹 숨김용 `rank_hidden boolean default false`(rank-top/rank-me가 거름).
- 기존 `claims.kind`에 `admin` 추가(체크 제약이 있으면 갱신).

### 5-2. Edge Function `admin` 하나 (POST {action, ...})

함수 개수를 늘리지 않으려고 한 개에 action 분기. 공통 입구는 게임용 `handle()`이 아니라 `adminHandle()`(관리자 CORS·aal2·admins 확인·role 확인·감사 기록).

| action | role | 하는 일 |
|---|---|---|
| `me` | viewer | 내 role, 서버 시각 |
| `dashboard` | viewer | §2-1 숫자 한 번에 (SQL 함수 `admin_dashboard()` 1번 호출) |
| `player.search` {q} | viewer | 코드 prefix / uuid / 닉네임(ilike) / 주문번호 / legacy_id, 최대 50 |
| `player.get` {id} | viewer | players + saves(summary·필요 칸) + purchases + claims 100 + mail + 랭킹 + 감사 |
| `player.note` {id, note} | owner | 메모 |
| `player.ban` {id, banned, reason} | owner | 정지/해제 |
| `player.rankHide` {id, hidden} | owner | 랭킹 숨김 |
| `player.nicknameReset` {id} | owner | 닉네임 null (다음 랭킹 진입 때 다시 정함) |
| `grant.preview` {players[], bundle} | owner | 받는 사람 확인 + 번들 검사 + 버전 경고 (쓰기 없음) |
| `grant.send` {requestId, players[], bundle, mode, title, expiresAt, reason, note} | owner | RPC `admin_grant` 한 트랜잭션 |
| `grant.revoke` {grantId} | owner | 안 받은 우편/미지급 claims만 회수 |
| `grant.list` | viewer | admin_grants 목록 + 받은 수 |
| `mail.broadcast` {requestId, bundle, title, expiresAt, reason, confirm:"전체 발송"} | owner | player_id null 우편 |
| `purchase.list` {filters} / `purchase.regrant` {id, reason} | viewer / owner | 결제 목록 / 미지급 결제를 `iap:` 원래 txId 그대로 claims에 넣어 복구(이중 지급 없음) |
| `coupon.list` / `coupon.create` / `coupon.batch` / `coupon.toggle` | viewer / owner | 기존 coupon_* RPC 사용 (service_role 실행 권한 부여) |
| `log.list` / `audit.list` | viewer | 필터 조회 |

- 모든 owner action: `requestId`(페이지가 만든 uuid) 필수 → `admin_audit.request_id unique`로 더블클릭·재시도 중복 방지.
- 받는 사람 상한 200명/요청, 전체 발송은 하루 3회, 지급 요청은 분당 10회.
- 결제 복구 `purchase.regrant`: purchases.status가 verified이고 granted_at이 비었을 때만. 원래 tx_id(`iap:…`)로 claims를 넣어 기기가 이미 받았으면 duplicate로 끝남.

### 5-3. 전체 발송 2단계 확인

미리보기 화면에서 받을 대상 수(최근 30일 접속자 수)를 보여 주고, 입력칸에 **"전체 발송"** 을 직접 쳐야 버튼이 켜짐. 서버도 `confirm` 값을 확인.

---

## 6. 관리자 페이지 기술 (B단계)

- 위치 `admin/`(index.html + `admin/src/*.js` + `admin/admin.css`), 프레임워크 없이 ES 모듈 + supabase-js(이미 의존성). 게임과 섞지 않음(공유는 `config/items.json` 읽기 정도).
- 빌드 `npm run build:admin` → `dist-admin/`, 개발 `npm run dev:admin`(포트 5180).
- 배포 `npx wrangler deploy --assets=./dist-admin --name=gem-guardians-admin --compatibility-date=2026-11-01` → `https://gem-guardians-admin.<sub>.workers.dev`. 이 주소를 admin 함수 `ADMIN_ORIGINS`에 넣고 함수 배포.
- 화면: 왼쪽 메뉴 7개, 오른쪽 내용. 표는 정렬·페이지(50줄). 모든 시각 KST 표시. 위험 버튼은 빨간색 + 확인창.
- `<meta name="robots" content="noindex">`, 검색엔진 차단.

---

## 7. 게임 쪽 (C단계, 작음)

1. `inventory.grant()`에 `levels` 처리 — 인벤토리는 towerLevels를 모르므로 playerState가 주입한 콜백(`applyLevels`)으로 위임. delta에 `levels` 표시 → 획득 팝업에 "수호자 Lv 30" / "30층 해금" 한 줄.
2. 모르는 번들 키 → `unsupported` 거절(지급·txId 기록 안 함). `syncClaims`는 unsupported면 done에 넣지 않음. 우편 받기에서 unsupported면 "앱을 업데이트해 주세요" 토스트.
3. `syncClaims`가 kind `admin`을 받으면 메뉴 토스트 "운영자 지급이 도착했어요" + 획득 팝업.
4. hello가 appVersion을 `players.app_version`에 저장(이미 보내는 값).

---

## 8. 쑹이 해야 할 일 (순서)

1. 프롬프트 A 실행 → `npx supabase db push --linked`(GemGuardians jzpjqfbpqzghprqbqexp 확인 후!) → `npx supabase functions deploy admin --project-ref jzpjqfbpqzghprqbqexp`
2. Supabase → Authentication → Users → Add user(관리자 이메일, 비밀번호, Auto confirm) → 그 uid를 SQL 편집기에서 `insert into public.admins values ('<uid>', 'owner');`
3. Authentication → Multi-Factor → TOTP 켜기(무료)
4. 프롬프트 B 실행 → `npm run dev:admin`으로 로컬 확인 → 첫 로그인 때 OTP 앱(Google Authenticator 등) 등록
5. 배포 + (선택) Cloudflare Access 켜기 → 주소를 ADMIN_ORIGINS에 넣고 admin 함수 다시 배포
6. 프롬프트 C 실행(게임 쪽) → 다음 앱 빌드부터 레벨 지급 가능

---

## 9. 정해 둔 기본값 (바꾸고 싶으면 말해 주세요)

- D-1 지급 기본 방식 = **우편**, 바로 지급은 복구용
- D-2 레벨 지급 = **최소 보장(올리기만)**, 랭킹 기록은 안 바꿈
- D-3 회수(차감) **v1 안 함**
- D-4 관리자 사이트 = **별도 Worker + Cloudflare Access + Supabase 2단계 로그인** (가장 간단한 대안: 배포 없이 로컬 `npm run dev:admin`에서만 사용)
- D-5 관리자 계정 = 게임용 Google과 **다른 이메일 계정**
- D-6 상한: 다이아 5만·골드 1억/요청, 200명/요청, 전체 발송 하루 3회

## 10. 확인 필요

- Supabase supabase-js의 aal 확인 방법(`auth.getClaims()` 또는 JWT `aal` 클레임) — Claude Code가 설치 버전에서 확인.
- Cloudflare workers.dev에 Access 토글 위치는 대시보드 개편으로 바뀔 수 있음 — 안 보이면 Zero Trust → Access → Applications → Self-hosted에 주소 등록.
- 무료 플랜 Edge Function 개수 한도: 지금 29개 + 1. 한도에 걸리면 알려 주세요(admin을 한 개로 묶은 이유).

---

## A단계 메모 (Claude Code 조사, 2026-11-13)

| 항목 | 결과 |
|---|---|
| `claims.kind` 체크 제약 | **없음**(text not null, 주석만) → `admin` 추가할 제약 없음 |
| `players.app_version` | 없었음 → A단계에서 칸 추가. `saves.app_version`(save-put이 저장)은 따로 있음 |
| hello의 appVersion | 기기는 보냄(src/net/api.js `sayHello`) 서버는 **저장 안 했음** → A단계에서 `players.app_version`에 저장(32자 이하) |
| towerLevels 순서 | `config/balance.json tower.towers` 순서 = 0 빨강(이그니스) · 1 파랑(프로스트) · 2 노랑(볼테르) · 3 초록(실바) · 4 보라(베놈). `levels.towers`도 이 순서 |
| 타워 최대 레벨 | `config/balance.json tower.maxLevel` = 200 |
| `inventory.grant()` 번들 키 | `gold`, `diamonds`, `items{id:n}`, `skills{key: 레벨 \| '+1'}`, `flags[]` (src/game/inventory.js `_applyBundle`). 모르는 키(`levels` 포함)는 지금 **조용히 무시** - §4-3 |
| skills 키 | config/shop.json `skills.color`: red, blue, purple, yellow, green + `skills.special`: spike, lava, soul, ult (9개), 레벨 0~5 |
| JWT aal 확인 | supabase-js/auth-js 2.119.0(functions deno.lock도 2.119.0)의 `auth.getClaims(jwt)`: 비대칭 키면 JWKS로 서명 확인, HS 키면 getUser로 확인 후 payload → `claims.aal`, `claims.is_anonymous`, `claims.sub` |
| `coupon_create` / `coupon_batch` | SQL 편집기 전용(service_role 실행 권한 없음) → A단계에서 service_role 실행 부여 |
| `v_coupon_stats` | 이미 service_role select 있음 |
| 결제 지급 경로 | 결제는 claims를 안 거침: 기기가 iap-verify 뒤 직접 지급 → iap-granted가 `purchases.granted_at`·`granted_bundle` 기록. 그래서 미지급(`granted_at` null)이면 `granted_bundle`도 비어 있음 → 복구 번들은 `products.json` grant를 기기 `bundleOfGrant`(src/core/shop/shop.js) 모양으로 변환(첫 구매 2배 보너스는 없음) |

## A단계 결과

### 만든 것
- 마이그레이션 `server/supabase/migrations/20261116000000_admin.sql`: `admins`, `admin_audit`, `admin_grants`, `mail.grant_id/revoked_at`, `players.app_version/rank_hidden`,
  `mail_claim`·`rank_normal_top`·`rank_normal_me`·`comp_board` 교체(회수 우편 제외, 랭킹 숨김 제외), `admin_bundle_ok`, `admin_grant`, `admin_grant_revoke`,
  `admin_broadcast`, `admin_purchase_regrant`, `admin_player_set`, `admin_dashboard`, `admin_player_search`, `admin_resolve_players`, `admin_grant_list`,
  `admin_audit_prev/add`, 쿠폰 운영 함수 service_role 실행 권한.
- `server/supabase/functions/_shared/admin.ts`(입구 `adminHandle`), `functions/admin/index.ts` + `actions.ts`(§5-2 action 전부).
- 기존 함수 수정: `_shared/mail.ts`(회수 우편 제외), `hello`(app_version 저장), `rank-me`(숨김이면 `hidden: true`).
- 테스트 `server/supabase/tests/admin_test.ts`(PGlite - 이 PC에 Docker가 없어 로컬 supabase 대신 기존 방식). 실행: `deno test -A --no-check server/supabase/tests`.

### 배포 (쑹이 직접, 순서대로)
> **Routory(ffzjgiknrrgwvgobybdq)는 절대 건드리지 않는다.** 모든 명령은 GemGuardians(jzpjqfbpqzghprqbqexp) 대상.

1. 링크 확인: `npx supabase projects list` → **LINKED 표시(●)가 GemGuardians / jzpjqfbpqzghprqbqexp 줄**인지 본다.
   다른 프로젝트면 `npx supabase link --project-ref jzpjqfbpqzghprqbqexp` 후 다시 확인.
2. DB: `npx supabase db push --linked` (표·칸이 먼저 있어야 아래 함수가 `revoked_at`·`rank_hidden`을 읽을 수 있다)
3. 함수:
   ```
   npx supabase functions deploy admin --project-ref jzpjqfbpqzghprqbqexp
   npx supabase functions deploy hello mail-list att-status claims-pending claims-granted rank-me --project-ref jzpjqfbpqzghprqbqexp
   ```
   (hello·mail-list·att-status·claims-pending = 회수 우편을 빼는 `_shared/mail.ts`를 묶어 가는 함수, rank-me = 숨김 표시,
   claims-granted = 새 SQL `claims_granted`를 부름 - **db push 뒤에** 배포해야 한다. A-fix 반영)
4. 관리자 출처: `npx supabase secrets set ADMIN_ORIGINS=https://gem-guardians-admin.<sub>.workers.dev --project-ref jzpjqfbpqzghprqbqexp`
   (여러 개면 콤마로. `http://localhost:5180`은 코드에 기본으로 들어 있음. 바꾼 뒤 admin 함수 다시 배포)

### 관리자 계정
Authentication → Users → Add user(관리자 전용 이메일·비밀번호, Auto confirm) → 그 uid로 SQL 편집기에서:
```sql
insert into public.admins (user_id, role) values ('<관리자 uid>', 'owner');
-- 도와줄 사람(조회만): ... values ('<uid>', 'viewer');
```
Authentication → Multi-Factor에서 TOTP 켜기. aal2(OTP까지 통과)가 아니면 admin 함수가 `{ ok:false, reason:'mfa' }`(401).

### 응답 요약 (B단계 페이지용)
- 입구 거절: `auth`(401) · `anonymous`(403) · `mfa`(401) · `notAdmin`(403) · `role`(403, viewer가 owner action) · `rateLimited`(429, 분당 60 / grant.* 10) · `badAction` · `badRequest`(쓰기에 requestId(uuid)·reason(1~500자) 없음).
- 쓰기는 같은 `requestId`로 다시 보내면 처음 결과를 그대로 돌려준다(`admin_audit.request_id`).
- `grant.send` 실패: `badBundle` · `badMode` · `badPlayers`(0명·201명 이상) · `missing`(+`missing[]`, 하나라도 없으면 전체 거절).
- `grant.revoke` → `{ revoked, received }`. `mail.broadcast` → `confirm`(확인 문구 틀림) · `dailyLimit`(KST 하루 3회). 전체 발송도 `admin_grants` 1줄이라 `grant.revoke`로 회수(이미 받은 사람은 그대로).
- `purchase.regrant` → `{ txId, created }` | `notEligible`(verified·미지급 아님). claims kind는 `admin`, tx_id는 원래 `iap:…`.
- `grant.preview` → `players[{q, id, status: found|banned|deleted|missing|ambiguous, nickname, app_version}]`, `bundleOk`, `oldApp`(`LEVELS_MIN_APP_VERSION`이 정해지면, 지금 null).

## A단계 판정 (쑹 2026-11-13) + A-fix

결정 1, 4~9 승인. 결정 2·3은 아래처럼 고침(마이그레이션 `20261117000000_admin_fix.sql` - A단계 파일은 그대로 두고 뒤에 덧붙임).

### 결정 3 → 결제 복구분을 기기가 받으면 결제도 "지급됨"
- 새 SQL `claims_granted(p_player, p_tx_ids)`: 한 트랜잭션에 claims `granted_at` 기록 + 그중 `iap:`로 시작하는 tx는 같은 플레이어의
  purchases(tx_id 일치, `status='verified'`, `granted_at` null)를 `status='granted'`, `granted_at=now()`, `granted_bundle=그 claims.bundle`로.
  이미 granted·refunded 등 verified가 아니면 건드리지 않는다(iap-granted와 같은 방향, 더 좁게).
- `claims-granted` 함수가 직접 update 대신 이 RPC를 부른다(응답 모양 그대로 `{ ok: true }`).
- 결과: 복구 → 기기 지급 → 결제 목록에 지급됨 → [복구] 다시 누르면 `notEligible`(아무 일 없음).

### 결정 2 → 다이아 첫 구매 2배도 복구에 반영
- **기기 규칙**(src/core/shop/shop.js `buyProduct` case `'diaBundle'`): 상품 `dia.N`의 첫 구매 여부 = 기기 save `shop.firstBuyUsed`에 순번 N이 없음.
  첫 구매면 products.json `grant.diamonds`에 **기본 다이아(= grant.diamonds − config/shop.json `diaBundles[N].bonus`)만큼 더** 준다.
  예: dia.2 = 690(기본 600 + 보너스 90) → 첫 구매 1290.
  (스토어 결제 복원 `grantPaidProduct`도 지금 상점 목록에 있으면 buyProduct라 같은 규칙.)
- **서버 근사**: 이 플레이어의 같은 product_key 결제 중 `status in (verified, granted)`이고 이 결제보다 앞선 것(purchased_at, 같으면 id)이 없으면 첫 구매.
  서버는 save의 firstBuyUsed를 보지 않는다(근사).
- 보너스 표: `admin/actions.ts DIA_BONUS = [0, 30, 90, 320, 850, 2100]`(config/shop.json diaBundles bonus 사본, admin_test가 비교).
  `firstBuyExtra(key)` = dia.N이면 grant.diamonds − bonus, 아니면 0 → SQL `admin_purchase_regrant(..., p_first_extra, ...)`이 첫 구매일 때만 diamonds에 더함.
- `purchase.regrant` 응답: `{ ok, txId, created, firstPurchaseBonus: true|false, bundle }` - 페이지가 "첫 구매 2배 포함" 표시에 쓴다.
- 다시 확인: claims는 **kind `admin`, tx_id는 원래 `iap:{키}:{주문}` 그대로**(`on conflict do nothing`). 기기가 이미 그 주문을 받았으면
  grantedTx에 있어 `duplicate` → 이중 지급 없음.

### 남는 것(C단계 후보)
- 기기가 복구분을 claims로 받을 때는 `inventory.grant`만 해서 `shop.firstBuyUsed`에 순번이 안 들어간다. 첫 구매 2배로 복구된 사람이
  같은 묶음을 다시 사면 기기는 또 첫 구매로 본다. `syncClaims`에서 `iap:dia.N:` tx면 firstBuyUsed에 N을 넣는 처리를 C단계에 넣을지 결정 필요.

## B단계 결과 - 관리자 페이지 (2026-11-19)

### 만든 것
- `admin/index.html`, `admin/admin.css`, `admin/src/*.js`(프레임워크 없음): main(로그인 확인·메뉴·해시 라우터), api(supabase 로그인·admin 호출·30분 무동작 로그아웃),
  login(이메일+비밀번호 → TOTP 등록/입력), ui(표·토스트·확인창), bundle(지급 내용 폼 - 보상 지급·전체 발송·쿠폰 공용),
  dashboard, players(찾기·상세 7탭), grant(보상 지급·지급 상세), mail(우편함·전체 발송), purchases, coupons, logs.
- `vite.config.admin.js`(root `admin/`, 결과 `dist-admin/`, 포트 5180), `package.json` `dev:admin` / `build:admin` / `deploy:admin`.
  `build:admin`은 빌드 뒤 `tools/check-bundle-secrets.mjs dist-admin`으로 비밀 키가 없는지 본다.
- Supabase URL·anon 키는 게임과 같은 `config/server.json`(공개값). 아이템 이름·스킬 이름은 `src/config/locales/ko.js`, 아이콘은 `assets/items/*.png`(2배, pixelated).
- 게임 빌드 분리 확인: `tests/adminSeparation.test.js`(게임 web 빌드를 임시 폴더로 돌려 admin 파일·관리자 코드 문자열이 없는지).
- admin 함수에 화면용 값 3개 추가: `dashboard.active30d`(최근 30일 접속 - 전체 발송 안내), `player.get.compBest`(경쟁 기록), `purchase.list.sales`(일별 매출).
- 바로 열기 주소: `#player/<uid>`, `#grant/<지급 id>`, `#players?q=<검색어>`, `#grant?to=<uid>`(보상 지급에 받는 사람 채움).

### 로컬에서 쓰기
1. `npm run dev:admin` → 브라우저에서 `http://localhost:5180` (admin 함수가 이 주소를 기본으로 허용).
2. 관리자 이메일·비밀번호로 로그인.
3. **처음 한 번**: OTP 등록 화면의 QR을 Google Authenticator 등으로 찍고 6자리 입력. 다음부터는 6자리만.
   (등록 화면이 "OTP 등록 실패"면 Supabase → Authentication → Multi-Factor에서 **TOTP 켜기**)
4. 탭을 닫거나 30분 동안 아무것도 안 하면 로그아웃.

### 배포 (Cloudflare Worker `gem-guardians-admin`)
1. `npx wrangler login` (처음 한 번 - Cloudflare 계정)
2. `npm run deploy:admin` → 빌드 + 올리기. 끝에 나온 주소(`https://gem-guardians-admin.<서브도메인>.workers.dev`)를 적어 둔다.
3. 그 주소를 관리자 출처에 넣고 admin 함수를 다시 배포(이걸 안 하면 배포 주소에서 CORS로 막힘):
   ```
   npx supabase secrets set ADMIN_ORIGINS=https://gem-guardians-admin.<서브도메인>.workers.dev --project-ref jzpjqfbpqzghprqbqexp
   npx supabase functions deploy admin --project-ref jzpjqfbpqzghprqbqexp
   ```
   (주소가 여러 개면 콤마로. `http://localhost:5180`은 코드에 기본으로 들어 있음. **Routory(ffzjgiknrrgwvgobybdq)에는 절대 넣지 않는다.**)

### Cloudflare Access 켜기 (선택, 2중 잠금 - 페이지 자체를 쑹 이메일 OTP 뒤에 숨김)
1. Cloudflare 대시보드 → **Zero Trust**(처음이면 팀 이름 정하고 Free 플랜 - 50명까지 무료).
2. Workers & Pages → `gem-guardians-admin` → **Settings → Domains & Routes** → workers.dev 줄의 **Cloudflare Access** 켜기.
   - 안 보이면: Zero Trust → **Access → Applications → Add an application → Self-hosted** → 도메인에 `gem-guardians-admin.<서브도메인>.workers.dev`.
3. 정책(Policy): Action **Allow**, Include → **Emails** → 관리자 이메일(hansb81@naver.com). 로그인 방법은 기본 **One-time PIN**.
4. 시크릿 창에서 주소를 열어 Cloudflare 이메일 PIN 화면이 먼저 나오는지 확인 → PIN 통과 후 관리자 로그인 화면.
   (Access는 페이지만 숨긴다. admin 함수는 따로 aal2·admins 표로 막혀 있어서 Access가 없어도 안전함)

### 다시 배포할 것 (B단계)
- admin 함수: `npx supabase functions deploy admin --project-ref jzpjqfbpqzghprqbqexp` (active30d·compBest·sales 추가). DB 변경 없음.

## B단계 판정 (쑹 2026-11-19)

결정 1, 3~10 승인. 결정 2(우편 [회수]가 지급 묶음 전체)만 고침 - 마이그레이션 `20261118000000_admin_revoke_player.sql`.
- `admin_grant_revoke(..., p_player uuid default null)`: 있으면 **그 플레이어 몫만**(안 받은 우편 / 기기가 아직 안 받은 바로 지급 claims) 회수.
  지급 묶음 `admin_grants.revoked_at`은 그대로(다른 사람 몫은 살아 있음). 감사 `target_player` = 그 사람.
  그 사람이 지급 대상에 없으면 `notFound`, 전체 발송(사람별로 나눌 수 없음)에 p_player를 주면 `badRequest`.
- `grant.revoke {grantId, player?}`. 플레이어 상세 → 우편 탭 [회수]와 받은 보상 탭(미지급 `admin:N`) [회수]는 그 사람 몫만,
  지급 상세(`#grant/<id>`)의 **[전체 회수]**는 지금처럼 묶음 전체.
- 다시 배포: `npx supabase db push --linked`(링크가 GemGuardians인지 먼저 확인) → `npx supabase functions deploy admin --project-ref jzpjqfbpqzghprqbqexp`.
