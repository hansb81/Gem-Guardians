-- 출석 정령석(docs/spirit-stones.md B): 7일째와 연속 보너스에 spiritStones가 둘 다 있으면 더해야 한다(5 + 5 = 10).
-- 20261121000000_att_streak.sql의 bundle_add는 diamonds·gold·items만 더하고 그 밖의 키는 b 우선이라 5가 됐다.
-- 같은 인자로 다시 만든다(create or replace - att_claim과 권한은 그대로).
create or replace function public.bundle_add(a jsonb, b jsonb)
returns jsonb language sql immutable security invoker set search_path = '' as $$
  with o as (
    select case when jsonb_typeof(a) = 'object' then a else '{}'::jsonb end as x,
           case when jsonb_typeof(b) = 'object' then b else '{}'::jsonb end as y
  ), it as (
    select e.key, sum(e.value::numeric) as n
      from o, lateral (
        select * from jsonb_each_text(case when jsonb_typeof(o.x -> 'items') = 'object' then o.x -> 'items' else '{}'::jsonb end)
        union all
        select * from jsonb_each_text(case when jsonb_typeof(o.y -> 'items') = 'object' then o.y -> 'items' else '{}'::jsonb end)
      ) e
     group by e.key
  )
  select ((((o.x || o.y) - 'diamonds') - 'gold') - 'spiritStones') - 'items' || jsonb_strip_nulls(jsonb_build_object(
    'diamonds', nullif(coalesce((o.x ->> 'diamonds')::numeric, 0) + coalesce((o.y ->> 'diamonds')::numeric, 0), 0),
    'gold', nullif(coalesce((o.x ->> 'gold')::numeric, 0) + coalesce((o.y ->> 'gold')::numeric, 0), 0),
    'spiritStones', nullif(coalesce((o.x ->> 'spiritStones')::numeric, 0) + coalesce((o.y ->> 'spiritStones')::numeric, 0), 0),
    'items', (select jsonb_object_agg(it.key, it.n) from it)))
    from o;
$$;
