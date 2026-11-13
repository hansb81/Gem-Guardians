-- 계정 연결 L2(docs/auth.md §4-3): 게스트 A가 이미 다른 플레이어 B에 붙은 Google 계정으로 로그인할 때
-- A의 기록 중 사라지면 안 되는 것만 B로 옮기고(account_merge) A를 지운다(account-merge가 auth.users A 삭제).
-- merge_tickets = A 세션이 사라지기 전에 받아 두는 10분짜리 1회용 표. player_merges = A -> B 기록
-- (players A 줄은 auth.users 삭제 때 cascade로 지워지므로 따로 남긴다 - RevenueCat 웹훅이 A id로 와도 B로).

-- ---------- 표 ----------
alter table public.players add column linked text[]; -- 연결된 로그인 수단(['google'] 등) - hello가 auth identities로 갱신

create table public.merge_tickets (
  ticket      text primary key,
  from_player uuid not null references public.players on delete cascade,
  expires_at  timestamptz not null,
  used        boolean not null default false
);

create table public.player_merges (
  from_player uuid primary key, -- FK 없음: A는 곧 지워진다
  to_player   uuid not null,
  keep        text not null,
  at          timestamptz default now()
);

alter table public.merge_tickets enable row level security;
alter table public.player_merges enable row level security;
revoke all on public.merge_tickets, public.player_merges from anon, authenticated;
grant select, insert, update, delete on public.merge_tickets, public.player_merges to service_role;

