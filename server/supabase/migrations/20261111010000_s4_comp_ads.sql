-- S4 경쟁 랭킹(docs/ranking.md §13, docs/server.md §9) + 보상 광고 서버 확인(docs/server.md §8-2).
-- 권한 규칙은 S1과 같다: 클라이언트는 아무것도 못 함, Edge Function(service_role)만.

-- ---------- 경쟁 랭킹 ----------
-- 시즌 = 매주 월 00:00 KST 시작, id = KST ISO 주차 '2026-W45' (config/ranking.json resetDay 1, resetHourKst 0 기준).
create function public.comp_season(p_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select to_char(p_at at time zone 'Asia/Seoul', 'IYYY"-W"IW');
$$;
-- 시즌 끝 시각(= 다음 월 00:00 KST).
create function public.comp_season_end(p_season text)
returns timestamptz language sql stable set search_path = '' as $$
  select (to_date(p_season, 'IYYY"-W"IW')::timestamp + interval '7 days') at time zone 'Asia/Seoul';
$$;

create table public.comp_runs (
  run_id uuid primary key default gen_random_uuid(),
  season_id text not null,
  player_id uuid not null references public.players on delete cascade,
  seed bigint not null,
  points int,
  floor int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  log jsonb,                       -- 검증용 원본(끝난 시즌 4주 뒤 지움)
  verified boolean                 -- null = 검사 안 함, false = 상한 넘어 보류
);
create index comp_runs_player_idx on public.comp_runs (player_id, season_id);

create table public.comp_best (
  season_id text not null,
  player_id uuid not null references public.players on delete cascade,
  points int not null,
  floor int not null,
  at timestamptz not null,
  run_id uuid,
  primary key (season_id, player_id)
);
create index comp_best_rank_idx on public.comp_best (season_id, points desc, at asc);

create table public.season_results (
  season_id text not null,
  player_id uuid not null references public.players on delete cascade,
  rank int not null,
  pct int not null,
  tier_id text,
  points int not null,
  rewards jsonb,                   -- 받을 bundle(claims 'rank:{seasonId}'에 그대로)
  claimed_at timestamptz,
  primary key (season_id, player_id)
);

create table public.seasons_settled (
  season_id text primary key,
  settled_at timestamptz not null default now(),
  total int not null
);

-- ---------- 보상 광고 ----------
create table public.ad_nonces (
  nonce text primary key,
  player_id uuid not null references public.players on delete cascade,
  placement text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

-- AdMob SSV 콜백 원본(같은 transaction_id는 한 번만).
create table public.ad_views (
  transaction_id text primary key,
  player_id uuid references public.players on delete set null,
  nonce text,                      -- custom_data
  placement text,
  ad_unit text,
  reward_item text,
  reward_amount int,
  at timestamptz not null default now()
);
create index ad_views_nonce_idx on public.ad_views (nonce);

alter table public.comp_runs       enable row level security;
alter table public.comp_best       enable row level security;
alter table public.season_results  enable row level security;
alter table public.seasons_settled enable row level security;
alter table public.ad_nonces       enable row level security;
alter table public.ad_views        enable row level security;
revoke all on public.comp_runs, public.comp_best, public.season_results, public.seasons_settled,
              public.ad_nonces, public.ad_views from anon, authenticated;
grant select, insert, update, delete on public.comp_runs, public.comp_best, public.season_results,
      public.seasons_settled, public.ad_nonces, public.ad_views to service_role;

-- ---------- 함수 ----------
-- 판 시작: 지금 시즌 + 시즌 고정 시드(같은 주 = 같은 퍼즐 -> 나중에 log로 다시 계산해 검증, ranking §13-5).
create function public.comp_start(p_player uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_season text := public.comp_season(now());
  v_seed bigint := ('x' || lpad(substr(md5('comp:' || v_season), 1, 8), 16, '0'))::bit(64)::bigint;
  v_run uuid;
begin
  insert into public.comp_runs (season_id, player_id, seed) values (v_season, p_player, v_seed) returning run_id into v_run;
  return jsonb_build_object('ok', true, 'runId', v_run, 'seasonId', v_season, 'seed', v_seed,
    'endsAt', public.comp_season_end(v_season));
end $$;

-- 판 끝: 내 판·안 끝난 판·시즌 끝 30분 안(ranking §13-4)만. p_ok=false(상한 넘음)면 기록만 하고 순위엔 안 넣음.
-- 같은 시즌 최고 1판(points desc, 같으면 먼저 낸 쪽)만 comp_best에.
create function public.comp_finish(p_player uuid, p_run uuid, p_points int, p_floor int, p_log jsonb, p_ok boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.comp_runs;
  n int;
begin
  select * into r from public.comp_runs where run_id = p_run and player_id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  if r.ended_at is not null then return jsonb_build_object('ok', false, 'reason', 'already'); end if;
  if now() > public.comp_season_end(r.season_id) + interval '30 minutes'
     or exists (select 1 from public.seasons_settled where season_id = r.season_id) then
    update public.comp_runs set ended_at = now(), points = p_points, floor = p_floor, verified = false where run_id = p_run;
    return jsonb_build_object('ok', false, 'reason', 'seasonClosed', 'seasonId', r.season_id);
  end if;
  update public.comp_runs set ended_at = now(), points = p_points, floor = p_floor, log = p_log,
         verified = case when p_ok then null else false end
   where run_id = p_run;
  if not p_ok then return jsonb_build_object('ok', false, 'reason', 'held', 'seasonId', r.season_id); end if;
  insert into public.comp_best (season_id, player_id, points, floor, at, run_id)
  values (r.season_id, p_player, p_points, p_floor, now(), p_run)
  on conflict (season_id, player_id) do update
    set points = excluded.points, floor = excluded.floor, at = excluded.at, run_id = excluded.run_id
    where public.comp_best.points < excluded.points;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'updated', n = 1, 'seasonId', r.season_id);
end $$;

-- 순위에 드는 사람: 닉네임 있고 밴·삭제 아님, 점수 > 0.
create function public.comp_board(p_season text)
returns table (player_id uuid, nickname text, statue text, points int, floor int, at timestamptz, rank bigint, total bigint)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select c.player_id, p.nickname, p.statue, c.points, c.floor, c.at
      from public.comp_best c join public.players p on p.id = c.player_id
     where c.season_id = p_season and c.points > 0
       and p.nickname is not null and not p.banned and p.deleted_at is null
  )
  select *, row_number() over (order by points desc, at asc), count(*) over () from b;
$$;

-- 보상 구간(src/ranking/tiers.js tierOf와 같은 규칙): 표 위부터 처음 맞는 것. 순위 구간과 비율 구간이 겹치면 좋은 쪽.
create function public.comp_tier(p_tiers jsonb, p_rank bigint, p_total bigint)
returns jsonb language sql immutable set search_path = '' as $$
  select t from jsonb_array_elements(p_tiers) with ordinality as x(t, i)
   where case when t ? 'rank' then p_rank <= (t ->> 'rank')::int
              else p_rank <= ceil(p_total * (t ->> 'pct')::numeric / 100) end
   order by i limit 1;
$$;

-- 정산: 끝난 지 30분 지났고 아직 정산 안 한 시즌 전부(cron이 놓친 주도 다음 번에 따라잡음).
-- 보상 bundle = 구간 rewards, goldFloorMul(참여 보상)은 gold = 배수 x 층 기준가(p_floor_gold[그 시즌 최고 판 층], §22 C3-5).
-- p_floor_gold = _shared/floor_gold.json gold 배열(1층부터). 표보다 높은 층은 마지막 값.
-- 정리: 결과 8주, 끝난 시즌 판 log 4주, 1주 지난 광고 nonce.
create function public.comp_settle_due(p_tiers jsonb, p_floor_gold jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s text;
  done text[] := '{}';
  v_total int;
begin
  for s in
    select distinct c.season_id from public.comp_best c
     where now() > public.comp_season_end(c.season_id) + interval '30 minutes'
       and not exists (select 1 from public.seasons_settled z where z.season_id = c.season_id)
     order by 1
  loop
    insert into public.season_results (season_id, player_id, rank, pct, tier_id, points, rewards)
    select s, b.player_id, b.rank, greatest(1, ceil(b.rank * 100.0 / b.total))::int,
           t ->> 'id', b.points,
           ((t -> 'rewards') - 'goldFloorMul') || case when t -> 'rewards' ? 'goldFloorMul' then jsonb_build_object('gold',
             round((t -> 'rewards' ->> 'goldFloorMul')::numeric
                   * (p_floor_gold ->> (least(greatest(b.floor, 1), jsonb_array_length(p_floor_gold)) - 1))::numeric)::int)
           else '{}'::jsonb end
      from public.comp_board(s) b, lateral (select public.comp_tier(p_tiers, b.rank, b.total) t) x
    on conflict do nothing;
    get diagnostics v_total = row_count;
    insert into public.seasons_settled (season_id, total) values (s, v_total);
    done := done || s;
  end loop;
  delete from public.season_results r using public.seasons_settled z
   where z.season_id = r.season_id and z.settled_at < now() - interval '8 weeks';
  update public.comp_runs set log = null
   where log is not null and ended_at < now() - interval '4 weeks';
  delete from public.ad_nonces where created_at < now() - interval '7 days';
  return jsonb_build_object('settled', to_jsonb(done));
end $$;

-- 시즌 보상 받기: 정산 결과가 있고 보상이 있으면 claims 'rank:{seasonId}'(한 번만).
create function public.rank_claim(p_player uuid, p_season text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.season_results;
  v_tx text := 'rank:' || p_season;
begin
  select * into r from public.season_results where season_id = p_season and player_id = p_player for update;
  if not found or r.rewards is null or r.rewards = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'reason', 'none');
  end if;
  if r.claimed_at is not null then return jsonb_build_object('ok', false, 'reason', 'already', 'txId', v_tx); end if;
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'rank', r.rewards);
  update public.season_results set claimed_at = now() where season_id = p_season and player_id = p_player;
  return jsonb_build_object('ok', true, 'txId', v_tx, 'bundle', r.rewards);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'already', 'txId', v_tx);
end $$;

-- 광고 보상 1회. 하루 한도 = 오늘(KST) 이 배치의 claims kind=ad 개수(tx 'ad:{배치}:{날짜}:{n}').
-- 확인 방법 p_via: 'ssv' = 내 nonce에 SSV 콜백(ad_views)이 와 있어야 함 / 'adfree' = 광고 제거 결제 있음 /
-- 'device' = 기기 판정(토스 - 광고 서버 확인 없음). 'adfree'·'device' 자격은 Edge Function이 확인하고 부른다.
create function public.ad_claim(p_player uuid, p_placement text, p_nonce text, p_via text, p_today date,
  p_bundle jsonb, p_per_day int)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  n int;
  v_tx text;
  v_prefix text := 'ad:' || p_placement || ':' || to_char(p_today, 'YYYY-MM-DD') || ':';
begin
  if p_via = 'ssv' then
    perform 1 from public.ad_nonces where nonce = p_nonce and player_id = p_player and placement = p_placement for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
    if exists (select 1 from public.ad_nonces where nonce = p_nonce and used_at is not null) then
      return jsonb_build_object('ok', false, 'reason', 'already');
    end if;
    if not exists (select 1 from public.ad_views where nonce = p_nonce) then
      return jsonb_build_object('ok', false, 'reason', 'notYet'); -- SSV 콜백이 아직 - 기기가 잠시 뒤 다시
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_player::text || v_prefix));
  select count(*) into n from public.claims where player_id = p_player and kind = 'ad' and tx_id like v_prefix || '%';
  if n >= p_per_day then return jsonb_build_object('ok', false, 'reason', 'limit'); end if;
  v_tx := v_prefix || (n + 1);
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'ad', p_bundle);
  if p_via = 'ssv' then update public.ad_nonces set used_at = now() where nonce = p_nonce; end if;
  return jsonb_build_object('ok', true, 'txId', v_tx, 'bundle', p_bundle, 'left', p_per_day - n - 1);
