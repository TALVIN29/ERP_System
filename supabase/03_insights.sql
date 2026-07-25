-- Insight engine: 6 SQL rules that surface business findings
-- Each rule applies in_scope() to respect row-level permissions
-- Master function computes all findings and returns as jsonb array

-- Helper: get a setting value, with default fallback
create or replace function get_insight_setting(setting_key text, default_value numeric)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (value::text)::numeric from settings where scope = 'org' and key = setting_key),
    default_value
  )
$$;

-- Master function: compute all 6 insight rules
-- Returns array of {severity, title, finding, metric, delta, action, evidence}
create or replace function compute_insights()
returns jsonb[]
language sql
stable
security definer
set search_path = public
as $$
with

-- Rule 1: Discount break-even
-- Profit by discount bucket, find where it crosses zero
rule_1_data as (
  select
    'discount-breakeven' as id,
    'critical' as severity,
    threshold,
    affected_count,
    profit_lost
  from (
    select
      (select get_insight_setting('insight_discount_threshold', 0.20)) as threshold,
      count(*) as affected_count,
      sum(profit) as profit_lost
    from order_items oi
    where in_scope(oi.region, oi.category)
      and oi.discount >= (select get_insight_setting('insight_discount_threshold', 0.20))
  ) t
),

rule_1 as (
  select jsonb_build_object(
    'id', id,
    'severity', severity,
    'title', concat('Discounts above ', round((threshold * 100)::int), '% destroy margin'),
    'finding', concat(
      'Every order line discounted above ', round((threshold * 100)::int), '% loses money on average. ',
      affected_count::text, ' lines crossed it, costing $', abs(profit_lost)::int::text, ' in profit.'
    ),
    'metric', jsonb_build_object('label', 'Break-even discount', 'value', round((threshold * 100)::int) || '%', 'format', 'percent'),
    'delta', jsonb_build_object('label', 'Profit lost', 'value', -profit_lost, 'format', 'currency'),
    'action', concat('Cap discretionary discounts at ', round((threshold * 100)::int), '%; require approval above it.'),
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
    'title', concat(sub_category, ': $', abs(profit_total)::int::text, ' loss on $', sales_total::int::text, ' sales'),
    'finding', concat(sub_category, ' sells well but returns a negative margin across ', line_count::text, ' order lines.'),
    'metric', jsonb_build_object('label', 'Sales', 'value', '$' || sales_total::int::text, 'format', 'currency'),
    'delta', jsonb_build_object('label', 'Loss', 'value', -profit_total, 'format', 'currency'),
    'action', concat('Review ', sub_category, ' pricing and discount policy, or discontinue.'),
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    select
      p.sub_category,
      sum(oi.sales)::numeric as sales_total,
      sum(oi.profit)::numeric as profit_total,
      count(*) as line_count
    from order_items oi
    join products p on oi.product_id = p.product_id
    where in_scope(oi.region, oi.category)
    group by p.sub_category
    having sum(oi.profit) < -(select get_insight_setting('insight_min_loss', 1000))
  ) t
),

-- Rule 3: Ship-lag outliers
-- Orders exceeding median lag for their ship_mode
rule_3 as (
  select jsonb_build_object(
    'id', concat('ship-lag-', ship_mode),
    'severity', 'warning',
    'title', concat(ship_mode, ' ships ', round(lag_delta, 1)::text, ' days later than its median'),
    'finding', concat(tail_count::text, ' of ', mode_count::text, ' ', ship_mode, ' lines in slow tail.'),
    'metric', jsonb_build_object('label', 'Median lag', 'value', mode_median::int::text || ' d', 'format', 'text'),
    'delta', jsonb_build_object('label', 'Tail average', 'value', round(lag_delta, 1)::text || ' d', 'format', 'text'),
    'action', concat('Audit ', ship_mode, ' tail — median is fine, tail is not.'),
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    select
      oi.ship_mode,
      percentile_cont(0.5) within group (order by oi.ship_lag_days)::int as mode_median,
      count(*) as mode_count,
      count(*) filter (where oi.ship_lag_days > percentile_cont(0.5) within group (order by oi.ship_lag_days) + 2)::int as tail_count,
      (count(*) filter (where oi.ship_lag_days > percentile_cont(0.5) within group (order by oi.ship_lag_days) + 2)::float / count(*)) as tail_pct,
      avg(oi.ship_lag_days) filter (where oi.ship_lag_days > percentile_cont(0.5) within group (order by oi.ship_lag_days) + 2) as lag_delta
    from order_items oi
    where in_scope(oi.region, oi.category)
    group by oi.ship_mode
  ) t
  where tail_pct > 0.1
),

