-- L1 클라우드 저장(docs/auth.md §3): 기기 save.v2 블록을 한 덩어리(jsonb)로 보관. 다이아·골드는 여전히 기기가 주인이고
-- 서버는 보관 + 이상치 기록만(§1-D). 읽기·쓰기는 Edge Function(save-get, save-put)만.

-- ---------- 표 ----------
create table public.saves (
  player_id    uuid primary key references public.players on delete cascade,
  data         jsonb not null,          -- 기기 save.v2 블록 그대로 (adContinue 포함)
  save_version int not null,
  rev          bigint not null,         -- 올릴 때마다 +1
  summary      jsonb not null,          -- save_summary(data) - 충돌 화면·관리용, 기기가 보낸 값은 안 믿음
  device_id    text,
  platform     text,                    -- players.platform(기기 입력 아님)
  app_version  text,
  updated_at   timestamptz default now()
);

create table public.save_backups (
  id         bigserial primary key,
  player_id  uuid not null references public.players on delete cascade,
  data       jsonb not null,
  rev        bigint not null,
  reason     text not null check (reason in ('daily', 'overwrite', 'merge', 'restore', 'rewind')),
  created_at timestamptz default now()
);
create index save_backups_player_idx on public.save_backups (player_id, created_at desc);

alter table public.saves        enable row level security;
alter table public.save_backups enable row level security;
-- 정책 없음 = 클라이언트는 못 읽음(함수로만).
revoke all on public.saves, public.save_backups from anon, authenticated;
revoke all on sequence public.save_backups_id_seq from anon, authenticated;
grant select, insert, update, delete on public.saves, public.save_backups to service_role;
grant usage, select on sequence public.save_backups_id_seq to service_role;

-- ---------- 요약 ----------
-- 0 이상 정수(아니면 0). 1e15 넘는 값도 0(망가진 save).
create function public.save_int(v jsonb)
returns bigint language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(v) = 'number' and v::numeric >= 0 and v::numeric < 1e15 then trunc(v::numeric)::bigint else 0 end;
$$;

create function public.save_summary(d jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'bestFloor', public.save_int(d -> 'bestFloor'),
    'floor', public.save_int(d -> 'floor'),
    'diamonds', public.save_int(d -> 'diamonds'),
    'gold', public.save_int(d -> 'gold'),
    'towerSum', case when jsonb_typeof(d -> 'towerLevels') = 'array'
      then (select coalesce(sum(public.save_int(e)), 0) from jsonb_array_elements(d -> 'towerLevels') e) else 0 end,
    'tutorialDone', coalesce(d -> 'tutorial' -> 'done' = 'true'::jsonb, false));
$$;

-- KST(UTC+9 고정) 날짜 - _shared/kst.ts kstDate와 같은 규칙.
create function public.save_kst_date(t timestamptz)
returns date language sql immutable set search_path = '' as $$
  select ((t at time zone 'UTC') + interval '9 hours')::date;
$$;

