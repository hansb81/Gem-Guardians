-- S1 (docs/server.md §5, §11): players, claims, attendance, events, mail, server_log, normal_best.
-- purchases / ad_views / comp_* 는 S2 이후.
--
-- 프로젝트 설정(쑹 2026-11-09): Data API 켬, "새 표 자동 노출" 끔, "자동 RLS" 켬.
-- 그래서 표마다 GRANT를 직접 쓴다. 로컬(supabase start)은 기본 권한이 anon/authenticated에도 열려 있어
-- 먼저 revoke all 하고 필요한 것만 다시 준다 - 두 환경이 같은 결과가 된다.
--   service_role  : Edge Function이 쓰는 권한 (RLS 우회, 그래도 GRANT는 필요)
--   authenticated : 본인 행 select가 필요한 표(players, claims, attendance)만 select
--   anon          : 없음
-- 클라이언트의 직접 insert/update/delete는 없다 - 모든 쓰기는 Edge Function(service_role)을 거친다.

-- ---------- 표 ----------
create table public.players (
  id uuid primary key references auth.users on delete cascade,
  legacy_id text,                 -- 기존 로컬 ranking.profile.playerId
  platform text,                  -- web|toss|play|onestore|ios (마지막 접속)
  nickname text unique,           -- 랭킹 닉네임 (금칙어·중복은 rank-profile이 검사)
  statue text default 'red',
  toss_key_hash text,
  created_at timestamptz default now(),
  last_seen_at timestamptz,
  banned boolean default false,
  deleted_at timestamptz,         -- me-delete(데이터 삭제 요청) 시각
  note text                       -- 쑹 메모
);

create table public.claims (
  player_id uuid references public.players on delete cascade,
  tx_id text,                     -- 'att:2026-11-09', 'mail:123' … = 기기 grantedTx
  kind text not null,             -- att|free|pass|ad|event|rank|mail
  bundle jsonb not null,
  claimed_at timestamptz default now(),
  granted_at timestamptz,         -- 기기 지급 확인(없으면 claims-pending으로 다시 내려줌)
  primary key (player_id, tx_id)
);
create index claims_pending_idx on public.claims (player_id) where granted_at is null;

create table public.attendance (
  player_id uuid primary key references public.players on delete cascade,
  cycle_id text,                  -- 7일판 회차 'c1', 'c2' …
  days int not null default 0,    -- 이번 판에서 받은 날 수(0~7)
  last_date date                  -- 마지막으로 받은 KST 날짜
);

create table public.events (
  id text primary key, title_ko text, title_en text, starts_at timestamptz,
  ends_at timestamptz, rules jsonb, enabled boolean default false
);

