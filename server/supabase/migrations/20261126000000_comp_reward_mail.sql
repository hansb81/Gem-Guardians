-- 경쟁 주간 보상 = 우편(docs/ranking.md 5-4). 정산할 때 보상이 있는 사람마다 내 우편 1통(30일, 관리자 우편과 같은 기본값).
-- 받기는 우편과 같은 mail_claim('mail:{id}') - 예전 랭킹 팝업 받기(rank_claim, claims 'rank:{시즌}')는 지운다(두 번 받기 막기).
-- p_mail = ranking.json rewardsEnabled. false면 정산(순위 기록)만 하고 우편은 안 보낸다.
drop function public.rank_claim(uuid, text);
drop function public.comp_settle_due(jsonb, jsonb);

create function public.comp_settle_due(p_tiers jsonb, p_floor_gold jsonb, p_mail boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  s text;
  done text[] := '{}';
  v_total int;
  v_week text;
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
    if p_mail then
      v_week := ltrim(split_part(s, '-W', 2), '0');
      insert into public.mail (player_id, title_ko, title_en, bundle, expires_at)
      select r.player_id, '경쟁 모드 ' || v_week || '주차 보상 · ' || r.rank || '위',
             'Competitive W' || v_week || ' reward · #' || r.rank, r.rewards, now() + interval '30 days'
        from public.season_results r
       where r.season_id = s and r.rewards is not null and r.rewards <> '{}'::jsonb;
    end if;
    done := done || s;
  end loop;
  delete from public.season_results r using public.seasons_settled z
   where z.season_id = r.season_id and z.settled_at < now() - interval '8 weeks';
  update public.comp_runs set log = null
   where log is not null and ended_at < now() - interval '4 weeks';
  delete from public.ad_nonces where created_at < now() - interval '7 days';
  return jsonb_build_object('settled', to_jsonb(done));
end $$;

revoke all on function public.comp_settle_due(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.comp_settle_due(jsonb, jsonb, boolean) to service_role;