-- ---------- 올리기 ----------
-- rev 낙관적 잠금: saves.rev = p_base_rev일 때만 저장(rev+1). 다르면 conflict + 서버 쪽 요약.
-- p_force = 충돌 화면에서 "이 기기"를 고른 경우 - 이전 서버 save를 save_backups(overwrite)로 남기고 덮어씀.
-- p_dia_by_key = { product_key: 다이아 상한 } (save-put이 products.json에서 만들어 넘김) - 이상치 판정용.
-- p_reason = 'rewind'(p_force와 같이): 기기가 아는 rev(p_local_rev)보다 서버 rev가 작음 = DB를 옛 백업으로 복구한 경우.
--   기기가 더 새것이라 덮되 이전 서버 save는 save_backups(rewind), server_log source save-rewind(warn).
create function public.save_put(p_player uuid, p_base_rev bigint, p_data jsonb, p_device text, p_platform text,
  p_app text, p_force boolean default false, p_dia_by_key jsonb default '{}'::jsonb,
  p_reason text default null, p_local_rev bigint default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s public.saves;
  v_ver numeric;
  v_sum jsonb;
  v_paid numeric;
  v_best int;
  v_last timestamptz;
  v_has boolean;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'badData');
  end if;
  if octet_length(p_data::text) > 262144 then return jsonb_build_object('ok', false, 'reason', 'tooBig'); end if;
  if jsonb_typeof(p_data -> 'saveVersion') is distinct from 'number' then return jsonb_build_object('ok', false, 'reason', 'badData'); end if;
  v_ver := (p_data ->> 'saveVersion')::numeric;
  if v_ver <> trunc(v_ver) or v_ver < 0 or v_ver > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'badData');
  end if;
  v_sum := public.save_summary(p_data);

  select * into s from public.saves where player_id = p_player for update;
  v_has := found;

  -- 이상치 기록(막지 않음, §1-D): 최고 층이 서버 랭킹 기록보다 50층 넘게 높음.
  select best_floor into v_best from public.normal_best where player_id = p_player;
  if (v_sum ->> 'bestFloor')::bigint > coalesce(v_best, 0) + 50 then
    insert into public.server_log (source, level, body) values ('save-put', 'warn', jsonb_build_object(
      'uid', p_player, 'kind', 'bestFloor', 'bestFloor', v_sum -> 'bestFloor', 'normalBest', coalesce(v_best, 0)));
  end if;

  if not v_has then
    if p_base_rev <> 0 and not p_force then
      return jsonb_build_object('ok', false, 'reason', 'conflict', 'server', null);
    end if;
    insert into public.saves (player_id, data, save_version, rev, summary, device_id, platform, app_version)
    values (p_player, p_data, v_ver::int, 1, v_sum, p_device, p_platform, p_app);
    return jsonb_build_object('ok', true, 'rev', 1);
  end if;

  if s.rev <> p_base_rev and not p_force then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'server', jsonb_build_object(
      'rev', s.rev, 'summary', s.summary, 'updatedAt', floor(extract(epoch from s.updated_at) * 1000)::bigint,
      'deviceId', s.device_id, 'platform', s.platform));
  end if;

  -- 백업: 강제 덮어쓰기면 overwrite, 아니면 하루 첫 저장(마지막 백업이 KST 오늘 이전)만 daily. 사람당 최근 3개.
  select max(created_at) into v_last from public.save_backups where player_id = p_player;
  if p_force and p_reason = 'rewind' then
    insert into public.server_log (source, level, body) values ('save-rewind', 'warn', jsonb_build_object(
      'uid', p_player, 'serverRev', s.rev, 'localRev', p_local_rev));
  end if;
  if p_force or v_last is null or public.save_kst_date(v_last) < public.save_kst_date(now()) then
    insert into public.save_backups (player_id, data, rev, reason)
    values (p_player, s.data, s.rev,
            case when p_force and p_reason = 'rewind' then 'rewind' when p_force then 'overwrite' else 'daily' end);
    delete from public.save_backups where player_id = p_player and id not in (
      select id from public.save_backups where player_id = p_player order by created_at desc, id desc limit 3);
  end if;

  -- 이상치 기록: 다이아가 (그 사이 확인된 결제 상한 + 5000)보다 많이 늘었음.
  select coalesce(sum(coalesce((p_dia_by_key ->> product_key)::numeric, 0)), 0) into v_paid
    from public.purchases
   where player_id = p_player and status in ('verified', 'granted')
     and coalesce(verified_at, purchased_at) > s.updated_at;
  if (v_sum ->> 'diamonds')::numeric - coalesce((s.summary ->> 'diamonds')::numeric, 0) > v_paid + 5000 then
    insert into public.server_log (source, level, body) values ('save-put', 'warn', jsonb_build_object(
      'uid', p_player, 'kind', 'diamonds', 'from', s.summary -> 'diamonds', 'to', v_sum -> 'diamonds', 'paid', v_paid));
  end if;

  update public.saves set data = p_data, save_version = v_ver::int, rev = s.rev + 1, summary = v_sum,
         device_id = p_device, platform = p_platform, app_version = p_app, updated_at = now()
   where player_id = p_player;
  return jsonb_build_object('ok', true, 'rev', s.rev + 1);
exception when unique_violation then
  -- 같은 플레이어 첫 저장 두 개가 동시에 - 늦은 쪽은 충돌(다음 시작 때 판정).
  return jsonb_build_object('ok', false, 'reason', 'conflict', 'server', null);
end $$;

revoke all on function public.save_int(jsonb), public.save_summary(jsonb), public.save_kst_date(timestamptz),
  public.save_put(uuid, bigint, jsonb, text, text, text, boolean, jsonb, text, bigint) from public, anon, authenticated;
grant execute on function public.save_int(jsonb), public.save_summary(jsonb), public.save_kst_date(timestamptz),
  public.save_put(uuid, bigint, jsonb, text, text, text, boolean, jsonb, text, bigint) to service_role;

-- 데이터 삭제 요청: 쿠폰 마이그레이션 본문 그대로 + saves·save_backups.
create or replace function public.me_delete(p_player uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.claims where player_id = p_player;
  delete from public.attendance where player_id = p_player;
  delete from public.normal_best where player_id = p_player;
  delete from public.mail where player_id = p_player;
  delete from public.rate_calls where player_id = p_player;
  delete from public.comp_runs where player_id = p_player;
  delete from public.comp_best where player_id = p_player;
  delete from public.season_results where player_id = p_player;
  delete from public.ad_nonces where player_id = p_player;
  delete from public.coupon_tries where player_id = p_player;
  delete from public.saves where player_id = p_player;
  delete from public.save_backups where player_id = p_player;
  update public.ad_views set player_id = null where player_id = p_player;
  update public.purchases set player_id = null where player_id = p_player;
  update public.players set nickname = null, legacy_id = null, toss_key_hash = null, deleted_at = now()
   where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

-- 30일 지난 save 백업 삭제(매일 04:37 UTC). pg_cron이 없는 곳(테스트용 PGlite)은 건너뛴다.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('save-backups-cleanup', '37 4 * * *',
      $c$delete from public.save_backups where created_at < now() - interval '30 days'$c$);
  end if;
end $$;
