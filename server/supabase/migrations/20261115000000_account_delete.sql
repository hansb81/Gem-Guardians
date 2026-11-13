-- 계정 삭제 L3(docs/auth.md §6): 오래된 게스트 정리 cron(§6-1). 계정 삭제 본문은 me-delete(_shared/account.ts).
-- purchases.player_id는 S2부터 "references players on delete set null" - auth.users 삭제 cascade로 결제 줄이 지워지지 않는다
-- (me_delete가 먼저 null로 바꾸고, 놓쳐도 set null). ad_views도 set null.

-- 익명 + 180일 접속 없음 + 결제 0건(어떤 상태든) -> auth.users 삭제(players 이하 cascade). 한 번에 p_limit명, 지운 수를 server_log에.
-- plpgsql: auth.users.is_anonymous는 Supabase에만 있는 열이라(테스트 PGlite 흉내에는 테스트가 붙임) 실행 때만 본다.
create function public.anon_cleanup(p_limit int default 500)
returns int language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  with gone as (
    delete from auth.users u
     where u.id in (
       select p.id from public.players p join auth.users a on a.id = p.id
        where a.is_anonymous
          and coalesce(p.last_seen_at, p.created_at) < now() - interval '180 days'
          and not exists (select 1 from public.purchases x where x.player_id = p.id)
        order by coalesce(p.last_seen_at, p.created_at)
        limit p_limit)
    returning 1)
  select count(*) into n from gone;
  insert into public.server_log (source, level, body) values ('anon-cleanup', 'info', jsonb_build_object('deleted', n));
  return n;
end $$;

revoke all on function public.anon_cleanup(int) from public, anon, authenticated;

-- 매일 05:13 UTC. pg_cron이 없는 곳(테스트용 PGlite)은 건너뛴다.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('anon-cleanup', '13 5 * * *', $c$select public.anon_cleanup(500)$c$);
  end if;
end $$;
