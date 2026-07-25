-- get_scope_options() measured at 1.12s, which made it the single slowest thing
-- left on every list page — slower than the list query it accompanies.
--
-- It is SECURITY INVOKER, so its two `select distinct` scans of order_items run
-- through RLS: two full policy-evaluated passes over the whole table to return
-- four region names and three category names.
--
-- The function's whole purpose is to report every value that EXISTS in the
-- dataset (the Users screen offers them when assigning a scope, and list pages
-- use them as the "no scope = all" fallback), so reading it through the
-- caller's own scope was wrong as well as slow: a scoped user's dropdown could
-- never have offered anything outside their scope anyway, and the admin screen
-- needs the full list.
--
-- It exposes no figures — only the distinct labels — so SECURITY DEFINER here
-- widens nothing that the Regions/Categories filter did not already show.
create or replace function get_scope_options()
returns table (regions text[], categories text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    array(select distinct region from order_items where region is not null order by region),
    array(select distinct category from order_items where category is not null order by category);
$$;
