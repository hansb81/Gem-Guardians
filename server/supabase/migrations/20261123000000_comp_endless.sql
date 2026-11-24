-- 경쟁 모드 판 규칙 확정(docs/ranking.md 5장): 하루 입장 p_daily회(KST 자정 초기화, 이월 없음) - 서버가 comp_runs로 센다.
-- 시작한 판은 끝내지 않아도 1회로 센다(중간 이탈 = 그때까지 점수로 제출, 못 내면 기록 없음).

drop function public.comp_start(uuid);

-- 오늘(KST) 시작한 판 수.
create function public.comp_used_today(p_player uuid)
returns int language sql stable set search_path = '' as $$
  select count(*)::int from public.comp_runs
   where player_id = p_player
     and (started_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date;
$$;

-- 판 시작: 지금 시즌 + 시즌 고정 시드. 오늘 p_daily판을 다 썼으면 reason 'dailyLimit'. left = 이 판 뒤 남은 횟수.
create function public.comp_start(p_player uuid, p_daily int)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_season text := public.comp_season(now());
  v_seed bigint := ('x' || lpad(substr(md5('comp:' || v_season), 1, 8), 16, '0'))::bit(64)::bigint;
  v_used int;
  v_run uuid;
begin
  perform 1 from public.players where id = p_player for update; -- 같은 사람 동시 시작 직렬화(횟수 넘김 방지)
  v_used := public.comp_used_today(p_player);
  if v_used >= p_daily then
    return jsonb_build_object('ok', false, 'reason', 'dailyLimit', 'left', 0);
  end if;
  insert into public.comp_runs (season_id, player_id, seed) values (v_season, p_player, v_seed) returning run_id into v_run;
  return jsonb_build_object('ok', true, 'runId', v_run, 'seasonId', v_season, 'seed', v_seed,
    'endsAt', public.comp_season_end(v_season), 'left', p_daily - v_used - 1);
end $$;

revoke all on function public.comp_used_today(uuid), public.comp_start(uuid, int) from public, anon, authenticated;
grant execute on function public.comp_used_today(uuid), public.comp_start(uuid, int) to service_role;
