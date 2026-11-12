-- 쿠폰 입력 보상 v1 (docs/coupon.md §3): coupons, coupon_tries, coupon_redeem(판정), 운영 함수(coupon_create/batch),
-- 현황 뷰 v_coupon_stats. 지급은 출석·우편과 같은 claims 'coupon:{campaign}' -> 기기 grant -> claims-granted.

-- ---------- 함수: 정규화·지급 내용 검사 (표 check 제약에서도 씀) ----------
-- NFKC -> 대문자 -> 영문·숫자 말고 제거. 4~20자 A-Z0-9가 아니면 null. (기기 src/net/services.js normalizeCoupon과 같은 규칙)
create function public.coupon_normalize(p text)
returns text language sql immutable set search_path = '' as $$
  select case when v ~ '^[A-Z0-9]{4,20}$' then v end
    from (select regexp_replace(upper(normalize(coalesce(p, ''), nfkc)), '[^A-Z0-9]', '', 'g') as v) s;
$$;

-- 지급 내용: diamonds/gold/items만, 양의 정수, 상한(다이아 5000, 골드 1000000, 아이템 개당 99), 아이템은 config/items.json 16종
-- (_shared/coupon.ts ITEM_IDS와 같은 목록 - 바꿀 때 셋 다 고친다, tests/coupon.test.js가 config와 비교).
create function public.coupon_bundle_ok(b jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item_ids constant text[] := array['hammer', 'scythe_h', 'scythe_v', 'rainbow', 'glove', 'repair', 'hourglass', 'dye',
    'shuffle', 'barrier', 'defuse', 'drum', 'booster_line', 'booster_bomb', 'gold_coin', 'revive'];
  k text;
  v jsonb;
  ik text;
  iv jsonb;
  cap numeric;
begin
  if b is null or jsonb_typeof(b) <> 'object' or b = '{}'::jsonb then return false; end if;
  for k, v in select * from jsonb_each(b) loop
    if k = 'items' then
      if jsonb_typeof(v) <> 'object' or v = '{}'::jsonb then return false; end if;
      for ik, iv in select * from jsonb_each(v) loop
        if not ik = any(item_ids) then return false; end if;
        if jsonb_typeof(iv) <> 'number' or iv::numeric <> trunc(iv::numeric) or iv::numeric < 1 or iv::numeric > 99 then
          return false;
        end if;
      end loop;
    else
      cap := case k when 'diamonds' then 5000 when 'gold' then 1000000 end;
      if cap is null then return false; end if; -- flags, skills, 오타 키
      if jsonb_typeof(v) <> 'number' or v::numeric <> trunc(v::numeric) or v::numeric < 1 or v::numeric > cap then
        return false;
      end if;
    end if;
  end loop;
  return true;
end $$;

-- ---------- 표 ----------
create table public.coupons (
  code        text primary key check (code ~ '^[A-Z0-9]{4,20}$'), -- 정규화된 값
  campaign    text not null,             -- 계정당 1번 단위. 공용 = code와 같음
  title_ko    text not null,
  title_en    text not null,
  bundle      jsonb not null check (public.coupon_bundle_ok(bundle)),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,               -- null = 끝 없음
  max_uses    int,                       -- 이 코드 전체 사용 한도. null = 무제한. 1회용 = 1
  uses        int not null default 0,
  platforms   text[],                    -- null = 전부. players.platform 값
  enabled     boolean not null default true,
  note        text,
  created_at  timestamptz default now()
);
create index coupons_campaign_idx on public.coupons (campaign);

create table public.coupon_tries (
  player_id uuid,
  at timestamptz default now(),
  ok boolean
);
create index coupon_tries_player_at_idx on public.coupon_tries (player_id, at);

alter table public.coupons      enable row level security;
alter table public.coupon_tries enable row level security;
-- 정책 없음 = 클라이언트는 못 읽음(함수로만).

-- ---------- 현황 뷰 (쑹이 SQL 편집기에서) ----------
create view public.v_coupon_stats with (security_invoker = true) as
  with c as (
    select campaign, min(title_ko) as title_ko, count(*) as codes, sum(uses) as uses,
           max(ends_at) as ends_at, bool_or(enabled) as enabled
      from public.coupons group by campaign
  ), u as (
    select tx_id, count(*) filter (where granted_at is not null) as granted,
           min(claimed_at) as first_used, max(claimed_at) as last_used
      from public.claims where kind = 'coupon' group by tx_id
  )
  select c.campaign, c.title_ko, c.codes, c.uses, coalesce(u.granted, 0) as granted,
         u.first_used, u.last_used, c.ends_at, c.enabled
    from c left join u on u.tx_id = 'coupon:' || c.campaign
   order by u.last_used desc nulls last, c.campaign;

-- ---------- GRANT ----------
revoke all on public.coupons, public.coupon_tries, public.v_coupon_stats from anon, authenticated;
grant select, insert, update, delete on public.coupons, public.coupon_tries to service_role;
grant select on public.v_coupon_stats to service_role;

-- ---------- 판정 (docs/coupon.md §3-2 순서 그대로) ----------
create function public.coupon_redeem(p_player uuid, p_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_banned boolean;
  v_platform text;
  v_code text;
  c public.coupons;
  v_tx text;
begin
  select banned, platform into v_banned, v_platform from public.players where id = p_player;
  if coalesce(v_banned, false) then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  if (select count(*) from public.coupon_tries
       where player_id = p_player and not ok and at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'tooMany');
  end if;
  v_code := public.coupon_normalize(p_code);
  if v_code is null then
    insert into public.coupon_tries (player_id, ok) values (p_player, false);
    return jsonb_build_object('ok', false, 'reason', 'badCode');
  end if;
  -- 같은 코드 동시 사용을 줄 세운다(선착순 uses 확인과 +1이 한 트랜잭션).
  select * into c from public.coupons where code = v_code for update;
  if not found or not c.enabled then
    insert into public.coupon_tries (player_id, ok) values (p_player, false);
    return jsonb_build_object('ok', false, 'reason', 'notFound');
  end if;
  -- 여기부터 실패는 진짜 코드라 coupon_tries에 세지 않는다.
  v_tx := 'coupon:' || c.campaign;
  if exists (select 1 from public.claims where player_id = p_player and tx_id = v_tx) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  if now() < c.starts_at then return jsonb_build_object('ok', false, 'reason', 'notStarted'); end if;
  if c.ends_at is not null and c.ends_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if c.platforms is not null and (v_platform is null or not v_platform = any(c.platforms)) then
    return jsonb_build_object('ok', false, 'reason', 'platform');
  end if;
  if c.max_uses is not null and c.uses >= c.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'soldOut');
  end if;
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'coupon', c.bundle);
  update public.coupons set uses = uses + 1 where code = v_code;
  insert into public.coupon_tries (player_id, ok) values (p_player, true);
  return jsonb_build_object('ok', true, 'txId', v_tx, 'bundle', c.bundle,
                            'title', jsonb_build_object('ko', c.title_ko, 'en', c.title_en));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'already');
