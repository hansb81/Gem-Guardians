-- 관리자 A단계 판정 반영(docs/admin.md "A단계 판정"):
-- 1) claims_granted: 기기가 claims 지급을 확인하면 'iap:' tx는 같은 플레이어 결제도 지급됨으로(결제 복구 뒤 "미지급"으로 남지 않게).
-- 2) admin_purchase_regrant: 다이아 첫 구매 2배 근사 반영(같은 플레이어·같은 상품의 앞선 verified/granted 결제가 없으면 첫 구매).

-- 기기 지급 확인 한 트랜잭션: claims granted_at + (iap: tx면) purchases verified -> granted, granted_bundle = 그 claims bundle.
-- 이미 granted/refunded 등 verified가 아니거나 granted_at이 있는 결제는 건드리지 않는다. 결과 = 갱신한 결제 수.
create function public.claims_granted(p_player uuid, p_tx_ids text[])
returns int language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  with c as (
    update public.claims set granted_at = now()
     where player_id = p_player and tx_id = any(p_tx_ids) and granted_at is null
    returning tx_id, bundle
  )
  update public.purchases p set status = 'granted', granted_at = now(), granted_bundle = c.bundle
    from c
   where c.tx_id like 'iap:%' and p.player_id = p_player and p.tx_id = c.tx_id
     and p.status = 'verified' and p.granted_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- 결제 누락 복구(20261116000000 교체): p_first_extra = 첫 구매면 더할 다이아(기기 규칙: 기본 다이아 = grant.diamonds - bonus,
-- Edge Function이 config/shop.json diaBundles로 계산해 넘김, 다이아 묶음 아니면 0).
-- 첫 구매 근사 = 이 플레이어의 같은 product_key 결제 중 verified/granted이고 이 결제보다 앞선(purchased_at, 같으면 id) 것이 없음.
-- 기기 진짜 기준은 save의 shop.firstBuyUsed라 서버는 모른다 - 그래서 근사.
drop function public.admin_purchase_regrant(uuid, uuid, bigint, jsonb, text, text);
create function public.admin_purchase_regrant(p_admin uuid, p_request uuid, p_purchase bigint, p_bundle jsonb,
  p_first_extra int, p_reason text, p_ip text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prev jsonb := public.admin_audit_prev(p_request);
  p public.purchases;
  n int;
  v_first boolean;
  v_bundle jsonb := p_bundle;
  r jsonb;
begin
  if prev is not null then return prev; end if;
  select * into p from public.purchases where id = p_purchase;
  if not found or p.player_id is null then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  if p.status <> 'verified' or p.granted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'notEligible', 'status', p.status);
  end if;
  v_first := coalesce(p_first_extra, 0) > 0 and not exists (
    select 1 from public.purchases x
     where x.player_id = p.player_id and x.product_key = p.product_key and x.id <> p.id
       and x.status in ('verified', 'granted')
       and (x.purchased_at < p.purchased_at or (x.purchased_at = p.purchased_at and x.id < p.id)));
  if v_first then
    v_bundle := v_bundle || jsonb_build_object('diamonds', coalesce((v_bundle ->> 'diamonds')::int, 0) + p_first_extra);
  end if;
  -- tx_id = 원래 iap:{키}:{주문}: 기기가 이미 받았으면 grantedTx에 있어 duplicate(이중 지급 없음).
  insert into public.claims (player_id, tx_id, kind, bundle) values (p.player_id, p.tx_id, 'admin', v_bundle)
  on conflict (player_id, tx_id) do nothing;
  get diagnostics n = row_count;
  r := jsonb_build_object('ok', true, 'txId', p.tx_id, 'created', n = 1, 'firstPurchaseBonus', v_first, 'bundle', v_bundle);
  insert into public.admin_audit (admin_id, action, target_player, target, request_id, reason, after, ip)
  values (p_admin, 'purchase.regrant', p.player_id, 'purchase:' || p_purchase, p_request, p_reason, r, p_ip);
  return r;
end $$;

revoke all on function public.claims_granted(uuid, text[]),
  public.admin_purchase_regrant(uuid, uuid, bigint, jsonb, int, text, text) from public, anon, authenticated;
grant execute on function public.claims_granted(uuid, text[]),
  public.admin_purchase_regrant(uuid, uuid, bigint, jsonb, int, text, text) to service_role;
