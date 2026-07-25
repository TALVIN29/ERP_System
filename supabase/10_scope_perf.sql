-- get_scope_options() measured at 1.12s, which made it the single slowest thing
-- left on every list page — slower than the list query it accompanies.
--
-- It is SECURITY INVOKER, so its two `select distinct` scans of order_items run
-- through RLS: two full policy-evaluated passes over the whole table to return
-- four region names and three category names.
--
-- Its purpose is to report every value that EXISTS in the dataset, which
-- _lib/scope.js uses as the "no scope means all" fallback. Nothing changes for
-- a scoped user: they get their profile's own regions either way. And nothing
-- changes for an unscoped one either, because RLS was already returning them
-- everything. Only the cost changes.
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
