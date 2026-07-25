-- compute_insights(), rewritten to scan once.
--
-- Measured at 3.97s. The function is already SECURITY DEFINER, so RLS was
-- never the cost: each of its six rules called in_scope(oi.region, oi.category)
-- in its own WHERE clause, and that is a profiles subquery per row across
-- seven separate scans of order_items.
--
-- Generated from 03_insights.sql by pointing those scans at one shared
-- `scoped` CTE. The rule logic itself is untouched.

create or replace function compute_insights()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with
-- Resolve the caller's scope ONCE and materialise the rows every rule reads.
-- Each rule used to call in_scope(oi.region, oi.category) in its own WHERE,
-- which is a profiles subquery per row, across seven separate scans.
me as (select my_regions() as regions, my_categories() as categories),
scoped as (
  select oi.*
  from order_items oi, me
  where (array_length(me.regions, 1) is null or oi.region = any(me.regions))
    and (array_length(me.categories, 1) is null or oi.category = any(me.categories))
),

-- Rule 1: Discount break-even
-- Derive the break-even point from the data: bucket by rounded discount%,
-- take the first bucket (ascending) whose summed profit goes negative.
-- The configured setting is only a fallback when no bucket crosses zero.
rule_1_buckets as (
  select
    round(oi.discount * 100)::int as bucket,
    sum(oi.profit) as bucket_profit
  from scoped oi
  group by round(oi.discount * 100)::int
),

rule_1_threshold as (
  select coalesce(
    (select bucket from rule_1_buckets where bucket_profit < 0 order by bucket asc limit 1),
    (select get_insight_setting('insight_discount_threshold', 0.20) * 100)::int
  ) as threshold_pct
),

rule_1_data as (
  select
    'discount-break-even' as id,
    'critical' as severity,
    rt.threshold_pct,
    count(*) as affected_count,
    sum(oi.profit) as profit_lost
  from scoped oi, rule_1_threshold rt
  where oi.discount >= (rt.threshold_pct::numeric / 100)
  group by rt.threshold_pct
),

rule_1 as (
  select jsonb_build_object(
    'id', id,
    'severity', severity,
    'title', concat('Discounts above ', threshold_pct, '% destroy margin'),
    'finding', concat(
      'Every order line discounted above ', threshold_pct, '% loses money on average. ',
      affected_count::text, ' lines crossed it, costing $', abs(profit_lost)::int::text, ' in profit.'
    ),
    'metrics', jsonb_build_array(
      jsonb_build_object('label', 'Break-even discount', 'value', threshold_pct || '%'),
      jsonb_build_object('label', 'Profit lost', 'value', '−$' || abs(profit_lost)::int::text, 'tone', 'down'),
      jsonb_build_object('label', 'Lines affected', 'value', affected_count::text)
    ),
    'action', concat('Cap discretionary discounts at ', threshold_pct, '%; require approval above it.'),
    'evidence', jsonb_build_object('type', 'discount-scatter')
  ) as finding
  from rule_1_data
  where profit_lost is not null and profit_lost < 0
),

-- Rule 2: Margin leak by sub-category
-- High sales, negative profit per category
rule_2 as (
  select jsonb_build_object(
    'id', concat('margin-leak-', sub_category),
    'severity', 'critical',
    'title', concat(sub_category, ' loses $', abs(profit_total)::int::text, ' on $', sales_total::int::text, ' of sales'),
    'finding', concat(sub_category, ' sells well but returns a negative margin across ', line_count::text, ' order lines.'),
    'metrics', jsonb_build_array(
      jsonb_build_object('label', 'Sales', 'value', '$' || sales_total::int::text),
      jsonb_build_object('label', 'Profit', 'value', '−$' || abs(profit_total)::int::text, 'tone', 'down')
    ),
    'action', concat('Reprice ', sub_category, ' or withdraw its lowest-margin SKUs.'),
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    select
      p.sub_category,
      sum(oi.sales)::numeric as sales_total,
      sum(oi.profit)::numeric as profit_total,
      count(*) as line_count
    from scoped oi
    join products p on oi.product_id = p.product_id
    group by p.sub_category
    having sum(oi.profit) < -(select get_insight_setting('insight_min_loss', 1000))
  ) t
),

-- Rule 3: Ship-lag outliers
-- Orders exceeding median lag for their ship_mode
-- ship_mode/ship_lag_days live on orders, not order_items -- join to reach them.
rule_3 as (
  select jsonb_build_object(
    'id', concat('ship-lag-', ship_mode),
    'severity', 'warning',
    'title', concat(ship_mode, ' ships ', round(avg_tail - mode_median, 1)::text, ' days later than its own median'),
    'finding', concat(tail_count::text, ' of ', mode_count::text, ' ', ship_mode, ' lines fall in the slow tail.'),
    'metrics', jsonb_build_array(
      jsonb_build_object('label', 'Median lag', 'value', mode_median::text || ' d'),
      jsonb_build_object('label', 'Tail average', 'value', round(avg_tail, 1)::text || ' d')
    ),
    'action', concat('Audit the ', ship_mode, ' tail — the median is fine, the tail is not.'),
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    -- The median has to be its own aggregation pass: Postgres rejects an
    -- ordered-set aggregate inside FILTER, so it cannot be computed and
    -- compared against in the same select.
    with mode_lags as (
      select o.ship_mode, o.ship_lag_days
      from scoped oi
      join orders o on oi.order_id = o.order_id
    ),
    mode_medians as (
      select
        ship_mode,
        percentile_cont(0.5) within group (order by ship_lag_days)::int as mode_median
      from mode_lags
      group by ship_mode
    )
    select
      m.ship_mode,
      m.mode_median,
      count(*) as mode_count,
      count(*) filter (where l.ship_lag_days > m.mode_median + 2)::int as tail_count,
      (count(*) filter (where l.ship_lag_days > m.mode_median + 2)::float / count(*)) as tail_pct,
      avg(l.ship_lag_days) filter (where l.ship_lag_days > m.mode_median + 2) as avg_tail
    from mode_lags l
    join mode_medians m on m.ship_mode = l.ship_mode
    group by m.ship_mode, m.mode_median
  ) t
  where tail_pct > 0.1
),

