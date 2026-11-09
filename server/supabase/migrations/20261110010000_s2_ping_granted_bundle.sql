-- docs/server.md §20 판정 반영.
-- #12 깨우기 = JWT 없는 ping 함수(IP당 분당 10회). 예전 깨우기가 만든 익명 사용자는 지운다(players는 cascade).
-- #3  iap-granted가 기기가 실제로 지급한 bundle(첫 구매 2배 반영)을 purchases.granted_bundle에 저장.

-- ping: DB를 한 번 건드리는 것(호출 카운트)이 곧 깨우기. IP는 rate_calls(player_id uuid)에 md5 해시로 넣는다.
create function public.ping_hit(p_ip text)
returns boolean language sql security invoker set search_path = '' as $$
  select public.rate_hit(md5('ip:' || p_ip)::uuid, 'ping', 10);
$$;
revoke all on function public.ping_hit(text) from public, anon, authenticated;
grant execute on function public.ping_hit(text) to service_role;

delete from auth.users where id in (select id from public.players where legacy_id = 'gh-keepalive');

alter table public.purchases add column granted_bundle jsonb;

drop function public.iap_granted(uuid, text[]);
create function public.iap_granted(p_player uuid, p_tx_id text, p_bundle jsonb)
returns void language sql security invoker set search_path = '' as $$
  update public.purchases
     set granted_at = now(), granted_bundle = p_bundle,
         status = case when status = 'verified' then 'granted' else status end
   where player_id = p_player and tx_id = p_tx_id and granted_at is null;
$$;
revoke all on function public.iap_granted(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.iap_granted(uuid, text, jsonb) to service_role;
