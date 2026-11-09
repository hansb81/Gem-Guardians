-- S2 (docs/server.md §5, §7, §10, §15): purchases, 결제 보기용 뷰 3개, 분당 호출 제한, 결제 SQL 함수.
-- 권한 규칙은 S1과 같다: 클라이언트(anon/authenticated)는 아무것도 못 함, Edge Function(service_role)만.

-- ---------- 결제 (마켓 공통 한 표) ----------
create table public.purchases (
  id bigserial primary key,
  player_id uuid references public.players on delete set null, -- 데이터 삭제 때 연결만 끊고 5년 보관(§14-2)
  store text not null,            -- play|ios|onestore|toss|dev
  product_key text not null,      -- config/products.json 키 (dia.0, pack.adfree …)
  store_product_id text,
  order_id text not null,         -- 마켓 주문번호(= 기기 orderId, RevenueCat store_transaction_id)
  purchase_token text,
  price_krw int,                  -- products.json 기준 표시 가격 (실매출은 마켓 정산서 기준)
  status text not null check (status in ('verified', 'granted', 'refunded', 'invalid', 'pending')),
  tx_id text not null,            -- 'iap:{product_key}:{order_id}' = 기기 grantedTx
  raw jsonb,
  purchased_at timestamptz default now(),
  verified_at timestamptz,
  granted_at timestamptz,
  refunded_at timestamptz,
  unique (store, order_id)
);
create index purchases_player_idx on public.purchases (player_id);

-- 웹훅 이벤트 id 중복 제거(RevenueCat은 같은 이벤트를 다시 보낼 수 있다).
create unique index server_log_rc_event_idx on public.server_log ((body ->> 'eventId')) where source = 'webhook-revenuecat';

-- 분당 호출 제한(§15, §19-11): 플레이어 x 함수 x 분 1줄.
create table public.rate_calls (
  player_id uuid not null,
  fn text not null,
  minute timestamptz not null,
  n int not null default 1,
  primary key (player_id, fn, minute)
);

alter table public.purchases  enable row level security;
alter table public.rate_calls enable row level security;
revoke all on public.purchases, public.rate_calls from anon, authenticated;
revoke all on sequence public.purchases_id_seq from anon, authenticated;
grant select, insert, update, delete on public.purchases, public.rate_calls to service_role;
grant usage, select on sequence public.purchases_id_seq to service_role;

-- ---------- 쑹이 보는 뷰 (Supabase 표 편집기 / SQL 편집기에서 select * from v_…) ----------
create view public.v_purchases_recent with (security_invoker = true) as
  select id, (coalesce(verified_at, purchased_at) at time zone 'Asia/Seoul') as kst_at, store, product_key, price_krw,
         status, left(player_id::text, 8) as player_code, order_id, granted_at, refunded_at
    from public.purchases
   where purchased_at > now() - interval '30 days'
   order by id desc;

-- 마켓 x KST 날짜. 환불·미확인(pending)·invalid는 빼고 verified/granted만 센다.
create view public.v_sales_daily with (security_invoker = true) as
  select store, (purchased_at at time zone 'Asia/Seoul')::date as kst_date, count(*) as n, sum(price_krw) as krw
    from public.purchases
   where status in ('verified', 'granted')
   group by 1, 2
   order by 2 desc, 1;

create view public.v_refunds with (security_invoker = true) as
  select id, (refunded_at at time zone 'Asia/Seoul') as kst_refunded_at, store, product_key, price_krw,
         left(player_id::text, 8) as player_code, order_id, granted_at
    from public.purchases
   where status = 'refunded'
   order by refunded_at desc nulls last;

revoke all on public.v_purchases_recent, public.v_sales_daily, public.v_refunds from anon, authenticated;
grant select on public.v_purchases_recent, public.v_sales_daily, public.v_refunds to service_role;

-- ---------- 함수 ----------
-- 분당 호출 수 +1, 한도 안이면 true.
create function public.rate_hit(p_player uuid, p_fn text, p_limit int)
returns boolean language sql security invoker set search_path = '' as $$
  insert into public.rate_calls (player_id, fn, minute) values (p_player, p_fn, date_trunc('minute', now()))
  on conflict (player_id, fn, minute) do update set n = public.rate_calls.n + 1
  returning n <= p_limit;
$$;

