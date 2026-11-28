# 이벤트 (배너 목록 + 1회 보상) v1

(2026-11-28 · 기획 원문 `docs/event.md`(= 프로젝트 파일 plan/events/launch-event-plan.md), 목업 `art/events/mockups/event_popup_mock.png`)

목표: 이번 한 번만 앱을 고치고, 그 뒤 이벤트는 **관리자 페이지 이벤트 탭**(또는 SQL)에서 추가하면 앱 업데이트 없이 팝업에 뜬다.
제목·설명·보상·기간·순서·마켓·켜기/끄기·**배너 그림**(Supabase Storage)이 전부 서버에서 온다. 앱에 든 그림은 출시 배너·기본 배너·받음 도장뿐.

## 1. 흐름

```
메뉴 [이벤트] (빨간 점) ─▶ 이벤트 팝업 'event' (배너 목록, 스크롤, 아래 광고 칸)
                              │ 배너 탭(끌기 스크롤과 구분: 8 basis px 미만 이동만 탭)
                              ▼
                       상세 팝업 'eventDetail' (광고 없음)
                       배너 · 설명 · 보상 칸 · 기간 · [받기]
                              │ 서버 event-claim (계정당 1번)
                              ▼
                       공통 획득 팝업(제목 = 이벤트 제목) → 목록 배너에 받음 도장
```

- 지급은 쿠폰과 똑같은 길: 서버 `claims`에 `event:{id}`(kind `event`) → 기기 `inventory.grant(bundle, {txId})` → `claims-granted`. 끊기면 다음 실행 때 `claims-pending`으로 다시 온다.
- 빨간 점: 받을 수 있고 안 받은 claim 이벤트가 하나라도 있으면 메뉴 이벤트 버튼 + 그 배너 오른쪽 위.
- 자동 열기: 튜토리얼 끝 + 메뉴에 다른 팝업 없음 + 출석 자동 팝업이 처리된 뒤(출석 기능 없음·오늘 받음·오늘 이미 자동으로 엶), 안 받은 claim 이벤트 중 **이 기기에서 자동으로 연 적 없는 것 하나**를 상세로 연다. storage `eventAutoOpened`(id 목록). 닫으면 다시 자동으로 안 연다.
- X·뒤로가기: 상세 → 이벤트 목록. 카드 바깥 탭은 다른 팝업처럼 전부 닫기.
- 서버 꺼짐·이벤트 기능 꺼짐·목록 비었음 = 지금처럼 "새 이벤트를 준비하고 있어요".

## 2. 서버 (Supabase `jzpjqfbpqzghprqbqexp`, Routory에는 절대 X)

마이그레이션 `server/supabase/migrations/20261128010000_events.sql` (20261128000000은 toss_restore가 이미 써서 01).

- `events` 표(s1_core)에 열 추가: `kind`(claim|notice, 기본 claim), `bundle`, `banner`(앱 안 그림 키), `banner_url`(Storage 공개 URL - 있으면 우선), `body_ko/en`, `platforms`(null = 전부, players.platform 값 web·toss·android·onestore·ios), `sort`, `created_at`. check: claim이면 `event_bundle_ok(bundle)`.
- `event_bundle_ok(b)`: 쿠폰 범위(다이아 5000·골드 100만·아이템 개당 99, 16종) + `spiritStones` 1~1000. (coupon_bundle_ok·admin_bundle_ok 둘 다 정령석을 안 받아서 새로 만듦)
- `event_claim(p_player, p_event)` 순서: banned → notFound(없음·꺼짐·kind≠claim) → notStarted → expired → platform → already → claims insert → `{ok, txId, bundle, title:{ko,en}}`. unique_violation → already.
- `event_list(p_player)`: 켜짐 + 기간 안 + 플랫폼 맞음, sort·starts_at 순. 줄마다 `{id, kind, title, body, banner, bannerUrl, bundle, startsAt, endsAt(ms), claimed}`.
- Edge Functions: `event-claim {eventId}`, `event-list {}`. `hello` 시작 정보에 `events`(event-list 응답) - 옛 앱은 모르는 키라 무시.
- 기능 스위치: `hello` FEATURES 기본 `events: true`, `config/server.json`은 `events: false`(이벤트 함수가 없는 옛 서버면 꺼진 채). 배포 없이 끄기: `supabase secrets set FEATURES='{"events":false}'`.
- Storage: 공개 버킷 `event-banners`(읽기 공개, 쓰기는 service role = admin 함수만). 파일명 `{eventId}-{SHA-256 앞 8자}.png` - 바꿀 때마다 새 이름이라 캐시 문제 없음.
- 테스트: `server/supabase/tests/event_test.ts`(순서·중복·기간·플랫폼·검사·권한), `admin_test.ts` 이벤트 action, `saves_test.ts` hello 시작 정보.

