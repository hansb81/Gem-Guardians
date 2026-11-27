-- 일반 모드 층 상승 속도 상한(docs/server.md §9). 지난 기록(없으면 가입 시각) 이후 오른 층이
-- p_grace + 흐른 초 / p_sec_per_floor 를 넘으면 그 계정을 랭킹 숨김(players.rank_hidden)하고 server_log에 warn 한 줄.
-- 막지 않는다 - 기록은 그대로 올라가고 순위표에서만 빠진다(관리자 페이지에서 숨김 해제). 값은 _shared/ranking.ts NORMAL_LIMIT.
-- rank_normal_submit 앞에서 부른다(지난 기록을 읽어야 해서). 숨겼으면(이미 숨김 포함) true.
create function public.rank_normal_guard(p_player uuid, p_floor int, p_sec_per_floor numeric, p_grace int)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_floor int;
  v_since timestamptz;
  v_sec numeric;
begin
  select best_floor, reached_at into v_floor, v_since from public.normal_best where player_id = p_player;
  if not found then
    v_floor := 0;
    select created_at into v_since from public.players where id = p_player;
  end if;
  v_sec := extract(epoch from now() - coalesce(v_since, now()));
  if p_floor - v_floor <= p_grace + v_sec / p_sec_per_floor then return false; end if;
  update public.players set rank_hidden = true where id = p_player and not rank_hidden;
  if found then
    insert into public.server_log (source, level, body) values ('rank-normal', 'warn', jsonb_build_object(
      'uid', p_player, 'kind', 'floorSpeed', 'from', v_floor, 'to', p_floor, 'sec', round(v_sec)));
  end if;
  return true;
end $$;

revoke all on function public.rank_normal_guard(uuid, int, numeric, int) from public, anon, authenticated;
grant execute on function public.rank_normal_guard(uuid, int, numeric, int) to service_role;
