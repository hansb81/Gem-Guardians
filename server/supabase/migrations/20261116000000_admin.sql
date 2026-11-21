-- 운영 관리자 A단계(docs/admin.md §3, §4-1, §4-2, §5): admins, admin_audit, admin_grants, 우편 회수, 랭킹 숨김,
-- 관리자 RPC(admin_*). 권한 규칙은 S1과 같다: anon/authenticated는 아무것도 못 함, Edge Function admin(service_role)만.
-- 관리자 확인(aal2·admins 표·role)은 _shared/admin.ts가 하고, 여기 쓰기 함수는 받은 p_admin을 감사에 남긴다.

-- ---------- 표 ----------
create table public.admins (
  user_id    uuid primary key references auth.users on delete cascade,
  role       text not null check (role in ('owner', 'viewer')),
  created_at timestamptz default now()
);

-- 감사는 player를 FK로 묶지 않는다(uuid만) - 탈퇴·합치기·익명 정리 뒤에도 남는다.
create table public.admin_audit (
  id            bigserial primary key,
  at            timestamptz default now(),
  admin_id      uuid not null,
  action        text not null,
  target_player uuid null,
  target        text null,
  request_id    uuid unique,               -- 페이지가 만든 uuid: 더블클릭·재시도는 저장된 결과(after)를 그대로 돌려준다
  reason        text,
  before        jsonb,
  after         jsonb,
  ip            text
);
create index admin_audit_target_idx on public.admin_audit (target_player, at desc);
create index admin_audit_at_idx on public.admin_audit (at desc);

-- 지급 1요청 = 1줄. player_ids null = 전체 발송.
create table public.admin_grants (
  id         bigserial primary key,
  at         timestamptz default now(),
  admin_id   uuid not null,
  mode       text not null check (mode in ('mail', 'direct')),
  bundle     jsonb not null,
  reason     text not null,
  note       text,
  title_ko   text,
  title_en   text,
  expires_at timestamptz,
  player_ids uuid[],
  count      int,
  revoked_at timestamptz
);

alter table public.mail add column grant_id bigint null references public.admin_grants;
alter table public.mail add column revoked_at timestamptz null; -- 회수: 목록·받기에서 빠짐(visibleMail, mail_claim)
alter table public.players add column app_version text;          -- hello가 저장
alter table public.players add column rank_hidden boolean not null default false;

alter table public.admins       enable row level security;
alter table public.admin_audit  enable row level security;
alter table public.admin_grants enable row level security;
revoke all on public.admins, public.admin_audit, public.admin_grants from anon, authenticated;
revoke all on sequence public.admin_audit_id_seq, public.admin_grants_id_seq from anon, authenticated;
grant select, insert, update, delete on public.admins, public.admin_audit, public.admin_grants to service_role;
grant usage, select on sequence public.admin_audit_id_seq, public.admin_grants_id_seq to service_role;

-- ---------- 기존 함수: 회수 우편·랭킹 숨김 ----------
create or replace function public.mail_claim(p_player uuid, p_mail bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  m public.mail;
  v_tx text := 'mail:' || p_mail;
begin
  select * into m from public.mail
   where id = p_mail and (player_id is null or player_id = p_player)
     and (expires_at is null or expires_at > now()) and revoked_at is null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'mail', m.bundle);
  return jsonb_build_object('ok', true, 'txId', v_tx, 'bundle', m.bundle);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'already');
end $$;

create or replace function public.rank_normal_top(p_limit int)
returns table (player_id uuid, nickname text, statue text, best_floor int, reached_at timestamptz, rank bigint, total bigint)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select n.player_id, p.nickname, p.statue, n.best_floor, n.reached_at
      from public.normal_best n join public.players p on p.id = n.player_id
     where p.nickname is not null and not p.banned and p.deleted_at is null and not p.rank_hidden
  )
  select *, row_number() over (order by best_floor desc, reached_at asc), count(*) over ()
    from b order by best_floor desc, reached_at asc limit p_limit;
$$;

-- 숨김 본인은 b에 없어도 "나만 들어간 것처럼" 순위를 본다(rank-me가 hidden 표시만 붙인다).
create or replace function public.rank_normal_me(p_player uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with b as (
    select n.player_id, n.best_floor, n.reached_at
      from public.normal_best n join public.players p on p.id = n.player_id
     where p.nickname is not null and not p.banned and p.deleted_at is null and not p.rank_hidden
  ), me as (select * from public.normal_best where player_id = p_player)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'value', (select best_floor from me),
    'at', (select reached_at from me),
    'rank', (select count(*) + 1 from b, me where b.best_floor > me.best_floor
               or (b.best_floor = me.best_floor and b.reached_at < me.reached_at)),
    'total', (select count(*) from b) + case when exists (select 1 from b where player_id = p_player) then 0 else 1 end
  ) end;