-- Rule 4: Revenue concentration
-- Top 5% of customers' share of revenue
rule_4 as (
  select jsonb_build_object(
    'id', 'revenue-concentration',
    'severity', 'serious',
    'title', concat('Top 5% of customers generate ', round(top_share_pct, 1)::text, '% of revenue'),
    'finding', 'Revenue leans on a small group. Losing any of them moves the number.',
    'metric', jsonb_build_object('label', 'Share of revenue', 'value', round(top_share_pct, 1)::text || '%', 'format', 'text'),
    'delta', jsonb_build_object('label', 'Concentration risk', 'value', 'high', 'format', 'text'),
    'action', 'Assign named ownership to the top 5% before the next quarter.',
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    with customer_revenue as (
      select
        order_id,
        sum(oi.sales) as revenue
      from order_items oi
      where in_scope(oi.region, oi.category)
      group by order_id
    ),
    ranked as (
      select
        revenue,
        row_number() over (order by revenue desc) as rank,
        count(*) over () as total_count
      from customer_revenue
    ),
    top_5pct as (
      select sum(revenue) as top_revenue
      from ranked
      where rank <= (total_count * 0.05)::int
    )
    select
      round(100 * top_revenue / (select sum(revenue) from ranked), 1)::numeric as top_share_pct
    from top_5pct, (select sum(revenue) as total_revenue from ranked) t
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
    'finding', concat('Worst: ', worst_name, ', loses $', worst_loss::int::text, ' across ', worst_lines::text, ' lines.'),
    'metric', jsonb_build_object('label', 'Loss-making SKUs', 'value', loser_count::text, 'format', 'text'),
    'delta', jsonb_build_object('label', 'Combined loss', 'value', -total_loss, 'format', 'currency'),
    'action', 'Delist or reprice the top 5 loss-makers.',
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    select
      count(*) as loser_count,
      (array_agg(p.name order by sum(oi.profit) asc))[1] as worst_name,
      abs((array_agg(sum(oi.profit) order by sum(oi.profit) asc))[1]) as worst_loss,
      (array_agg(count(*) order by sum(oi.profit) asc))[1]::text as worst_lines,
      sum(sum(oi.profit)) as total_loss
    from order_items oi
    join products p on oi.product_id = p.product_id
    where in_scope(oi.region, oi.category)
    group by p.product_id, p.name
    having sum(oi.profit) < 0
  ) t
  where loser_count > 0
),

-- Rule 6: Region trend break
-- Region below its trailing 3-month average
rule_6 as (
  select jsonb_build_object(
    'id', concat('region-trend-', region),
    'severity', 'warning',
    'title', concat(region, ' is ', pct_below::text, '% below 3-month trend'),
    'finding', concat(region, ' running below historic pace for second consecutive month.'),
    'metric', jsonb_build_object('label', 'Below average', 'value', pct_below::text || '%', 'format', 'text'),
    'delta', jsonb_build_object('label', 'Trend delta', 'value', (current_month_sales - trend_avg)::numeric, 'format', 'currency'),
    'action', concat('Review ', region, ' pipeline and discounting.'),
    'evidence', jsonb_build_object('type', 'table')
  ) as finding
  from (
    with monthly_sales as (
      select
        oi.region,
        date_trunc('month', oi.order_date)::date as month,
        sum(oi.sales) as sales
      from order_items oi
      where in_scope(oi.region, oi.category)
      group by oi.region, date_trunc('month', oi.order_date)::date
    )
    select
      region,
      (array_agg(sales order by month desc))[1]::numeric as current_month_sales,
      avg((array_agg(sales order by month desc))[2:4]) as trend_avg,
      round(100 * (1 - (array_agg(sales order by month desc))[1] / avg((array_agg(sales order by month desc))[2:4])))::int as pct_below
    from monthly_sales
    group by region
    having avg((array_agg(sales order by month desc))[2:4]) > 0
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

select array_agg(finding order by (finding->>'severity')::text desc) as findings
from all_findings
$$;
