-- 토스 재설치 복구(docs/auth.md §8 T): 새 익명 계정 N(이 기기, 아직 save·결제 없음)이 hello에서 토스 키 해시를 보냈을 때
-- 같은 해시의 옛 계정 O(삭제·Google 연결 아님, save 있음)가 있으면 O의 기록 전부를 N으로 옮긴다. N 세션은 그대로 두고
-- 데이터만 넘기는 이유: 서버는 익명 사용자 O의 세션을 새로 만들 수 없다. O auth 사용자 삭제는 hello가 관리자 API로 한다.
-- 주의: 토스 키는 기기가 보낸 값 그대로라(서버 확인 없음) 남의 키를 알면 진행을 가져갈 수 있다 - 키는 그 사람 토스 앱 안에만 있다.
create function public.toss_restore(p_to uuid, p_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  o public.players;
begin
  if p_hash is null or p_hash = '' then return jsonb_build_object('ok', false, 'reason', 'noKey'); end if;
  -- N이 새 계정일 때만(이미 진행·결제가 있으면 건드리지 않음).
  if exists (select 1 from public.saves where player_id = p_to)
     or exists (select 1 from public.purchases where player_id = p_to) then
    return jsonb_build_object('ok', false, 'reason', 'notFresh');
  end if;
  select p.* into o from public.players p join public.saves s on s.player_id = p.id
   where p.toss_key_hash = p_hash and p.id <> p_to and p.deleted_at is null and coalesce(cardinality(p.linked), 0) = 0
   order by s.updated_at desc limit 1
   for update of p;
  if not found then return jsonb_build_object('ok', false, 'reason', 'none'); end if;

  -- N의 시작 기록(hello 직후라 거의 없음)은 버리고 O 것으로.
  delete from public.claims where player_id = p_to;
  delete from public.attendance where player_id = p_to;
  delete from public.normal_best where player_id = p_to;
  delete from public.comp_runs where player_id = p_to;
  delete from public.comp_best where player_id = p_to;
  delete from public.season_results where player_id = p_to;
  delete from public.mail where player_id = p_to;
  delete from public.save_backups where player_id = p_to;
  delete from public.rate_calls where player_id = p_to;
  delete from public.coupon_tries where player_id = p_to;
  delete from public.ad_nonces where player_id = p_to;
  delete from public.merge_tickets where from_player = p_to;

  update public.claims set player_id = p_to where player_id = o.id;
  update public.attendance set player_id = p_to where player_id = o.id;
  update public.normal_best set player_id = p_to where player_id = o.id;
  update public.comp_runs set player_id = p_to where player_id = o.id;
  update public.comp_best set player_id = p_to where player_id = o.id;
  update public.season_results set player_id = p_to where player_id = o.id;
  update public.mail set player_id = p_to where player_id = o.id;
  update public.saves set player_id = p_to where player_id = o.id;
  update public.save_backups set player_id = p_to where player_id = o.id;
  update public.rate_calls set player_id = p_to where player_id = o.id;
  update public.coupon_tries set player_id = p_to where player_id = o.id;
  update public.purchases set player_id = p_to where player_id = o.id;
  update public.ad_views set player_id = p_to where player_id = o.id;
  delete from public.ad_nonces where player_id = o.id;
  delete from public.merge_tickets where from_player = o.id;
  update public.admin_grants set player_ids = array_replace(player_ids, o.id, p_to) where o.id = any(player_ids);

  -- 플레이어 줄: 닉네임(unique)은 O에서 먼저 비우고 N으로. 밴·숨김·메모도 따라간다.
  update public.players set nickname = null, legacy_id = null, toss_key_hash = null, deleted_at = now() where id = o.id;
  update public.players set nickname = o.nickname, statue = o.statue, created_at = o.created_at, banned = o.banned,
         note = o.note, rank_hidden = o.rank_hidden, legacy_id = coalesce(legacy_id, o.legacy_id)
   where id = p_to;
  -- 웹훅·문의에서 옛 id -> 지금 id(player_resolve).
  update public.player_merges set to_player = p_to where to_player = o.id;
  insert into public.player_merges (from_player, to_player, keep) values (o.id, p_to, 'toss')
  on conflict (from_player) do update set to_player = excluded.to_player, keep = excluded.keep, at = now();
  return jsonb_build_object('ok', true, 'from', o.id);
end $$;

revoke all on function public.toss_restore(uuid, text) from public, anon, authenticated;
grant execute on function public.toss_restore(uuid, text) to service_role;