-- iap-verify 기록. p_status = 'verified'(마켓 확인됨) | 'pending'(못 찾음 - RevenueCat 반영 지연).
-- 같은 주문이 이미 있으면: 다른 플레이어 것 -> owner, 환불됨 -> refunded, pending -> verified로 올림.
-- 결과 { ok, reason?, txId, fresh } - fresh = 이번에 처음 verified가 됨(알림 1번만).
create function public.iap_record(p_player uuid, p_store text, p_product_key text, p_store_product_id text,
  p_order_id text, p_token text, p_price int, p_status text, p_raw jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_tx text := 'iap:' || p_product_key || ':' || p_order_id;
  p public.purchases;
  v_fresh boolean := false;
begin
  insert into public.purchases (player_id, store, product_key, store_product_id, order_id, purchase_token, price_krw,
                                status, tx_id, raw, verified_at)
  values (p_player, p_store, p_product_key, p_store_product_id, p_order_id, p_token, p_price, p_status, v_tx, p_raw,
          case when p_status = 'verified' then now() end)
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
    -- 웹훅이 먼저 왔는데 app_user_id를 몰랐던 줄이면 지금 주인을 붙인다.
    update public.purchases set player_id = p_player where id = p.id and player_id is null;
    if p.status = 'pending' and p_status = 'verified' then
      update public.purchases set status = 'verified', verified_at = now(), raw = p_raw where id = p.id;
      p.status := 'verified';
      v_fresh := true;
    end if;
  end if;
  if p.status in ('verified', 'granted') then
    return jsonb_build_object('ok', true, 'txId', p.tx_id, 'fresh', v_fresh);
  end if;
  return jsonb_build_object('ok', false, 'reason', case when p.status = 'pending' then 'notFound' else p.status end, 'txId', p.tx_id);
end $$;

-- 기기 지급 완료: granted_at 기록, verified면 granted로.
create function public.iap_granted(p_player uuid, p_tx_ids text[])
returns void language sql security invoker set search_path = '' as $$
  update public.purchases
     set granted_at = now(), status = case when status = 'verified' then 'granted' else status end
   where player_id = p_player and tx_id = any(p_tx_ids) and granted_at is null;
$$;

-- RevenueCat 웹훅 1건. 이벤트 id가 이미 있으면 duplicate. 결과 { ok, duplicate?, fresh? }.
-- p_type: NON_RENEWING_PURCHASE -> verified 기록(이미 있으면 pending만 올림), CANCELLATION -> refunded, 그 밖 -> 기록만.
create function public.iap_webhook(p_event_id text, p_type text, p_store text, p_order_id text, p_player uuid,
  p_product_key text, p_store_product_id text, p_price int, p_raw jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_fresh boolean := false;
  n int;
begin
  insert into public.server_log (source, level, body)
  values ('webhook-revenuecat', 'info', jsonb_build_object('eventId', p_event_id, 'type', p_type, 'orderId', p_order_id))
  on conflict ((body ->> 'eventId')) where source = 'webhook-revenuecat' do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if p_order_id is null or p_product_key is null then return jsonb_build_object('ok', true); end if;

  if p_type = 'NON_RENEWING_PURCHASE' then
    insert into public.purchases (player_id, store, product_key, store_product_id, order_id, price_krw, status, tx_id, raw, verified_at)
    values (p_player, p_store, p_product_key, p_store_product_id, p_order_id, p_price, 'verified',
            'iap:' || p_product_key || ':' || p_order_id, p_raw, now())
    on conflict (store, order_id) do nothing;
    get diagnostics n = row_count;
    if n = 1 then
      v_fresh := true;
    else
      update public.purchases set status = 'verified', verified_at = now(), player_id = coalesce(player_id, p_player)
       where store = p_store and order_id = p_order_id and status = 'pending';
      get diagnostics n = row_count;
      v_fresh := n = 1;
    end if;
  elsif p_type = 'CANCELLATION' then
    insert into public.purchases (player_id, store, product_key, store_product_id, order_id, price_krw, status, tx_id, raw, refunded_at)
    values (p_player, p_store, p_product_key, p_store_product_id, p_order_id, p_price, 'refunded',
            'iap:' || p_product_key || ':' || p_order_id, p_raw, now())
    on conflict (store, order_id) do update set status = 'refunded', refunded_at = now();
  end if;
  return jsonb_build_object('ok', true, 'fresh', v_fresh);
end $$;

-- 데이터 삭제 요청(S1 함수 교체): purchases는 지우지 않고 player 연결만 끊는다(전자상거래법 5년, §14-2).
create or replace function public.me_delete(p_player uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.claims where player_id = p_player;
  delete from public.attendance where player_id = p_player;
  delete from public.normal_best where player_id = p_player;
  delete from public.mail where player_id = p_player;
  delete from public.rate_calls where player_id = p_player;
  update public.purchases set player_id = null where player_id = p_player;
  update public.players set nickname = null, legacy_id = null, toss_key_hash = null, deleted_at = now()
   where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.rate_hit(uuid, text, int), public.iap_granted(uuid, text[]),
  public.iap_record(uuid, text, text, text, text, text, int, text, jsonb),
  public.iap_webhook(text, text, text, text, uuid, text, text, int, jsonb) from public, anon, authenticated;
grant execute on function public.rate_hit(uuid, text, int), public.iap_granted(uuid, text[]),
  public.iap_record(uuid, text, text, text, text, text, int, text, jsonb),
  public.iap_webhook(text, text, text, text, uuid, text, text, int, jsonb) to service_role;

-- 1시간 지난 호출 카운트 삭제(10분마다). pg_cron이 없는 곳(테스트용 PGlite)은 건너뛴다.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('rate-calls-cleanup', '*/10 * * * *',
      $c$delete from public.rate_calls where minute < now() - interval '1 hour'$c$);
  end if;
end $$;
