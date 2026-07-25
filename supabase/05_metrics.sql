-- Dashboard aggregates.
--
-- These exist because netlify/functions/metrics.js calls them by name; without
-- them every dashboard request returns PGRST202 and the tiles stay empty.
-- Shapes match buildMetrics() in src/lib/mock.js, which is what the React
-- pages render against.
--
-- Every function applies in_scope() so a scoped user's totals are their own.
-- They are SECURITY INVOKER (the default) on purpose: aggregating through the
-- caller's own RLS is what keeps the numbers honest.

-- Sales, profit, order count and average order value, each with a delta
-- against the preceding window of the same length.
create or replace function get_dashboard_kpis()
returns table (key text, label text, value numeric, format text, delta numeric)
language sql
stable
as $$
  with scoped as (
    select oi.sales, oi.profit, oi.order_id, o.order_date
    from order_items oi
    join orders o on o.order_id = oi.order_id
    where in_scope(oi.region, oi.category)
  ),
  bounds as (
    select max(order_date) as max_d, min(order_date) as min_d from scoped
  ),
  -- "Recent" is the last 90 days of the data itself, not of wall-clock time —
  -- the Superstore export ends in 2018 and a real-time window would be empty.
  windows as (
    select
      (select max_d from bounds) - interval '90 days' as cur_start,
      (select max_d from bounds) - interval '180 days' as prev_start,
      (select max_d from bounds) as cur_end
  ),
  cur as (
    select coalesce(sum(sales), 0) s, coalesce(sum(profit), 0) p,
           count(distinct order_id) n
    from scoped, windows
    where order_date > cur_start and order_date <= cur_end
  ),
  prev as (
    select coalesce(sum(sales), 0) s, coalesce(sum(profit), 0) p,
           count(distinct order_id) n
    from scoped, windows
    where order_date > prev_start and order_date <= cur_start
  ),
  total as (
    select coalesce(sum(sales), 0) s, coalesce(sum(profit), 0) p,
           count(distinct order_id) n
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
         case
           when prev.n = 0 or prev.s = 0 or cur.n = 0 then 0
           else round(((cur.s / cur.n) - (prev.s / prev.n)) / (prev.s / prev.n), 4)
         end
  from total, cur, prev;
$$;

-- Monthly sales for the trend line, oldest first.
create or replace function get_sales_trend()
returns table (month text, sales numeric)
language sql
stable
as $$
  select to_char(date_trunc('month', o.order_date), 'YYYY-MM') as month,
         round(sum(oi.sales), 2) as sales
  from order_items oi
  join orders o on o.order_id = oi.order_id
  where in_scope(oi.region, oi.category)
  group by date_trunc('month', o.order_date)
  order by date_trunc('month', o.order_date);
$$;

-- Profit by category. Furniture comes out negative on the real data, which is
-- the point of the diverging bar.
create or replace function get_category_profit()
returns table (category text, profit numeric)
language sql
stable
as $$
  select oi.category, round(sum(oi.profit), 2) as profit
  from order_items oi
  where in_scope(oi.region, oi.category)
  group by oi.category
  order by oi.category;
$$;

-- Sales by region for the donut.
create or replace function get_region_sales()
returns table (region text, sales numeric)
language sql
stable
as $$
  select oi.region, round(sum(oi.sales), 2) as sales
  from order_items oi
  where in_scope(oi.region, oi.category)
  group by oi.region
  order by oi.region;
$$;

-- Scope options for the Users screen, derived from the data rather than a
-- hardcoded list, so swapping the dataset needs no code change.
create or replace function get_scope_options()
returns table (regions text[], categories text[])
language sql
stable
as $$
  select
    array(select distinct region from order_items where region is not null order by region),
    array(select distinct category from order_items where category is not null order by category);
$$;

-- netlify/functions/insights.js calls get_insights(); the rule engine in
-- 03_insights.sql is named compute_insights(). A thin alias is cheaper than
-- keeping two call sites in step.
create or replace function get_insights()
returns jsonb
language sql
stable
as $$ select compute_insights() $$;