end $$;

-- ---------- 운영 함수 (쑹이 SQL 편집기에서, docs/coupon.md §4) ----------
-- 공용 쿠폰 한 장. campaign 없으면 = 정규화된 코드(계정당 1번).
create function public.coupon_create(
  p_code text, p_title_ko text, p_title_en text, p_bundle jsonb, p_ends_at timestamptz,
  p_max_uses int default null, p_platforms text[] default null, p_starts_at timestamptz default now(),
  p_campaign text default null, p_note text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_code text := public.coupon_normalize(p_code);
begin
  if v_code is null then
    raise exception '쿠폰 코드 "%"를 쓸 수 없어요: 하이픈·공백을 뺀 영문·숫자가 4~20자여야 합니다', p_code;
  end if;
  if not coalesce(public.coupon_bundle_ok(p_bundle), false) then
    raise exception '지급 내용 %이(가) 잘못됐어요: 키는 diamonds/gold/items만, 양의 정수, 다이아 5000·골드 1000000·아이템 개당 99 이하, 아이템 id는 config/items.json 16종', p_bundle;
  end if;
  if exists (select 1 from public.coupons where code = v_code) then
    raise exception '이미 있는 쿠폰 코드예요: %', v_code;
  end if;
  insert into public.coupons (code, campaign, title_ko, title_en, bundle, starts_at, ends_at, max_uses, platforms, note)
  values (v_code, coalesce(nullif(p_campaign, ''), v_code), p_title_ko, p_title_en, p_bundle,
          coalesce(p_starts_at, now()), p_ends_at, p_max_uses, p_platforms, p_note);
  return jsonb_build_object('code', v_code, 'campaign', coalesce(nullif(p_campaign, ''), v_code));
end $$;

-- 난수 바이트: Supabase는 pgcrypto가 extensions 스키마(gen_random_bytes). 없으면(PGlite 테스트) gen_random_uuid의
-- 고정 비트(버전 = 7번째 바이트, variant = 9번째 바이트)를 뺀 14바이트.
create function public.coupon_random_bytes()
returns bytea language plpgsql volatile set search_path = '' as $$
declare
  u bytea;
begin
  if to_regprocedure('extensions.gen_random_bytes(integer)') is not null then
    return extensions.gen_random_bytes(16);
  end if;
  u := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  return substring(u from 1 for 6) || substring(u from 8 for 1) || substring(u from 10 for 7);
end $$;

-- 1회용 쿠폰 묶음: 12자(0 O 1 I L 뺀 31자), 코드마다 max_uses 1, 같은 campaign은 계정당 1장. 결과는 XXXX-XXXX-XXXX.
create function public.coupon_batch(
  p_campaign text, p_count int, p_title_ko text, p_title_en text, p_bundle jsonb, p_ends_at timestamptz,
  p_platforms text[] default null, p_note text default null)
returns table (code text) language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v text;
  b bytea;
  i int;
  x int;
  n int := 0;
begin
  if p_count is null or p_count < 1 or p_count > 5000 then
    raise exception 'p_count는 1~5000이어야 해요 (받은 값 %)', p_count;
  end if;
  if coalesce(p_campaign, '') = '' then raise exception 'p_campaign(묶음 이름)이 필요해요'; end if;
  if not coalesce(public.coupon_bundle_ok(p_bundle), false) then
    raise exception '지급 내용 %이(가) 잘못됐어요: 키는 diamonds/gold/items만, 양의 정수, 다이아 5000·골드 1000000·아이템 개당 99 이하, 아이템 id는 config/items.json 16종', p_bundle;
  end if;
  while n < p_count loop
    v := '';
    while length(v) < 12 loop
      b := public.coupon_random_bytes();
      for i in 0 .. length(b) - 1 loop
        x := get_byte(b, i);
        -- 248 = 31 x 8: 그 위는 버려서 글자마다 확률을 같게.
        if x < 248 and length(v) < 12 then v := v || substr(abc, x % 31 + 1, 1); end if;
      end loop;
    end loop;
    insert into public.coupons (code, campaign, title_ko, title_en, bundle, ends_at, max_uses, platforms, note)
    values (v, p_campaign, p_title_ko, p_title_en, p_bundle, p_ends_at, 1, p_platforms, p_note)
    on conflict (code) do nothing; -- 충돌하면 다시 뽑기
    if found then
      n := n + 1;
      code := substr(v, 1, 4) || '-' || substr(v, 5, 4) || '-' || substr(v, 9, 4);
      return next;
    end if;
  end loop;
end $$;

revoke all on function public.coupon_normalize(text), public.coupon_bundle_ok(jsonb), public.coupon_redeem(uuid, text),
  public.coupon_create(text, text, text, jsonb, timestamptz, int, text[], timestamptz, text, text),
  public.coupon_random_bytes(),
  public.coupon_batch(text, int, text, text, jsonb, timestamptz, text[], text) from public, anon, authenticated;
-- service_role: 판정 함수 + 그 안에서 부르는 정규화, uses 갱신 때 다시 도는 bundle check.
grant execute on function public.coupon_normalize(text), public.coupon_bundle_ok(jsonb), public.coupon_redeem(uuid, text)
  to service_role;

-- 데이터 삭제 요청: S4 본문 그대로 + coupon_tries. 쿠폰 uses는 그대로(전체 수량 기록).
create or replace function public.me_delete(p_player uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.claims where player_id = p_player;
  delete from public.attendance where player_id = p_player;
  delete from public.normal_best where player_id = p_player;
  delete from public.mail where player_id = p_player;
  delete from public.rate_calls where player_id = p_player;
  delete from public.comp_runs where player_id = p_player;
  delete from public.comp_best where player_id = p_player;
  delete from public.season_results where player_id = p_player;
  delete from public.ad_nonces where player_id = p_player;
  delete from public.coupon_tries where player_id = p_player;
  update public.ad_views set player_id = null where player_id = p_player;
  update public.purchases set player_id = null where player_id = p_player;
  update public.players set nickname = null, legacy_id = null, toss_key_hash = null, deleted_at = now()
   where id = p_player;
  return jsonb_build_object('ok', true);
end $$;

-- 7일 지난 쿠폰 입력 기록 삭제(매일 04:23 UTC). pg_cron이 없는 곳(테스트용 PGlite)은 건너뛴다.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('coupon-tries-cleanup', '23 4 * * *',
      $c$delete from public.coupon_tries where at < now() - interval '7 days'$c$);
  end if;
end $$;