create table public.mail (
  id bigserial primary key,
  player_id uuid null references public.players on delete cascade, -- null = 전체 발송
  title_ko text, title_en text,
  bundle jsonb not null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table public.server_log (
  id bigserial primary key, at timestamptz default now(), source text, level text, body jsonb
);

-- docs/ranking.md §13-2. 순위 = best_floor desc, reached_at asc.
create table public.normal_best (
  player_id uuid primary key references public.players on delete cascade,
  best_floor int not null,
  reached_at timestamptz not null default now()
);
create index normal_best_rank_idx on public.normal_best (best_floor desc, reached_at asc);

-- ---------- RLS ----------
alter table public.players     enable row level security;
alter table public.claims      enable row level security;
alter table public.attendance  enable row level security;
alter table public.events      enable row level security;
alter table public.mail        enable row level security;
alter table public.server_log  enable row level security;
alter table public.normal_best enable row level security;

create policy players_own_select    on public.players    for select to authenticated using (id = (select auth.uid()));
create policy claims_own_select     on public.claims     for select to authenticated using (player_id = (select auth.uid()));
create policy attendance_own_select on public.attendance for select to authenticated using (player_id = (select auth.uid()));
-- events, mail, server_log, normal_best: 정책 없음 = 클라이언트는 못 읽음(함수로만).

-- ---------- GRANT ----------
revoke all on public.players, public.claims, public.attendance, public.events, public.mail,
              public.server_log, public.normal_best from anon, authenticated;
revoke all on sequence public.mail_id_seq, public.server_log_id_seq from anon, authenticated;

grant select on public.players, public.claims, public.attendance to authenticated;

grant select, insert, update, delete on public.players, public.claims, public.attendance, public.events,
      public.mail, public.server_log, public.normal_best to service_role;
grant usage, select on sequence public.mail_id_seq, public.server_log_id_seq to service_role;

-- ---------- 함수 (service_role만 실행) ----------
-- 출석 1회 (docs/server.md §8-1). 한 트랜잭션: last_date < today 확인 → days+1 → claims insert → bundle.
-- p_today = 서버가 계산한 KST 날짜(테스트에서 주입). p_bundles = 7칸 보상표(_shared/attendance.ts).
-- 7일판 반복: 7칸을 다 받은 다음 날 새 판(c{n+1}) 1일. 빠진 날은 그냥 다음 칸.
create function public.att_claim(p_player uuid, p_today date, p_bundles jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a public.attendance;
  n int;
  v_day int;
  v_tx text := 'att:' || to_char(p_today, 'YYYY-MM-DD');
  v_bundle jsonb;
begin
  insert into public.attendance (player_id, cycle_id, days) values (p_player, 'c1', 0)
    on conflict (player_id) do nothing;
  select * into a from public.attendance where player_id = p_player for update;
  if a.last_date is not null and a.last_date >= p_today then
    return jsonb_build_object('ok', false, 'reason', 'already', 'day', a.days, 'cycleId', a.cycle_id);
  end if;
  if a.days >= 7 then
    n := coalesce(nullif(substring(a.cycle_id from 2), '')::int, 1) + 1;
    a.cycle_id := 'c' || n;
    a.days := 0;
  end if;
  v_day := a.days + 1;
  v_bundle := p_bundles -> (v_day - 1);
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'att', v_bundle);
  update public.attendance set cycle_id = a.cycle_id, days = v_day, last_date = p_today where player_id = p_player;
  return jsonb_build_object('ok', true, 'day', v_day, 'cycleId', a.cycle_id, 'txId', v_tx, 'bundle', v_bundle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'already');
end $$;

-- 우편 1통 받기: 내 것(또는 전체)이고 안 지났으면 claims 'mail:{id}'. 이미 받았으면 already.
create function public.mail_claim(p_player uuid, p_mail bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  m public.mail;
  v_tx text := 'mail:' || p_mail;
begin
  select * into m from public.mail
   where id = p_mail and (player_id is null or player_id = p_player)
     and (expires_at is null or expires_at > now());
  if not found then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'mail', m.bundle);
  return jsonb_build_object('ok', true, 'txId', v_tx, 'bundle', m.bundle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'already');
end $$;

-- 일반 모드 기록: 이전보다 높을 때만 갱신. 도달 시각은 서버 now() (기기 시각은 믿지 않음).
create function public.rank_normal_submit(p_player uuid, p_floor int)
returns jsonb language sql security invoker set search_path = '' as $$
  with up as (
    insert into public.normal_best (player_id, best_floor, reached_at) values (p_player, p_floor, now())
    on conflict (player_id) do update set best_floor = excluded.best_floor, reached_at = excluded.reached_at
      where public.normal_best.best_floor < excluded.best_floor
    returning 1
  )
  select jsonb_build_object('ok', true, 'updated', exists (select 1 from up));
$$;

-- 순위표: 닉네임 있고 밴·삭제 아닌 사람만.
create function public.rank_normal_top(p_limit int)
returns table (player_id uuid, nickname text, statue text, best_floor int, reached_at timestamptz, rank bigint, total bigint)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select n.player_id, p.nickname, p.statue, n.best_floor, n.reached_at
      from public.normal_best n join public.players p on p.id = n.player_id
     where p.nickname is not null and not p.banned and p.deleted_at is null
  )
  select *, row_number() over (order by best_floor desc, reached_at asc), count(*) over ()
    from b order by best_floor desc, reached_at asc limit p_limit;
$$;

create function public.rank_normal_me(p_player uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with b as (
    select n.player_id, n.best_floor, n.reached_at
      from public.normal_best n join public.players p on p.id = n.player_id
     where p.nickname is not null and not p.banned and p.deleted_at is null
  ), me as (select * from public.normal_best where player_id = p_player)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'value', (select best_floor from me),
    'at', (select reached_at from me),
    'rank', (select count(*) + 1 from b, me where b.best_floor > me.best_floor
               or (b.best_floor = me.best_floor and b.reached_at < me.reached_at)),
    'total', (select count(*) from b) + case when exists (select 1 from b where player_id = p_player) then 0 else 1 end
  ) end;
$$;

-- 데이터 삭제 요청: 출석·지급·랭킹 기록 삭제, 닉네임 등 식별 값 비움, deleted_at 표시.
-- TODO(S2): purchases는 전자상거래법 5년 보관 - 삭제 대신 player_id 연결만 끊는 익명화 규칙 적용(docs/server.md §14-2).
create function public.me_delete(p_player uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.claims where player_id = p_player;
  delete from public.attendance where player_id = p_player;
  delete from public.normal_best where player_id = p_player;
  delete from public.mail where player_id = p_player;
  update public.players set nickname = null, legacy_id = null, toss_key_hash = null, deleted_at = now()
   where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.att_claim(uuid, date, jsonb), public.mail_claim(uuid, bigint),
  public.rank_normal_submit(uuid, int), public.rank_normal_top(int), public.rank_normal_me(uuid),
  public.me_delete(uuid) from public, anon, authenticated;
grant execute on function public.att_claim(uuid, date, jsonb), public.mail_claim(uuid, bigint),
  public.rank_normal_submit(uuid, int), public.rank_normal_top(int), public.rank_normal_me(uuid),
  public.me_delete(uuid) to service_role;
