-- 이벤트 배너 + 1회 보상(docs/events.md). s1_core의 빈 events 표를 넓힌다. 판정은 쿠폰과 같은 구조:
-- claims 'event:{id}'(kind 'event') -> 기기 grant -> claims-granted. 출시 이벤트 행은 여기 넣지 않는다(운영 함수로 등록).
-- (버전 20261128000000은 toss_restore가 이미 써서 01로.)

-- ---------- 지급 내용 검사 ----------
-- coupon_bundle_ok 범위(다이아·골드·아이템) + spiritStones(양의 정수, 1000 이하). 두 기존 검사 모두 spiritStones를 안 받아서 따로.
create function public.event_bundle_ok(b jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  s jsonb := b -> 'spiritStones';
begin
  if b is null or jsonb_typeof(b) <> 'object' then return false; end if;
  if s is not null and (jsonb_typeof(s) <> 'number' or s::numeric <> trunc(s::numeric) or s::numeric < 1 or s::numeric > 1000) then
    return false;
  end if;
  if b - 'spiritStones' = '{}'::jsonb then return s is not null; end if;
  return public.coupon_bundle_ok(b - 'spiritStones');
end $$;

-- ---------- 표 ----------
alter table public.events
  add column kind text not null default 'claim',   -- claim(1회 보상) | notice(안내만). 모르는 kind는 앱이 숨긴다
  add column bundle jsonb,
  add column banner text,                          -- 앱에 든 그림 키(assets/ui/events/banner_{banner}.png)
  add column banner_url text,                      -- Storage event-banners 공개 URL - 있으면 이쪽 우선
  add column body_ko text,
  add column body_en text,
  add column platforms text[],                     -- null = 전부. players.platform 값
  add column sort int not null default 0,
  add column created_at timestamptz default now(),
  add constraint events_claim_bundle check (kind <> 'claim' or public.event_bundle_ok(bundle));

-- ---------- 판정 (순서: banned -> notFound -> notStarted -> expired -> platform -> already) ----------
create function public.event_claim(p_player uuid, p_event text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_banned boolean;
  v_platform text;
  e public.events;
  v_tx text := 'event:' || p_event;
begin
  select banned, platform into v_banned, v_platform from public.players where id = p_player;
  if coalesce(v_banned, false) then return jsonb_build_object('ok', false, 'reason', 'banned'); end if;
  select * into e from public.events where id = p_event;
  if not found or not e.enabled or e.kind <> 'claim' then return jsonb_build_object('ok', false, 'reason', 'notFound'); end if;
  if e.starts_at is not null and now() < e.starts_at then return jsonb_build_object('ok', false, 'reason', 'notStarted'); end if;
  if e.ends_at is not null and e.ends_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if e.platforms is not null and (v_platform is null or not v_platform = any(e.platforms)) then
    return jsonb_build_object('ok', false, 'reason', 'platform');
  end if;
  if exists (select 1 from public.claims where player_id = p_player and tx_id = v_tx) then
    return jsonb_build_object('ok', false, 'reason', 'already');
  end if;
  insert into public.claims (player_id, tx_id, kind, bundle) values (p_player, v_tx, 'event', e.bundle);
  return jsonb_build_object('ok', true, 'txId', v_tx, 'bundle', e.bundle,
                            'title', jsonb_build_object('ko', e.title_ko, 'en', e.title_en));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'already');
end $$;

-- 지금 보이는 이벤트(켜짐, 기간 안, 플랫폼 맞음) - sort, starts_at 순. 시각은 ms(우편 expiresAt과 같게).
create function public.event_list(p_player uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'kind', e.kind,
      'title', jsonb_build_object('ko', e.title_ko, 'en', e.title_en),
      'body', jsonb_build_object('ko', e.body_ko, 'en', e.body_en),
      'banner', e.banner, 'bannerUrl', e.banner_url, 'bundle', e.bundle,
      'startsAt', (extract(epoch from e.starts_at) * 1000)::bigint,
      'endsAt', (extract(epoch from e.ends_at) * 1000)::bigint,
      'claimed', exists (select 1 from public.claims c where c.player_id = p_player and c.tx_id = 'event:' || e.id))
    order by e.sort, e.starts_at nulls first, e.id), '[]'::jsonb)
    from public.events e
   where e.enabled
     and (e.starts_at is null or e.starts_at <= now())
     and (e.ends_at is null or now() < e.ends_at)
     and (e.platforms is null or (select p.platform from public.players p where p.id = p_player) = any(e.platforms));
$$;

-- ---------- 운영 함수 (쑹이 SQL 편집기에서, docs/events.md) ----------
-- 꺼진 상태로 만든다(미리 등록 -> 출시 때 event_set_enabled로 켜기).
create function public.event_create(
  p_id text, p_title_ko text, p_title_en text, p_body_ko text, p_body_en text, p_bundle jsonb,
  p_starts_at timestamptz, p_ends_at timestamptz, p_banner text default null, p_platforms text[] default null, p_sort int default 0)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  if p_id is null or p_id !~ '^[A-Za-z0-9_-]{1,40}$' then
    raise exception '이벤트 id "%"를 쓸 수 없어요: 영문·숫자·_·- 1~40자', p_id;
  end if;
  if not coalesce(public.event_bundle_ok(p_bundle), false) then
    raise exception '지급 내용 %이(가) 잘못됐어요: 키는 diamonds/gold/items/spiritStones만, 양의 정수, 다이아 5000·골드 1000000·아이템 개당 99·정령석 1000 이하', p_bundle;
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception '기간이 잘못됐어요: 시작 %, 끝 %', p_starts_at, p_ends_at;
  end if;
  if exists (select 1 from public.events where id = p_id) then
    raise exception '이미 있는 이벤트 id예요: %', p_id;
  end if;
  insert into public.events (id, kind, title_ko, title_en, body_ko, body_en, bundle, starts_at, ends_at, banner, platforms, sort, enabled)
  values (p_id, 'claim', p_title_ko, p_title_en, p_body_ko, p_body_en, p_bundle, p_starts_at, p_ends_at, p_banner, p_platforms,
          coalesce(p_sort, 0), false);
  return jsonb_build_object('id', p_id, 'enabled', false);
end $$;

create function public.event_set_enabled(p_id text, p_on boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  update public.events set enabled = coalesce(p_on, false) where id = p_id;
  if not found then raise exception '없는 이벤트 id예요: %', p_id; end if;
  return jsonb_build_object('id', p_id, 'enabled', coalesce(p_on, false));
end $$;

revoke all on function public.event_bundle_ok(jsonb), public.event_claim(uuid, text), public.event_list(uuid),
  public.event_create(text, text, text, text, text, jsonb, timestamptz, timestamptz, text, text[], int),
  public.event_set_enabled(text, boolean) from public, anon, authenticated;
-- service_role: 판정·목록 + 표 check에서 쓰는 검사(관리자 함수가 표를 직접 쓸 때). 운영 함수는 SQL 편집기 전용(쿠폰과 같게).
grant execute on function public.event_bundle_ok(jsonb), public.event_claim(uuid, text), public.event_list(uuid) to service_role;

-- ---------- 배너 그림 (공개 읽기, 쓰기는 service_role = admin 함수만) ----------
insert into storage.buckets (id, name, public)
values ('event-banners', 'event-banners', true)
on conflict (id) do nothing;
