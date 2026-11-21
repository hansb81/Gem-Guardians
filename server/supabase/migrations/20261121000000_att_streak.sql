-- 연속 출석 보너스 (docs/server.md §8-1). 출석판 7칸(days)은 그대로 누적, 연속(streak)은 따로 센다.
alter table public.attendance
  add column streak int not null default 0,         -- 지금 연속 일수(last_date 기준 - 표시할 때 끊겼는지는 att-status가 판단)
  add column best_streak int not null default 0,    -- 최고 기록(운영 참고)
  add column streak_bonuses int not null default 0; -- 연속 보너스 받은 횟수

-- bundle 두 개 합치기: diamonds·gold는 더하고 items는 id별 개수를 더한다. null·없는 키 안전, 그 밖의 키는 b 우선으로 남김.
create function public.bundle_add(a jsonb, b jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  with o as (
    select case when jsonb_typeof(a) = 'object' then a else '{}'::jsonb end as x,
           case when jsonb_typeof(b) = 'object' then b else '{}'::jsonb end as y
  ), it as (
    select e.key, sum(e.value::numeric) as n
      from o, lateral (
        select * from jsonb_each_text(case when jsonb_typeof(o.x -> 'items') = 'object' then o.x -> 'items' else '{}'::jsonb end)
        union all
        select * from jsonb_each_text(case when jsonb_typeof(o.y -> 'items') = 'object' then o.y -> 'items' else '{}'::jsonb end)
      ) e
     group by e.key
  )
  select (((o.x || o.y) - 'diamonds') - 'gold') - 'items' || jsonb_strip_nulls(jsonb_build_object(
    'diamonds', nullif(coalesce((o.x ->> 'diamonds')::numeric, 0) + coalesce((o.y ->> 'diamonds')::numeric, 0), 0),
    'gold', nullif(coalesce((o.x ->> 'gold')::numeric, 0) + coalesce((o.y ->> 'gold')::numeric, 0), 0),
    'items', (select jsonb_object_agg(it.key, it.n) from it)))
    from o;
$$;

-- 되채우기: claims의 att:YYYY-MM-DD 날짜에서 연속 구간(날짜 - 순번이 같은 묶음)을 구해
-- last_date에서 끝나는 구간 = streak, 가장 긴 구간 = best_streak. last_date가 오늘·어제(KST)가 아니면 이미 끊긴 것 = 0.
with d as (
  select player_id, substring(tx_id from 5)::date as day
    from public.claims
   where kind = 'att' and tx_id like 'att:%' and tx_id ~ '^att:\d{4}-\d{2}-\d{2}$'
), g as (
  select player_id, day, day - (row_number() over (partition by player_id order by day))::int as grp from d
), runs as (
  select player_id, max(day) as last_day, count(*)::int as len from g group by player_id, grp
), s as (
  select r.player_id, max(r.len) as best, coalesce(max(r.len) filter (where r.last_day = t.last_date), 0) as cur
    from runs r join public.attendance t on t.player_id = r.player_id
   group by r.player_id
)
update public.attendance t
   set best_streak = s.best,
       streak = case when t.last_date >= ((now() at time zone 'UTC') + interval '9 hours')::date - 1 then s.cur else 0 end
  from s where s.player_id = t.player_id;

-- 출석 1회 + 연속. 옛 3인자 함수는 버린다(att-claim 함수와 함께 배포 - 그 사이 몇 초는 출석이 실패, 기기는 다시 시도).
-- p_streak = { goal, bonus } (_shared/attendance.ts ATTENDANCE_STREAK). txId는 그대로 att:{날짜} 하나, bundle은 판 보상 + 연속 보너스 합친 것 하나.
drop function public.att_claim(uuid, date, jsonb);
create function public.att_claim(p_player uuid, p_today date, p_bundles jsonb, p_streak jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a public.attendance;
  n int;
  v_day int;
  v_tx text := 'att:' || to_char(p_today, 'YYYY-MM-DD');
  v_bundle jsonb;
  v_streak int;
  v_goal int := coalesce((p_streak ->> 'goal')::int, 0);
  v_bonus jsonb := null;
begin
  insert into public.attendance (player_id, cycle_id, days) values (p_player, 'c1', 0)
    on conflict (player_id) do nothing;
  select * into a from public.attendance where player_id = p_player for update;
  if a.last_date is not null and a.last_date >= p_today then
    return jsonb_build_object('ok', false, 'reason', 'already', 'day', a.days, 'cycleId', a.cycle_id, 'streak', a.streak);
  end if;
  if a.days >= 7 then
    n := coalesce(nullif(substring(a.cycle_id from 2), '')::int, 1) + 1;
    a.cycle_id := 'c' || n;
    a.days := 0;
  end if;
  v_day := a.days + 1;
  v_bundle := p_bundles -> (v_day - 1);
  v_streak := case when a.last_date = p_today - 1 then a.streak + 1 else 1 end;
  if v_goal > 0 and v_streak % v_goal = 0 and p_streak -> 'bonus' is not null then
    v_bonus := p_streak -> 'bonus';
    v_bundle := public.bundle_add(v_bundle, v_bonus);
  end if;
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'att', v_bundle);
  update public.attendance
     set cycle_id = a.cycle_id, days = v_day, last_date = p_today, streak = v_streak,
         best_streak = greatest(best_streak, v_streak),
         streak_bonuses = streak_bonuses + case when v_bonus is null then 0 else 1 end
   where player_id = p_player;
  return jsonb_build_object('ok', true, 'day', v_day, 'cycleId', a.cycle_id, 'txId', v_tx, 'bundle', v_bundle,
                            'streak', v_streak, 'streakBonus', v_bonus);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'already', 'streak', a.streak);
end $$;

revoke all on function public.att_claim(uuid, date, jsonb, jsonb), public.bundle_add(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.att_claim(uuid, date, jsonb, jsonb), public.bundle_add(jsonb, jsonb) to service_role;
