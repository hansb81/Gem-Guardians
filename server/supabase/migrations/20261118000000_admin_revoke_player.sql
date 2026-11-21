-- 관리자 B단계 판정(docs/admin.md "B단계 판정"): 회수를 한 사람 몫만 할 수 있게.
-- admin_grant_revoke에 p_player(선택): 있으면 그 플레이어의 안 받은 우편 / 미지급 claims만 회수, 지급 묶음(admin_grants.revoked_at)은 그대로.
-- 전체 발송(player_ids null)은 사람별로 나눌 수 없어 p_player와 같이 오면 badRequest. 감사 target_player = 그 사람.

-- if exists / or replace: SQL 편집기로 먼저 실행된 DB(2026-11-19 운영)에서도 db push가 다시 돌 수 있게.
drop function if exists public.admin_grant_revoke(uuid, uuid, bigint, text, text);
create or replace function public.admin_grant_revoke(p_admin uuid, p_request uuid, p_grant bigint, p_reason text,
  p_ip text default null, p_player uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prev jsonb := public.admin_audit_prev(p_request);
  g public.admin_grants;
  v_rev int := 0;
  v_got int := 0;
  r jsonb;
begin
  if prev is not null then return prev; end if;
  select * into g from public.admin_grants where id = p_grant for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  if p_player is not null then
    if g.player_ids is null then return jsonb_build_object('ok', false, 'reason', 'badRequest'); end if;
    if not p_player = any(g.player_ids) then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  end if;
  if g.mode = 'mail' then
    select count(*) into v_got from public.mail m join public.claims c on c.tx_id = 'mail:' || m.id
     where m.grant_id = p_grant and (m.player_id is null or c.player_id = m.player_id)
       and (p_player is null or m.player_id = p_player);
    update public.mail m set revoked_at = now()
     where m.grant_id = p_grant and m.revoked_at is null and (p_player is null or m.player_id = p_player)
       and (m.player_id is null or not exists (
         select 1 from public.claims c where c.player_id = m.player_id and c.tx_id = 'mail:' || m.id));
    get diagnostics v_rev = row_count;
  else
    select count(*) into v_got from public.claims
     where tx_id = 'admin:' || p_grant and granted_at is not null and (p_player is null or player_id = p_player);
    delete from public.claims
     where tx_id = 'admin:' || p_grant and granted_at is null and (p_player is null or player_id = p_player);
    get diagnostics v_rev = row_count;
  end if;
  if p_player is null then
    update public.admin_grants set revoked_at = coalesce(revoked_at, now()) where id = p_grant;
  end if;
  r := jsonb_build_object('ok', true, 'grantId', p_grant, 'revoked', v_rev, 'received', v_got, 'player', p_player);
  insert into public.admin_audit (admin_id, action, target_player, target, request_id, reason, after, ip)
  values (p_admin, 'grant.revoke', coalesce(p_player, case when g.count = 1 then g.player_ids[1] end), 'grant:' || p_grant,
          p_request, p_reason, r, p_ip);
  return r;
end $$;

revoke all on function public.admin_grant_revoke(uuid, uuid, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_grant_revoke(uuid, uuid, bigint, text, text, uuid) to service_role;