### 운영 SQL (SQL 편집기 전용, service_role에 grant 안 함 - 쿠폰과 같게)

```sql
-- 꺼진 상태로 미리 등록
select public.event_create('launch2026', '출시 기념 선물', 'Launch Gift',
  'Gem Guardians 정식 출시를 기념해 모든 수호자에게 선물을 드려요!',
  'To celebrate the launch of Gem Guardians, here''s a gift for every guardian!',
  '{"diamonds":100,"items":{"hammer":3,"scythe_h":3,"revive":1},"spiritStones":10}',
  now(), '2026-12-31 23:59:59+09', 'launch');   -- 꺼진 상태로 만들어짐
select public.event_set_enabled('launch2026', true);   -- 출시 때 켜기 (끌 때 false)
```

- `event_create(p_id, p_title_ko, p_title_en, p_body_ko, p_body_en, p_bundle, p_starts_at, p_ends_at, p_banner default null, p_platforms default null, p_sort default 0)`: id는 영문·숫자·_·- 1~40자, 번들은 `event_bundle_ok`, 끝 > 시작, id 중복이면 에러. **enabled = false로 만든다.**
- `event_set_enabled(p_id, p_on)`: 없는 id면 에러, 바뀐 상태 `{id, enabled}`를 돌려준다.
- 켜고 끈 것은 앱이 다음에 hello/event-list를 부를 때(시작·이벤트 팝업 열 때) 반영된다. 꺼진 이벤트는 목록에서 빠지고 event_claim은 notFound.
- 출시 이벤트 행은 마이그레이션에 넣지 않는다.

## 3. 기기

- `EventService`(src/net/services.js): `list`, `setList`, `refresh()`(실패하면 이전 목록 유지), `canClaim()`, `claim(id)`. 실패 reason: notFound / notStarted / expired / platform / already / banned / offline / error. already = 받음 표시 + 미지급 복구, expired = 끝남 표시.
- 판단 순수 함수 `src/game/eventRules.js`(tests/events.test.js): 기간 글자(KST, `Intl` Asia/Seoul), 버튼 상태, 자동 열기 조건, 탭/드래그, 모르는 kind 숨김.
- 연결: `src/game/serverUi.js`(hello events → `mainMenuScreen.events`, 'open:event' → event-list 새로고침, 'eventClaim:{id}', `autoOpenEvent`), `src/main.js`(출석 자동 팝업 다음 차례).
- 배너 고르기: `bannerUrl`(원격) → `ui/events/banner_{banner}.png` → `banner_default`. 원격은 `new Image()` + `crossOrigin='anonymous'`로 URL당 한 번만 받아 메모리에 둔다(실패해도 다시 안 조름). 236×55가 아니면 버림. 받는 동안·실패 = 앱 안 그림. 2배·스무딩 없음.
- 목록 줄 `[x, y, 472, 110]`: 제목 (x+52, y+36) 22 #f2d264, 기간 (x+52, y+78) 13 #a59cb2(왼쪽 정렬·외곽선). 받음 = rgba(13,10,16,0.55) 덮개 + 도장 2배 (x+388, y+22). 받을 수 있음 = menu/badge.png 3배 (x+442, y+6). 목록 끝 안내 "배너를 누르면 자세히 볼 수 있어요"(11, #a59cb2)는 이벤트가 있을 때만.
- 상세 `eventDetail` 500×660(설정 문장, 제목 "이벤트"): 배너 y+84 → 설명(15, 가운데, 줄 길이 고르게) y+226 → "보상" y+296 → 보상 칸 [가운데, y+314, 472, 128](N칸 균등, 아이템 4배·다이아·골드·정령석 3배, "x100" 15) → 기간 y+476 → "계정당 1번" y+500 → 실패 한 줄 y+528 → 버튼 [가운데, y+ch-104, 240, 60].
- 버튼: 받기(btn_gold) / 받는 중…(연타 막음) / 받았어요 / 기간이 끝났어요 / 인터넷 연결이 필요해요(btn_secondary, 못 누름). notice는 보상 칸·버튼 없음.
- 광고: `syncPopupBanner`가 `popup === 'event'`일 때만 띄워서 상세에서는 안 뜬다.
- 문구: `menu.event.hint`, `menu.eventDetail.*`(ko/en). 그림: `assets/ui/manifest.json`의 `events/*` 3장.