$$;

create or replace function public.comp_board(p_season text)
returns table (player_id uuid, nickname text, statue text, points int, floor int, at timestamptz, rank bigint, total bigint)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select c.player_id, p.nickname, p.statue, c.points, c.floor, c.at
      from public.comp_best c join public.players p on p.id = c.player_id
     where c.season_id = p_season and c.points > 0
       and p.nickname is not null and not p.banned and p.deleted_at is null and not p.rank_hidden
  )
  select *, row_number() over (order by points desc, at asc), count(*) over () from b;
$$;

-- ---------- 지급 내용 검사 (docs/admin.md §4-1) ----------
-- coupon_bundle_ok와 같은 구조, 상한은 넉넉하게. 상수는 config와 같아야 한다(tests/admin_test.ts가 비교):
--   item_ids = config/items.json items 키(_shared/coupon.ts ITEM_IDS), skill_ids = config/shop.json skills.color + skills.special 키,
--   tower_max = config/balance.json tower.maxLevel, levels.towers 순서 = balance.json tower.towers(red, blue, yellow, green, purple).
create function public.admin_bundle_ok(b jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item_ids constant text[] := array['hammer', 'scythe_h', 'scythe_v', 'rainbow', 'glove', 'repair', 'hourglass', 'dye',
    'shuffle', 'barrier', 'defuse', 'drum', 'booster_line', 'booster_bomb', 'gold_coin', 'revive'];
  skill_ids constant text[] := array['red', 'blue', 'purple', 'yellow', 'green', 'spike', 'lava', 'soul', 'ult'];
  tower_max constant int := 200;
  k text;
  v jsonb;
  ik text;
  iv jsonb;
  cap numeric;
  any_tower boolean;
begin
  if b is null or jsonb_typeof(b) <> 'object' or b = '{}'::jsonb then return false; end if;
  for k, v in select * from jsonb_each(b) loop
    if k in ('gold', 'diamonds') then
      cap := case k when 'diamonds' then 50000 else 100000000 end;
      if jsonb_typeof(v) <> 'number' or v::numeric <> trunc(v::numeric) or v::numeric < 1 or v::numeric > cap then
        return false;
      end if;
    elsif k = 'items' then
      if jsonb_typeof(v) <> 'object' or v = '{}'::jsonb then return false; end if;
      for ik, iv in select * from jsonb_each(v) loop
        if not ik = any(item_ids) then return false; end if;
        if jsonb_typeof(iv) <> 'number' or iv::numeric <> trunc(iv::numeric) or iv::numeric < 1 or iv::numeric > 999 then
          return false;
        end if;
      end loop;
    elsif k = 'skills' then
      if jsonb_typeof(v) <> 'object' or v = '{}'::jsonb then return false; end if;
      for ik, iv in select * from jsonb_each(v) loop
        if not ik = any(skill_ids) then return false; end if;
        if not (iv = '"+1"'::jsonb or (jsonb_typeof(iv) = 'number' and iv::numeric = trunc(iv::numeric)
                                       and iv::numeric between 0 and 5)) then
          return false;
        end if;
      end loop;
    elsif k = 'flags' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 then return false; end if;
      if exists (select 1 from jsonb_array_elements(v) e where e not in ('"slot4"'::jsonb, '"adFree"'::jsonb))
         or (select count(distinct e) from jsonb_array_elements(v) e) <> jsonb_array_length(v) then
        return false;
      end if;
    elsif k = 'levels' then
      if jsonb_typeof(v) <> 'object' or v = '{}'::jsonb then return false; end if;
      if exists (select 1 from jsonb_object_keys(v) x where x not in ('towers', 'floor')) then return false; end if;
      if v ? 'towers' then
        if jsonb_typeof(v -> 'towers') <> 'array' or jsonb_array_length(v -> 'towers') <> 5 then return false; end if;
        any_tower := false;
        for iv in select * from jsonb_array_elements(v -> 'towers') loop
          if jsonb_typeof(iv) = 'null' then continue; end if;
          if jsonb_typeof(iv) <> 'number' or iv::numeric <> trunc(iv::numeric) or iv::numeric < 1 or iv::numeric > tower_max then
            return false;
          end if;
          any_tower := true;
        end loop;
        if not any_tower then return false; end if; -- 전부 null = 아무것도 안 함
      end if;
      if v ? 'floor' then
        iv := v -> 'floor';
        if jsonb_typeof(iv) <> 'number' or iv::numeric <> trunc(iv::numeric) or iv::numeric < 1 or iv::numeric > 300 then
          return false;
        end if;
      end if;
    else
      return false; -- 오타·모르는 키
    end if;
  end loop;
  return true;
end $$;

-- ---------- 감사 ----------
-- 같은 request_id가 이미 있으면 그때 결과(after). 없으면 null. 호출 전에 advisory lock으로 같은 요청 동시 실행을 줄 세운다.
create function public.admin_audit_prev(p_request uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  a jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('admin:' || p_request::text));
  select after into a from public.admin_audit where request_id = p_request;
  return a;
end $$;

-- 감사 1줄(관리자 함수가 SQL 밖에서 바꾼 것 - 쿠폰). 같은 request_id면 false.
create function public.admin_audit_add(p_admin uuid, p_request uuid, p_action text, p_target_player uuid, p_target text,
  p_reason text, p_before jsonb, p_after jsonb, p_ip text default null)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.admin_audit (admin_id, action, target_player, target, request_id, reason, before, after, ip)
  values (p_admin, p_action, p_target_player, p_target, p_request, p_reason, p_before, p_after, p_ip)
  on conflict (request_id) do nothing;
  return found;
end $$;

-- ---------- 지급 (§4-2) ----------
-- 한 트랜잭션: 번들 검사 -> 받는 사람 1~200명·전부 있음 -> admin_grants 1줄 -> 우편 n통 / claims n줄 -> 감사.
-- 결과 { ok, grantId, mode, count } | { ok:false, reason: badBundle|badMode|badPlayers|missing(+missing[]) }.
create function public.admin_grant(p_admin uuid, p_request uuid, p_mode text, p_players uuid[], p_bundle jsonb,
  p_title_ko text, p_title_en text, p_expires timestamptz, p_reason text, p_note text, p_ip text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prev jsonb := public.admin_audit_prev(p_request);
  v_ids uuid[];
  v_missing uuid[];
  v_id bigint;
  v_tko text := coalesce(nullif(p_title_ko, ''), '운영자 선물');
  v_ten text := coalesce(nullif(p_title_en, ''), 'A gift from the team');
  v_exp timestamptz := coalesce(p_expires, now() + interval '30 days');
  r jsonb;
begin
  if prev is not null then return prev; end if;
  if p_mode is null or p_mode not in ('mail', 'direct') then return jsonb_build_object('ok', false, 'reason', 'badMode'); end if;
  if not coalesce(public.admin_bundle_ok(p_bundle), false) then return jsonb_build_object('ok', false, 'reason', 'badBundle'); end if;
  select array_agg(distinct x) into v_ids from unnest(p_players) x where x is not null;
  if v_ids is null or cardinality(v_ids) > 200 then return jsonb_build_object('ok', false, 'reason', 'badPlayers'); end if;
  select array_agg(x) into v_missing from unnest(v_ids) x where not exists (select 1 from public.players p where p.id = x);
  if v_missing is not null then
    return jsonb_build_object('ok', false, 'reason', 'missing', 'missing', to_jsonb(v_missing));
  end if;

  insert into public.admin_grants (admin_id, mode, bundle, reason, note, title_ko, title_en, expires_at, player_ids, count)
  values (p_admin, p_mode, p_bundle, p_reason, p_note,
          case when p_mode = 'mail' then v_tko end, case when p_mode = 'mail' then v_ten end,
          case when p_mode = 'mail' then v_exp end, v_ids, cardinality(v_ids))
  returning id into v_id;
  if p_mode = 'mail' then
    insert into public.mail (player_id, title_ko, title_en, bundle, expires_at, grant_id)
    select x, v_tko, v_ten, p_bundle, v_exp, v_id from unnest(v_ids) x;
  else
    insert into public.claims (player_id, tx_id, kind, bundle)
    select x, 'admin:' || v_id, 'admin', p_bundle from unnest(v_ids) x;
  end if;
  r := jsonb_build_object('ok', true, 'grantId', v_id, 'mode', p_mode, 'count', cardinality(v_ids));
  insert into public.admin_audit (admin_id, action, target_player, target, request_id, reason, after, ip)
  values (p_admin, 'grant.send', case when cardinality(v_ids) = 1 then v_ids[1] end, 'grant:' || v_id, p_request,
          p_reason, r || jsonb_build_object('bundle', p_bundle, 'players', to_jsonb(v_ids)), p_ip);
  return r || jsonb_build_object('bundle', p_bundle, 'players', to_jsonb(v_ids));
end $$;

-- 회수: 우편은 아직 안 받은 것만 revoked_at(전체 발송 우편은 우편 자체 - 이미 받은 사람은 그대로), 바로 지급은 granted_at null만 삭제.
-- 결과 { ok, grantId, revoked, received } | notFound.
create function public.admin_grant_revoke(p_admin uuid, p_request uuid, p_grant bigint, p_reason text, p_ip text default null)
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
  if g.mode = 'mail' then
    select count(*) into v_got from public.mail m join public.claims c on c.tx_id = 'mail:' || m.id
     where m.grant_id = p_grant and (m.player_id is null or c.player_id = m.player_id);
    update public.mail m set revoked_at = now()
     where m.grant_id = p_grant and m.revoked_at is null
       and (m.player_id is null or not exists (
         select 1 from public.claims c where c.player_id = m.player_id and c.tx_id = 'mail:' || m.id));
    get diagnostics v_rev = row_count;
  else
    select count(*) into v_got from public.claims where tx_id = 'admin:' || p_grant and granted_at is not null;
    delete from public.claims where tx_id = 'admin:' || p_grant and granted_at is null;
    get diagnostics v_rev = row_count;
  end if;
  update public.admin_grants set revoked_at = coalesce(revoked_at, now()) where id = p_grant;
  r := jsonb_build_object('ok', true, 'grantId', p_grant, 'revoked', v_rev, 'received', v_got);
  insert into public.admin_audit (admin_id, action, target_player, target, request_id, reason, after, ip)
  values (p_admin, 'grant.revoke', case when g.count = 1 then g.player_ids[1] end, 'grant:' || p_grant, p_request,
          p_reason, r, p_ip);
  return r;
end $$;

-- 전체 발송(player_id null 우편). 하루(KST) 3회까지. admin_grants에도 1줄(player_ids null) - 같은 grant.revoke로 회수.
create function public.admin_broadcast(p_admin uuid, p_request uuid, p_bundle jsonb, p_title_ko text, p_title_en text,
  p_expires timestamptz, p_reason text, p_ip text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prev jsonb := public.admin_audit_prev(p_request);
  v_id bigint;
  v_mail bigint;
  v_tko text := coalesce(nullif(p_title_ko, ''), '운영자 선물');
  v_ten text := coalesce(nullif(p_title_en, ''), 'A gift from the team');
  v_exp timestamptz := coalesce(p_expires, now() + interval '30 days');
  r jsonb;
begin
  if prev is not null then return prev; end if;
  if not coalesce(public.admin_bundle_ok(p_bundle), false) then return jsonb_build_object('ok', false, 'reason', 'badBundle'); end if;
  perform pg_advisory_xact_lock(hashtext('admin-broadcast'));
  if (select count(*) from public.admin_grants
       where player_ids is null and public.save_kst_date(at) = public.save_kst_date(now())) >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'dailyLimit');
  end if;
  insert into public.admin_grants (admin_id, mode, bundle, reason, title_ko, title_en, expires_at)
  values (p_admin, 'mail', p_bundle, p_reason, v_tko, v_ten, v_exp) returning id into v_id;
  insert into public.mail (player_id, title_ko, title_en, bundle, expires_at, grant_id)
  values (null, v_tko, v_ten, p_bundle, v_exp, v_id) returning id into v_mail;
  r := jsonb_build_object('ok', true, 'grantId', v_id, 'mailId', v_mail);
  insert into public.admin_audit (admin_id, action, target, request_id, reason, after, ip)
  values (p_admin, 'mail.broadcast', 'grant:' || v_id, p_request, p_reason, r || jsonb_build_object('bundle', p_bundle), p_ip);
  return r;
end $$;

-- 결제 누락 복구: verified + 기기 지급 기록 없음일 때만, 원래 tx_id(iap:…)로 claims(kind admin) - 기기가 이미 받았으면 duplicate.
-- p_bundle = Edge Function이 products.json grant로 만든 번들(기기 bundleOfGrant 모양).
create function public.admin_purchase_regrant(p_admin uuid, p_request uuid, p_purchase bigint, p_bundle jsonb,
  p_reason text, p_ip text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prev jsonb := public.admin_audit_prev(p_request);
  p public.purchases;
  n int;
  r jsonb;
begin
  if prev is not null then return prev; end if;
  select * into p from public.purchases where id = p_purchase;
  if not found or p.player_id is null then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  if p.status <> 'verified' or p.granted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'notEligible', 'status', p.status);
  end if;
  insert into public.claims (player_id, tx_id, kind, bundle) values (p.player_id, p.tx_id, 'admin', p_bundle)
  on conflict (player_id, tx_id) do nothing;
  get diagnostics n = row_count;
  r := jsonb_build_object('ok', true, 'txId', p.tx_id, 'created', n = 1);
  insert into public.admin_audit (admin_id, action, target_player, target, request_id, reason, after, ip)
  values (p_admin, 'purchase.regrant', p.player_id, 'purchase:' || p_purchase, p_request, p_reason,
          r || jsonb_build_object('bundle', p_bundle), p_ip);
  return r;
end $$;

-- 플레이어 값 하나: note(text|null) / banned(bool) / rank_hidden(bool) / nickname_reset(값 무시, null로).
create function public.admin_player_set(p_admin uuid, p_request uuid, p_player uuid, p_field text, p_value jsonb,
  p_reason text, p_ip text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  prev jsonb := public.admin_audit_prev(p_request);
  pl public.players;
  v_before jsonb;
  v_after jsonb;
  r jsonb;
begin
  if prev is not null then return prev; end if;
  select * into pl from public.players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  if p_field = 'note' and jsonb_typeof(p_value) in ('string', 'null') then
    v_before := to_jsonb(pl.note);
    update public.players set note = p_value #>> '{}' where id = p_player;
    v_after := p_value;
  elsif p_field = 'banned' and jsonb_typeof(p_value) = 'boolean' then
    v_before := to_jsonb(pl.banned);
    update public.players set banned = (p_value #>> '{}')::boolean where id = p_player;
    v_after := p_value;
  elsif p_field = 'rank_hidden' and jsonb_typeof(p_value) = 'boolean' then
    v_before := to_jsonb(pl.rank_hidden);
    update public.players set rank_hidden = (p_value #>> '{}')::boolean where id = p_player;
    v_after := p_value;
  elsif p_field = 'nickname_reset' then
    v_before := to_jsonb(pl.nickname);
    update public.players set nickname = null where id = p_player;
    v_after := 'null'::jsonb;
  else
    return jsonb_build_object('ok', false, 'reason', 'badRequest');
  end if;
  r := jsonb_build_object('ok', true, 'field', p_field, 'before', v_before, 'after', v_after);
  insert into public.admin_audit (admin_id, action, target_player, target, request_id, reason, before, after, ip)
  values (p_admin, 'player.' || p_field, p_player, p_field, p_request, p_reason,
          jsonb_build_object(p_field, v_before), r, p_ip);
  return r;
end $$;

-- ---------- 조회 ----------
-- 대시보드 숫자(오늘 = KST). 탈퇴: deleted_at이 남은 players(사용자 삭제가 실패해 남은 것) + 오늘 me-delete 로그.
create function public.admin_dashboard()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with t as (select public.save_kst_date(now()) as d)
  select jsonb_build_object(
    'today', (select d from t),
    'activeToday', (select count(*) from public.players, t where public.save_kst_date(last_seen_at) = t.d),
    'newToday', (select count(*) from public.players, t where public.save_kst_date(created_at) = t.d),
    'salesToday', (select coalesce(sum(krw), 0) from public.v_sales_daily, t where kst_date = t.d),
    'sales7d', (select coalesce(sum(krw), 0) from public.v_sales_daily, t where kst_date > t.d - 7),
    'pendingClaims', (select count(*) from public.claims where granted_at is null),
    'errorsToday', (select count(*) from public.server_log, t where level = 'error' and public.save_kst_date(at) = t.d),
    'deleteStuck', (select count(*) from public.players where deleted_at is not null),
    'deletedToday', (select count(*) from public.server_log, t where source = 'me-delete' and public.save_kst_date(at) = t.d));
$$;

-- 검색: 8자 이하 16진수 = 플레이어 코드 앞부분, uuid = 그대로, 그 외 닉네임(부분)·주문번호·legacy_id. 최대 50.
create function public.admin_player_search(p_q text)
returns table (id uuid, nickname text, platform text, best_floor int, last_seen_at timestamptz, banned boolean, rank_hidden boolean)
language plpgsql stable security invoker set search_path = '' as $$
declare
  q text := btrim(coalesce(p_q, ''));
begin
  if q = '' then return; end if;
  return query
  select p.id, p.nickname, p.platform, n.best_floor, p.last_seen_at, p.banned, p.rank_hidden
    from public.players p left join public.normal_best n on n.player_id = p.id
   where case
     when q ~* '^[0-9a-f]{1,8}$' then p.id::text like lower(q) || '%'
     when q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p.id = q::uuid
     else p.nickname ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       or p.legacy_id = q
       or p.id in (select x.player_id from public.purchases x where x.order_id = q)
   end
   order by p.last_seen_at desc nulls last
   limit 50;
end $$;

-- 받는 사람 확인(grant.preview): 줄마다 uuid 또는 코드(앞 8자 이하 16진수) -> status found|banned|deleted|missing|ambiguous.
create function public.admin_resolve_players(p_q text[])
returns table (q text, id uuid, status text, nickname text, app_version text)
language sql stable security invoker set search_path = '' as $$
  with l as (select btrim(x) as q, i from unnest(p_q) with ordinality u(x, i) where btrim(coalesce(x, '')) <> ''),
  m as (
    select l.q, l.i, p.id, p.banned, p.deleted_at, p.nickname, p.app_version, count(*) over (partition by l.i) as n
      from l left join public.players p on
        case when l.q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p.id = l.q::uuid
             when l.q ~* '^[0-9a-f]{8}$' then p.id::text like lower(l.q) || '%'
             else false end
  )
  select distinct on (i) q, case when n = 1 then id end,
         case when id is null then 'missing' when n > 1 then 'ambiguous' when deleted_at is not null then 'deleted'
              when banned then 'banned' else 'found' end,
         case when n = 1 then nickname end, case when n = 1 then app_version end
    from m order by i;
$$;

-- 지급 목록(최근 p_limit) + 받은 수(우편 = mail:{id} claims, 바로 지급 = granted_at 있는 admin:{id}).
create function public.admin_grant_list(p_limit int default 100)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(g) || jsonb_build_object('received',
    case when g.mode = 'mail' then
      (select count(*) from public.mail m join public.claims c on c.tx_id = 'mail:' || m.id
        where m.grant_id = g.id and (m.player_id is null or c.player_id = m.player_id))
    else (select count(*) from public.claims c where c.tx_id = 'admin:' || g.id and c.granted_at is not null) end)
    order by g.id desc), '[]'::jsonb)
  from (select * from public.admin_grants order by id desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) g;
$$;

-- ---------- GRANT ----------
revoke all on function public.admin_bundle_ok(jsonb), public.admin_audit_prev(uuid),
  public.admin_audit_add(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text),
  public.admin_grant(uuid, uuid, text, uuid[], jsonb, text, text, timestamptz, text, text, text),
  public.admin_grant_revoke(uuid, uuid, bigint, text, text),
  public.admin_broadcast(uuid, uuid, jsonb, text, text, timestamptz, text, text),
  public.admin_purchase_regrant(uuid, uuid, bigint, jsonb, text, text),
  public.admin_player_set(uuid, uuid, uuid, text, jsonb, text, text),
  public.admin_dashboard(), public.admin_player_search(text), public.admin_resolve_players(text[]),
  public.admin_grant_list(int) from public, anon, authenticated;
grant execute on function public.admin_bundle_ok(jsonb), public.admin_audit_prev(uuid),
  public.admin_audit_add(uuid, uuid, text, uuid, text, text, jsonb, jsonb, text),
  public.admin_grant(uuid, uuid, text, uuid[], jsonb, text, text, timestamptz, text, text, text),
  public.admin_grant_revoke(uuid, uuid, bigint, text, text),
  public.admin_broadcast(uuid, uuid, jsonb, text, text, timestamptz, text, text),
  public.admin_purchase_regrant(uuid, uuid, bigint, jsonb, text, text),
  public.admin_player_set(uuid, uuid, uuid, text, jsonb, text, text),
  public.admin_dashboard(), public.admin_player_search(text), public.admin_resolve_players(text[]),
  public.admin_grant_list(int) to service_role;
-- 쿠폰 운영 함수: 지금까지 SQL 편집기 전용 -> admin 함수(service_role)도.
grant execute on function public.coupon_create(text, text, text, jsonb, timestamptz, int, text[], timestamptz, text, text),
  public.coupon_batch(text, int, text, text, jsonb, timestamptz, text[], text) to service_role;
