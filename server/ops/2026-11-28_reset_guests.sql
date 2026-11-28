-- 오픈 후 전체 초기화(2026-11-28 결정). migrations가 아니다 - 배포일에 한 번 손으로 실행한다.
-- 실행: cd server && npx supabase db query --remote -f ops/2026-11-28_reset_guests.sql (확인 필요 - 되돌릴 수 없음)
-- 남김: Google 연결 계정과 그 데이터 전부, 관리자(admins), 결제 기록(purchases - player_id만 null), 쿠폰·이벤트 정의, 관리 감사 기록.
-- 지움: 그 밖의 계정(게스트) -> players와 하위 표는 on delete cascade로 함께. 전역 사용 기록(쿠폰 시도, 시즌 정산, 호출 제한, 서버 로그)도.
-- 백업: D:/Project/GemGuardians-backups/2026-11-28-pre-reset (JSON, 실행 직전에 한 번 더 받는다).
-- 앱 쪽: DATA_EPOCH 2(src/platform/storage.js) 버전이 나가는 날 실행한다.
begin;

create temp table keep_users on commit drop as
  select u.id from auth.users u
  where exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'google')
     or exists (select 1 from public.admins a where a.user_id = u.id);

-- 안전장치: 남길 계정 수가 예상(2026-11-28 조회 = Google 5 + 관리자 1 = 6)과 다르면 전부 취소. 실행일에 다시 세어 고친다.
do $$ begin
  if (select count(*) from keep_users) <> 6 then raise exception 'keep_users = %, 6이 아님 - 취소', (select count(*) from keep_users); end if;
end $$;

delete from auth.users u where not exists (select 1 from keep_users k where k.id = u.id);

-- 전역 사용 기록
delete from public.coupon_tries;
delete from public.seasons_settled;
delete from public.rate_calls;
delete from public.ad_nonces;
delete from public.server_log;
-- 쿠폰 사용 수 = 남은 계정이 받은 수(claims tx_id 'coupon:{campaign}')로 다시 센다. 코드가 하나뿐인 캠페인(공용)만 -
-- claims에는 어느 코드를 썼는지 없어서 일회용 묶음(캠페인 하나에 코드 여러 장)은 그대로 둔다(쓴 코드가 다시 열리지 않게).
update public.coupons c set uses = (select count(*) from public.claims cl where cl.tx_id = 'coupon:' || c.campaign)
where (select count(*) from public.coupons c2 where c2.campaign = c.campaign) = 1;

select (select count(*) from auth.users) as users_left, (select count(*) from public.players) as players_left,
  (select count(*) from public.purchases) as purchases_kept;

commit;
