-- Performance pass on the dashboard aggregates.
--
-- Measured before this file: /api/metrics took 9.6s. Two causes.
--
-- 1. The four aggregate RPCs each took 1.3-1.9s because they ran as SECURITY
--    INVOKER, so the RLS policy on order_items evaluated in_scope() ONCE PER
--    ROW — a profiles subquery 9,994 times per query, per RPC.
-- 2. metrics.js awaited them one after another, so the costs added up.
--
-- The fix here is (1): the aggregates become SECURITY DEFINER, read the
-- caller's scope exactly once into a CTE, and apply it as a plain filter.
-- Bypassing RLS means the permission check has to be explicit, so each one
-- calls has_perm('insights','read') first and raises 42501 otherwise —
-- the same contract save_role_grants() follows.
--
-- (2) is fixed in netlify/functions/metrics.js by awaiting them together.

-- One row: the caller's scope, resolved once instead of per row.
create or replace function my_scope()
returns table (regions text[], categories text[])
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(scope_regions, '{}'), coalesce(scope_categories, '{}')
  from profiles where user_id = auth.uid()
$$;

create or replace function require_insights_read()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_perm('insights', 'read') then
    raise exception 'You do not have permission to read insights'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function get_dashboard_kpis()
returns table (key text, label text, value numeric, format text, delta numeric)
language sql
stable
security definer
set search_path = public
as $$
  with guard as (select require_insights_read()),
  me as (select * from my_scope()),
  scoped as (
    select oi.sales, oi.profit, oi.order_id, o.order_date
    from order_items oi
    join orders o on o.order_id = oi.order_id, me, guard
    where (array_length(me.regions, 1) is null or oi.region = any(me.regions))
      and (array_length(me.categories, 1) is null or oi.category = any(me.categories))
  ),
  bounds as (select max(order_date) as max_d from scoped),
  cur as (
    select coalesce(sum(sales), 0) s, coalesce(sum(profit), 0) p, count(distinct order_id) n
    from scoped, bounds
    where order_date > bounds.max_d - interval '90 days'
  ),
  prev as (
    select coalesce(sum(sales), 0) s, coalesce(sum(profit), 0) p, count(distinct order_id) n
    from scoped, bounds
    where order_date > bounds.max_d - interval '180 days'
      and order_date <= bounds.max_d - interval '90 days'
  ),
  total as (
    select coalesce(sum(sales), 0) s, coalesce(sum(profit), 0) p, count(distinct order_id) n
    from scoped
  )
  select 'sales', 'Sales', total.s, 'currency',
         case when prev.s = 0 then 0 else round((cur.s - prev.s) / prev.s, 4) end
  from total, cur, prev
  union all
  select 'profit', 'Profit', total.p, 'currency',
         case when prev.p = 0 then 0 else round((cur.p - prev.p) / abs(prev.p), 4) end
  from total, cur, prev
  union all
  select 'orders', 'Orders', total.n::numeric, 'number',
         case when prev.n = 0 then 0 else round((cur.n - prev.n)::numeric / prev.n, 4) end
  from total, cur, prev
  union all
  select 'aov', 'Avg order',
         case when total.n = 0 then 0 else round(total.s / total.n, 2) end, 'currency',
         case when prev.n = 0 or prev.s = 0 or cur.n = 0 then 0
              else round(((cur.s / cur.n) - (prev.s / prev.n)) / (prev.s / prev.n), 4) end
  from total, cur, prev;
$$;

create or replace function get_sales_trend()
returns table (month text, sales numeric)
language sql
stable
security definer
set search_path = public
as $$
  with guard as (select require_insights_read()), me as (select * from my_scope())
  select to_char(date_trunc('month', o.order_date), 'YYYY-MM'), round(sum(oi.sales), 2)
  from order_items oi
  join orders o on o.order_id = oi.order_id, me, guard
  where (array_length(me.regions, 1) is null or oi.region = any(me.regions))
    and (array_length(me.categories, 1) is null or oi.category = any(me.categories))
  group by date_trunc('month', o.order_date)
  order by date_trunc('month', o.order_date);
$$;

create or replace function get_category_profit()
returns table (category text, profit numeric)
language sql
stable
security definer
set search_path = public
as $$
  with guard as (select require_insights_read()), me as (select * from my_scope())
  select oi.category, round(sum(oi.profit), 2)
  from order_items oi, me, guard
  where (array_length(me.regions, 1) is null or oi.region = any(me.regions))
    and (array_length(me.categories, 1) is null or oi.category = any(me.categories))
  group by oi.category
  order by oi.category;
$$;

create or replace function get_region_sales()
returns table (region text, sales numeric)
language sql
stable
security definer
set search_path = public
as $$
  with guard as (select require_insights_read()), me as (select * from my_scope())
  select oi.region, round(sum(oi.sales), 2)
  from order_items oi, me, guard
  where (array_length(me.regions, 1) is null or oi.region = any(me.regions))
    and (array_length(me.categories, 1) is null or oi.category = any(me.categories))
  group by oi.region
  order by oi.region;
$$;

-- The guard chain looked a user's permissions up with two sequential queries
-- (profiles, then role_permissions joined to permissions) on every single
-- request. One function call replaces both. It takes the user id explicitly
-- because the guard calls it with the service client, where auth.uid() is null.
create or replace function grants_for_user(p_user uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p.module || '.' || p.action), '{}')
  from profiles prof
  join role_permissions rp on rp.role_id = prof.role_id
  join permissions p on p.id = rp.permission_id
  where prof.user_id = p_user
$$;

-- Covering indexes for the aggregate scans. The existing single-column indexes
-- on region/category do not help a query that reads sales and profit too.
create index if not exists idx_order_items_scope_cover
  on order_items (region, category) include (sales, profit, order_id);

create index if not exists idx_orders_order_date on orders (order_date);
create index if not exists idx_orders_id_date on orders (order_id) include (order_date);

analyze order_items;
analyze orders;