-- ---------- 표 받기 ----------
-- 지금 사용자(A, 익명인지는 함수가 확인) -> { ok, ticket, purchases }. purchases = A 결제 수(빈 게스트 판정, 충돌 화면 "결제 n건").
create function public.merge_ticket_new(p_player uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v text := encode(public.coupon_random_bytes(), 'hex');
begin
  delete from public.merge_tickets where from_player = p_player and (used or expires_at < now());
  insert into public.merge_tickets (ticket, from_player, expires_at) values (v, p_player, now() + interval '10 minutes');
  return jsonb_build_object('ok', true, 'ticket', v, 'purchases',
    (select count(*) from public.purchases where player_id = p_player and status in ('verified', 'granted')));
end $$;

-- ---------- 옮기기 (docs/auth.md §4-3 표) ----------
create function public.account_merge(p_from uuid, p_to uuid, p_keep text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  if p_keep not in ('server', 'device') or p_from = p_to then
    return jsonb_build_object('ok', false, 'reason', 'badRequest');
  end if;
  -- 결제: B로(비소모성 효과는 기기가 스토어 복원으로 다시 받음).
  update public.purchases set player_id = p_to where player_id = p_from;
  get diagnostics n = row_count;
  -- 쿠폰·시즌 보상: B로(B에 같은 tx_id가 있으면 A 것 버림) - 같은 쿠폰을 두 계정으로 두 번 받는 것을 막음.
  delete from public.claims a where a.player_id = p_from and (a.tx_id like 'coupon:%' or a.tx_id like 'rank:%')
     and exists (select 1 from public.claims b where b.player_id = p_to and b.tx_id = a.tx_id);
  update public.claims set player_id = p_to where player_id = p_from and (tx_id like 'coupon:%' or tx_id like 'rank:%');
  -- 미지급(granted_at null): 이 기기 save를 골랐으면 B로 옮겨 다시 내려줌, 서버 save면 버림.
  if p_keep = 'device' then
    update public.claims a set player_id = p_to where a.player_id = p_from and a.granted_at is null
       and not exists (select 1 from public.claims b where b.player_id = p_to and b.tx_id = a.tx_id);
    -- A normal_best가 더 높으면 B를 그 값으로.
    insert into public.normal_best (player_id, best_floor, reached_at)
    select p_to, best_floor, reached_at from public.normal_best where player_id = p_from
    on conflict (player_id) do update set best_floor = excluded.best_floor, reached_at = excluded.reached_at
      where public.normal_best.best_floor < excluded.best_floor;
  end if;
  -- 나머지 A 기록: B 것 유지, A 것 삭제(auth.users 삭제 cascade가 지우는 것도 여기서 먼저 - 삭제가 실패해도 남지 않게).
  delete from public.claims where player_id = p_from;
  delete from public.attendance where player_id = p_from;
  delete from public.normal_best where player_id = p_from;
  delete from public.comp_runs where player_id = p_from;
  delete from public.comp_best where player_id = p_from;
  delete from public.season_results where player_id = p_from;
  delete from public.mail where player_id = p_from;
  delete from public.saves where player_id = p_from;
  delete from public.save_backups where player_id = p_from;
  delete from public.rate_calls where player_id = p_from;
  delete from public.coupon_tries where player_id = p_from;
  insert into public.player_merges (from_player, to_player, keep) values (p_from, p_to, p_keep)
  on conflict (from_player) do update set to_player = excluded.to_player, keep = excluded.keep, at = now();
  return jsonb_build_object('ok', true, 'movedPurchases', n);
end $$;

-- 표 확인(있음·안 씀·안 지남·A != B) + 옮기기 + 표 씀 처리를 한 트랜잭션으로. -> { ok, from, movedPurchases } | reason
create function public.merge_ticket_redeem(p_ticket text, p_to uuid, p_keep text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  t public.merge_tickets;
  r jsonb;
begin
  select * into t from public.merge_tickets where ticket = p_ticket for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'badTicket'); end if;
  if t.used then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if t.from_player = p_to then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  r := public.account_merge(t.from_player, p_to, p_keep);
  if not (r ->> 'ok')::boolean then return r; end if;
  update public.merge_tickets set used = true where ticket = p_ticket;
  return r || jsonb_build_object('from', t.from_player);
end $$;

-- 웹훅 등: 여러 id 후보(app_user_id·aliases) -> 지금 플레이어. 합쳐진 id는 to_player로 따라간다(여러 번 합쳐졌어도).
create function public.player_resolve(p_ids uuid[])
returns uuid language plpgsql stable security invoker set search_path = '' as $$
declare
  v uuid;
  nxt uuid;
  i int := 0;
begin
  select coalesce((select m.to_player from public.player_merges m where m.from_player = any(p_ids) limit 1),
                  (select p.id from public.players p where p.id = any(p_ids) limit 1)) into v;
  while v is not null and i < 5 loop
    select to_player into nxt from public.player_merges where from_player = v;
    exit when nxt is null;
    v := nxt;
    i := i + 1;
  end loop;
  return v;
end $$;

revoke all on function public.merge_ticket_new(uuid), public.account_merge(uuid, uuid, text),
  public.merge_ticket_redeem(text, uuid, text), public.player_resolve(uuid[]) from public, anon, authenticated;
grant execute on function public.merge_ticket_new(uuid), public.account_merge(uuid, uuid, text),
  public.merge_ticket_redeem(text, uuid, text), public.player_resolve(uuid[]) to service_role;
grant execute on function public.coupon_random_bytes() to service_role; -- merge_ticket_new 안에서

-- 데이터 삭제 요청: saves 마이그레이션 본문 그대로 + merge_tickets.
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
  delete from public.merge_tickets where from_player = p_player;
  update public.ad_views set player_id = null where player_id = p_player;
  update public.purchases set player_id = null where player_id = p_player;
  update public.players set nickname = null, legacy_id = null, toss_key_hash = null, deleted_at = now()
   where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

-- 지난 표 삭제(매일 04:41 UTC). pg_cron이 없는 곳(테스트용 PGlite)은 건너뛴다.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('merge-tickets-cleanup', '41 4 * * *',
      $c$delete from public.merge_tickets where expires_at < now() - interval '1 day'$c$);
  end if;
end $$;