end $$;

revoke all on function public.comp_season(timestamptz), public.comp_season_end(text), public.comp_start(uuid),
  public.comp_finish(uuid, uuid, int, int, jsonb, boolean), public.comp_board(text), public.comp_tier(jsonb, bigint, bigint),
  public.comp_settle_due(jsonb, jsonb), public.rank_claim(uuid, text),
  public.ad_claim(uuid, text, text, text, date, jsonb, int) from public, anon, authenticated;
grant execute on function public.comp_season(timestamptz), public.comp_season_end(text), public.comp_start(uuid),
  public.comp_finish(uuid, uuid, int, int, jsonb, boolean), public.comp_board(text), public.comp_tier(jsonb, bigint, bigint),
  public.comp_settle_due(jsonb, jsonb), public.rank_claim(uuid, text),
  public.ad_claim(uuid, text, text, text, date, jsonb, int) to service_role;

-- 데이터 삭제 요청: 경쟁 기록·광고 nonce도 지운다(ad_views는 결제처럼 연결만 끊김 - on delete set null 아님, 직접).
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
  update public.ad_views set player_id = null where player_id = p_player;
  update public.purchases set player_id = null where player_id = p_player;
  update public.players set nickname = null, legacy_id = null, toss_key_hash = null, deleted_at = now()
   where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

-- 정산: 일 15:31 UTC(= 월 00:31 KST). 시즌 끝(15:00 UTC) 뒤 30분은 늦게 끝난 판을 받는다(ranking §13-4).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    perform cron.schedule('comp-settle', '31 15 * * 0', $c$select public.cron_call('settle')$c$);
  end if;
end $$;
