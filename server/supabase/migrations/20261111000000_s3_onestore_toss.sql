-- S3·S4 결제 (docs/server.md §7-2 원스토어, §7-3 토스): 마켓 조회 결과 refunded/invalid 기록, 환불 일괄 표시,
-- 매일 환불 조회 cron(pg_cron -> pg_net -> Edge Function cron-jobs).

-- 토스 주문 재조회(환불 확인) 마지막 시각 - 오래된 것부터 다시 묻는다.
alter table public.purchases add column rechecked_at timestamptz;

-- 마켓 콘솔·문의에서 쓰는 주문 번호(§22 C1-1): 원스토어 = purchaseId(order_id는 purchaseToken),
-- 토스 = orderId, Play = GPA 주문번호, iOS = 거래 id (= order_id). 원스토어는 마켓 응답(raw)에서 뽑는다.
alter table public.purchases add column store_order_ref text
  generated always as (case when store = 'onestore' then raw ->> 'purchaseId' else order_id end) stored;

-- v_purchases_recent에 store_order_ref(맨 끝 칸 - create or replace view는 끝에만 붙일 수 있다).
create or replace view public.v_purchases_recent with (security_invoker = true) as
  select id, (coalesce(verified_at, purchased_at) at time zone 'Asia/Seoul') as kst_at, store, product_key, price_krw,
         status, left(player_id::text, 8) as player_code, order_id, granted_at, refunded_at, store_order_ref
    from public.purchases
   where purchased_at > now() - interval '30 days'
   order by id desc;

-- iap_record 교체: 마켓이 refunded/invalid로 답한 것도 기록한다.
-- 이미 있는 줄이 pending·invalid면 이번 답으로 바꾼다(invalid = 원스토어 환경 착오 등 일시 판정일 수 있어 다시 물으면 바뀜).
create or replace function public.iap_record(p_player uuid, p_store text, p_product_key text, p_store_product_id text,
  p_order_id text, p_token text, p_price int, p_status text, p_raw jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_tx text := 'iap:' || p_product_key || ':' || p_order_id;
  p public.purchases;
  v_fresh boolean := false;
begin
  insert into public.purchases (player_id, store, product_key, store_product_id, order_id, purchase_token, price_krw,
                                status, tx_id, raw, verified_at, refunded_at)
  values (p_player, p_store, p_product_key, p_store_product_id, p_order_id, p_token, p_price, p_status, v_tx, p_raw,
          case when p_status = 'verified' then now() end, case when p_status = 'refunded' then now() end)
  on conflict (store, order_id) do nothing
  returning * into p;
  if found then
    v_fresh := p_status = 'verified';
  else
    select * into p from public.purchases where store = p_store and order_id = p_order_id for update;
    if p.player_id is not null and p.player_id <> p_player then
      return jsonb_build_object('ok', false, 'reason', 'owner', 'txId', p.tx_id);
    end if;
    if p.status = 'refunded' then return jsonb_build_object('ok', false, 'reason', 'refunded', 'txId', p.tx_id); end if;
    update public.purchases set player_id = p_player where id = p.id and player_id is null;
    if p.status in ('pending', 'invalid') and p_status <> p.status then
      update public.purchases
         set status = p_status, raw = p_raw,
             verified_at = case when p_status = 'verified' then now() else verified_at end,
             refunded_at = case when p_status = 'refunded' then now() else refunded_at end
       where id = p.id;
      p.status := p_status;
      v_fresh := p_status = 'verified';
    end if;
  end if;
  if p.status in ('verified', 'granted') then
    return jsonb_build_object('ok', true, 'txId', p.tx_id, 'fresh', v_fresh);
  end if;
  return jsonb_build_object('ok', false, 'reason', case when p.status = 'pending' then 'notFound' else p.status end, 'txId', p.tx_id);
end $$;

-- cron이 찾은 환불 주문들 -> refunded. 바뀐 줄 수.
create function public.iap_mark_refunded(p_store text, p_order_ids text[])
returns int language sql security invoker set search_path = '' as $$
  with up as (
    update public.purchases set status = 'refunded', refunded_at = now()
     where store = p_store and order_id = any(p_order_ids) and status <> 'refunded'
    returning 1
  )
  select count(*)::int from up;
$$;

revoke all on function public.iap_mark_refunded(text, text[]) from public, anon, authenticated;
grant execute on function public.iap_mark_refunded(text, text[]) to service_role;

-- pg_cron -> Edge Function cron-jobs {job}. 주소·비밀값은 Vault에서(쑹이 한 번 넣음, docs/server.md §13-1):
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<CRON_SECRET과 같은 값>', 'cron_secret');
-- 없으면 경고만 남기고 아무것도 안 한다. 손으로 돌리기: select public.cron_call('onestore');
create function public.cron_call(p_job text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'cron_call(%): vault project_url/cron_secret 없음', p_job;
    return null;
  end if;
  return net.http_post(
    url := v_url || '/functions/v1/cron-jobs',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('job', p_job),
    timeout_milliseconds := 150000);
end $$;
revoke all on function public.cron_call(text) from public, anon, authenticated;

-- 원스토어 환불 목록: 매일 04:00 KST(= 19:00 UTC). 토스 재조회: 매시 17분(한 번에 100건, §7-3 메모 참고).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    perform cron.schedule('onestore-voided', '0 19 * * *', $c$select public.cron_call('onestore')$c$);
    perform cron.schedule('toss-recheck', '17 * * * *', $c$select public.cron_call('toss')$c$);
  end if;
end $$;
