-- Second performance pass: the table reads and the guard chain.
--
-- 07_perf.sql fixed the dashboard aggregates (9.6s -> ~2.0s) by taking them out
-- of RLS. The plain table reads still pay the same tax: the policy calls
-- in_scope(region, category) for EVERY ROW, and because the arguments come from
-- the row, Postgres cannot cache it — 9,994 profile subqueries per list query.
--
-- The fix is the standard Postgres/Supabase RLS pattern: compare against an
-- UNCORRELATED subquery. `(select ... from my_scope())` does not reference the
-- row, so the planner hoists it into an InitPlan and evaluates it exactly once
-- per query instead of once per row.
--
-- Measured before: orders 4.0s, products 3.8s, customers 4.0s, insights 4.1s.

-- Scalar helpers. Uncorrelated by construction, so each becomes an InitPlan.
create or replace function my_regions()
returns text[]
language sql stable security definer set search_path = public
as $$ select coalesce(scope_regions, '{}') from profiles where user_id = auth.uid() $$;

create or replace function my_categories()
returns text[]
language sql stable security definer set search_path = public
as $$ select coalesce(scope_categories, '{}') from profiles where user_id = auth.uid() $$;

-- Business table policies, rewritten. Semantics are identical to in_scope():
-- an empty scope array still means "all". Only the evaluation cost changes.
do $$
declare
  -- `= any((select f()))` reads the subquery as a SET OF ROWS, so it compares
  -- text against text[] and fails to plan. Array containment keeps the
  -- subquery scalar and uncorrelated, which is the whole point: one InitPlan
  -- per query rather than one function call per row.
  region_ok text := '(array_length((select my_regions()), 1) is null or (select my_regions()) @> array[region])';
  cat_ok    text := '(array_length((select my_categories()), 1) is null or (select my_categories()) @> array[category])';
  t record;
begin
  -- customers and orders carry region only; products carries category only;
  -- order_items carries both.
  for t in
    select * from (values
      -- The second column is the PERMISSION MODULE, which is not always the
      -- table name: order_items is governed by the `orders` module. Using the
      -- table name here made has_perm('order_items', ...) always false and hid
      -- every row from every user.
      ('customers', 'customers', region_ok),
      ('products',  'products',  cat_ok),
      ('orders',    'orders',    region_ok),
      ('order_items', 'orders', region_ok || ' and ' || cat_ok)
    ) as v(tbl, module, scope_expr)
  loop
    execute format('drop policy if exists %I on %I', t.tbl || '_read', t.tbl);
    execute format(
      'create policy %I on %I for select using (has_perm(%L, %L) and %s)',
      t.tbl || '_read', t.tbl, t.module, 'read', t.scope_expr
    );

    execute format('drop policy if exists %I on %I', t.tbl || '_create', t.tbl);
    execute format(
      'create policy %I on %I for insert with check (has_perm(%L, %L) and %s)',
      t.tbl || '_create', t.tbl, t.module, 'create', t.scope_expr
    );

    execute format('drop policy if exists %I on %I', t.tbl || '_update', t.tbl);
    execute format(
      'create policy %I on %I for update using (has_perm(%L, %L) and %s) with check (%s)',
      t.tbl || '_update', t.tbl, t.module, 'update', t.scope_expr, t.scope_expr
    );

    execute format('drop policy if exists %I on %I', t.tbl || '_delete', t.tbl);
    execute format(
      'create policy %I on %I for delete using (has_perm(%L, %L) and %s)',
      t.tbl || '_delete', t.tbl, t.module, 'delete', t.scope_expr
    );
  end loop;
end $$;

-- compute_insights() is deliberately left alone. It is SECURITY INVOKER and
-- reads order_items through the policies rewritten above, so it inherits the
-- same speedup without being restructured — and keeping it inside RLS means
-- its scoping stays enforced by the same wall as everything else.

-- Rate limiting did a SELECT then an UPDATE — two round trips on the hot path
-- of every request, from a Netlify function that may be far from the database.
-- One atomic upsert replaces both, and the increment cannot race.
create or replace function bump_rate_limit(
  p_user uuid, p_type text, p_limit int, p_window_seconds int
)
returns table (allowed boolean, remaining int, retry_after int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_start timestamptz;
begin
  insert into rate_limits (user_id, type, window_start, count)
  values (p_user, p_type, now(), 1)
  on conflict (user_id, type) do update
    set count = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
          then now()
          else rate_limits.window_start
        end
  returning rate_limits.count, rate_limits.window_start into v_count, v_start;

  return query select
    v_count <= p_limit,
    greatest(0, p_limit - v_count),
    greatest(1, p_window_seconds - extract(epoch from (now() - v_start))::int);
end;
$$;

analyze order_items;
analyze orders;
analyze customers;
analyze products;