## 4. 관리자 페이지 이벤트 탭 (admin/src/events.js, docs/admin.md 방식)

- admin 함수 action: `event.list`(viewer, 받은 사람 수 = claims `event:{id}` 개수), `event.save`(owner, 만들기·고치기), `event.toggle`, `event.banner`(PNG 업로드 → Storage → banner_url). 쓰기는 전부 requestId·사유 필수 + `admin_audit`.
- 목록: 상태(켜짐/꺼짐/예정/끝남), 기간, 순서, 마켓, 보상, 받은 사람, 배너 그림.
- 폼: id(만들 때만), 제목·설명 ko/en, 종류(claim/notice), 앱 안 배너 키, 보상(기존 bundle.js 편집기 + 정령석 칸, 검사 = event_bundle_ok), 기간(KST 날짜, 끝은 23:59:59), 마켓 체크박스(없음 = 전부), 순서, 켜기.
- 이미 받은 사람이 있는 이벤트의 보상을 바꾸면 서버가 `bundleChanged`(받은 사람 수)로 막고, 확인창 한 번 더 → `confirmBundle`로 저장. 이미 받은 사람은 그대로.
- 배너 업로드: PNG만, 236×55 아니면 거부, 반투명 픽셀·16색 넘음은 경고만. 미리보기 = 2배·스무딩 없음 + 게임과 같은 위치의 제목·기간 + 받음 도장 켜고 끄기.
- SQL `event_create`/`event_set_enabled`도 그대로 쓸 수 있다(관리자 페이지 없이 운영 가능).

## 5. 앱 업데이트가 필요한 경우

- 지금 지원하는 종류: `claim`(1회 보상), `notice`(안내만, 버튼 없음).
- 새 **종류**(7일 로그인, 미션, 랭킹 이벤트 등)는 앱 수정이 필요하다. 모르는 kind는 앱이 목록에서 숨긴다(옛 앱 보호) - 서버에 먼저 넣어도 옛 앱은 안 보인다.
- 새 보상 키(정령석 말고 스킬·플래그 등)도 `event_bundle_ok`와 상세 보상 칸을 고쳐야 한다.

## 6. 배포 순서

1. `npx supabase projects list`로 연결된 프로젝트가 **jzpjqfbpqzghprqbqexp**(서울)인지 먼저 확인(Routory 절대 X) → `npx supabase db push --linked`
2. `npx supabase functions deploy event-claim event-list hello admin`
3. Storage에 `event-banners` 버킷이 공개로 생겼는지 확인
4. 관리자 사이트 다시 배포: `npm run deploy:admin`
5. 출시 이벤트 등록(위 SQL, 꺼진 상태) → 출시 때 켜기

## 7. 알아 둘 점

- 재설치 = 새 게스트 계정 → 다시 받을 수 있음(쿠폰과 같은 한계). Google 계정 연결한 사람은 같은 계정이라 다시 못 받음.
- 원격 배너 도메인(`*.supabase.co`): 웹·Capacitor는 CSP가 없어 막히지 않음. 토스 앱인토스의 외부 이미지 정책은 확인 못 함 - 막히면 앱 안 그림(banner)으로 대신 그려진다.