-- Rule 4: Revenue concentration
-- Top 5% of customers' share of revenue
rule_4 as (
  select jsonb_build_object(
    'id', 'revenue-concentration',
    'severity', 'serious',
    'title', concat('Top 5% of customers generate ', top_share_pct, '% of revenue'),
    'finding', 'Revenue leans on a small group. Losing any of them moves the whole number.',
    'metrics', jsonb_build_array(
      jsonb_build_object('label', 'Share of revenue', 'value', top_share_pct::text || '%'),
      jsonb_build_object('label', 'Accounts', 'value', top_count::text)
    ),
    'action', 'Assign named ownership to the top 5% before the next quarter.',
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    with customer_revenue as (
      select
        order_id,
        sum(oi.sales) as revenue
      from scoped oi
      group by order_id
    ),
    ranked as (
      select
        revenue,
        row_number() over (order by revenue desc) as rank,
        count(*) over () as total_count
      from customer_revenue
    ),
    top_n as (
      select greatest(1, round(total_count * 0.05)::int) as top_count
      from ranked
      limit 1
    ),
    top_5pct as (
      select sum(r.revenue) as top_revenue, tn.top_count
      from ranked r, top_n tn
      where r.rank <= tn.top_count
      group by tn.top_count
    )
    select
      round(100 * top_revenue / (select sum(revenue) from ranked))::int as top_share_pct,
      top_count
    from top_5pct
  ) result
  where top_share_pct > 15
),

-- Rule 5: Loss-making SKUs
-- Products with negative total profit
rule_5 as (
  select jsonb_build_object(
    'id', 'loss-making-skus',
    'severity', 'serious',
    'title', concat(loser_count::text, ' products sell at a loss'),
    'finding', concat('The worst, ', worst_name, ', loses $', worst_loss::int::text, ' across ', worst_lines::text, ' lines.'),
    'metrics', jsonb_build_array(
      jsonb_build_object('label', 'Loss-making SKUs', 'value', loser_count::text),
      jsonb_build_object('label', 'Combined loss', 'value', '−$' || abs(total_loss)::int::text, 'tone', 'down')
    ),
    'action', 'Delist or reprice the ten worst SKUs.',
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    -- Per-product totals have to land in their own CTE first. Rolling them up
    -- across products in the same select would nest one aggregate inside
    -- another, which Postgres rejects.
    with product_profit as (
      select
        p.name,
        sum(oi.profit) as profit,
        count(*) as lines
      from scoped oi
      join products p on oi.product_id = p.product_id
      group by p.product_id, p.name
      having sum(oi.profit) < 0
    )
    select
      count(*) as loser_count,
      (array_agg(name order by profit asc))[1] as worst_name,
      abs((array_agg(profit order by profit asc))[1]) as worst_loss,
      (array_agg(lines order by profit asc))[1]::text as worst_lines,
      sum(profit) as total_loss
    from product_profit
  ) t
  where loser_count > 0
),

-- Rule 6: Region trend break
-- Region below its trailing 3-month average
-- order_date lives on orders, not order_items -- join to reach it.
rule_6 as (
  select jsonb_build_object(
    'id', concat('region-trend-', region),
    'severity', 'warning',
    'title', concat(region, ' is ', pct_below::text, '% below 3-month trend'),
    'finding', concat(region, ' running below historic pace for second consecutive month.'),
    'metrics', jsonb_build_array(
      jsonb_build_object('label', 'Below average', 'value', pct_below::text || '%'),
      jsonb_build_object('label', 'Trend delta', 'value', '$' || (current_month_sales - trend_avg)::int::text)
    ),
    'action', concat('Review ', region, ' pipeline and discounting.'),
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    with monthly_sales as (
      select
        oi.region,
        date_trunc('month', o.order_date)::date as month,
        sum(oi.sales) as sales
      from scoped oi
      join orders o on oi.order_id = o.order_id
      group by oi.region, date_trunc('month', o.order_date)::date
    ),
    -- Rank the months first, then aggregate over the ranks. Slicing an
    -- array_agg and averaging it nests one aggregate inside another, and
    -- avg() takes a set of rows, never an array.
    ranked_months as (
      select
        region,
        sales,
        row_number() over (partition by region order by month desc) as rn
      from monthly_sales
    ),
    region_trend as (
      select
        region,
        max(sales) filter (where rn = 1) as current_month_sales,
        avg(sales) filter (where rn between 2 and 4) as trend_avg
      from ranked_months
      where rn <= 4
      group by region
    )
    select
      region,
      current_month_sales,
      trend_avg,
      round(100 * (1 - current_month_sales / trend_avg))::int as pct_below
    from region_trend
    where trend_avg > 0 and current_month_sales is not null
  ) t
  where pct_below > 15
),

all_findings as (
  select finding from rule_1
  union all
  select finding from rule_2
  union all
  select finding from rule_3
  union all
  select finding from rule_4
  union all
  select finding from rule_5
  union all
  select finding from rule_6
)

-- Severity order is an explicit rank, not alphabetical (alpha would put
-- 'warning' before 'critical').
select coalesce(
  jsonb_agg(finding order by case finding->>'severity'
    when 'critical' then 0
    when 'serious' then 1
    when 'warning' then 2
    else 3
  end),
  '[]'::jsonb
)
from all_findings
$$;
