-- SQL helpers for permission and scope checking
-- All stable and security definer to avoid RLS recursion

create or replace function current_role_key()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.key
  from profiles p
  join roles r on p.role_id = r.id
  where p.user_id = auth.uid()
$$;

create or replace function has_perm(module text, action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from role_permissions rp
    join permissions p on rp.permission_id = p.id
    join profiles prof on prof.role_id = rp.role_id
    where prof.user_id = auth.uid()
      and p.module = $1
      and p.action = $2
  )
$$;

create or replace function in_scope(region text, category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    (scope_regions is null or array_length(scope_regions, 1) is null or region = any(scope_regions))
    and
    (scope_categories is null or array_length(scope_categories, 1) is null or category = any(scope_categories))
  )
  from profiles
  where user_id = auth.uid()
$$;

-- Enable RLS on all tables

alter table customers enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table profiles enable row level security;
alter table idempotency_keys enable row level security;
alter table rate_limits enable row level security;
alter table audit_log enable row level security;
alter table settings enable row level security;

-- Business tables: customers
drop policy if exists "customers_read" on customers;
create policy "customers_read" on customers
  for select using (has_perm('customers', 'read'));

drop policy if exists "customers_create" on customers
  for insert with check (has_perm('customers', 'create'));

drop policy if exists "customers_update" on customers
  for update using (has_perm('customers', 'update')) with check (has_perm('customers', 'update'));

drop policy if exists "customers_delete" on customers
  for delete using (has_perm('customers', 'delete'));

-- Business tables: products
drop policy if exists "products_read" on products
  for select using (has_perm('products', 'read'));

drop policy if exists "products_create" on products
  for insert with check (has_perm('products', 'create'));

drop policy if exists "products_update" on products
  for update using (has_perm('products', 'update')) with check (has_perm('products', 'update'));

drop policy if exists "products_delete" on products
  for delete using (has_perm('products', 'delete'));

-- Business tables: orders
drop policy if exists "orders_read" on orders
  for select using (has_perm('orders', 'read'));

drop policy if exists "orders_create" on orders
  for insert with check (has_perm('orders', 'create'));

drop policy if exists "orders_update" on orders
  for update using (has_perm('orders', 'update') and in_scope(region, null)) with check (has_perm('orders', 'update') and in_scope(region, null));

drop policy if exists "orders_delete" on orders
  for delete using (has_perm('orders', 'delete') and in_scope(region, null));

-- Business tables: order_items (denormalized region + category for scope)
drop policy if exists "order_items_read" on order_items
  for select using (has_perm('orders', 'read') and in_scope(region, category));

drop policy if exists "order_items_create" on order_items
  for insert with check (has_perm('orders', 'create') and in_scope(region, category));

drop policy if exists "order_items_update" on order_items
  for update using (has_perm('orders', 'update') and in_scope(region, category)) with check (has_perm('orders', 'update') and in_scope(region, category));

drop policy if exists "order_items_delete" on order_items
  for delete using (has_perm('orders', 'delete') and in_scope(region, category));

-- Platform tables: roles (only admins can see/edit)
drop policy if exists "roles_read" on roles
  for select using (has_perm('roles', 'read'));

drop policy if exists "roles_update" on roles
  for update using (has_perm('roles', 'update')) with check (has_perm('roles', 'update'));

-- Platform tables: permissions (read-only, gated)
drop policy if exists "permissions_read" on permissions
  for select using (has_perm('roles', 'read'));

-- Platform tables: role_permissions
drop policy if exists "role_permissions_read" on role_permissions
  for select using (has_perm('roles', 'read'));

drop policy if exists "role_permissions_update" on role_permissions
  for update using (has_perm('roles', 'update')) with check (has_perm('roles', 'update'));

-- Note: role_permissions inserts/deletes are done via admin operations, not direct user queries
-- But for completeness, guard them too
drop policy if exists "role_permissions_delete" on role_permissions
  for delete using (has_perm('roles', 'update'));

-- Platform tables: profiles (users can see/edit their own and admins can see/edit all)
drop policy if exists "profiles_read" on profiles
  for select using (has_perm('users', 'read') or user_id = auth.uid());

drop policy if exists "profiles_update" on profiles
  for update using (has_perm('users', 'update')) with check (has_perm('users', 'update'));

-- Platform tables: idempotency_keys (users can only see their own)
drop policy if exists "idempotency_keys_select" on idempotency_keys
  for select using (user_id = auth.uid() or has_perm('users', 'read'));

drop policy if exists "idempotency_keys_insert" on idempotency_keys
  for insert with check (user_id = auth.uid());

-- Platform tables: rate_limits (users can only see their own)
drop policy if exists "rate_limits_select" on rate_limits
  for select using (user_id = auth.uid() or has_perm('users', 'read'));

drop policy if exists "rate_limits_update" on rate_limits
  for update using (user_id = auth.uid() or has_perm('users', 'update')) with check (user_id = auth.uid() or has_perm('users', 'update'));

drop policy if exists "rate_limits_insert" on rate_limits
  for insert with check (user_id = auth.uid() or has_perm('users', 'update'));

-- Platform tables: audit_log (only admins can read)
drop policy if exists "audit_log_read" on audit_log
  for select using (has_perm('audit', 'read'));

-- Platform tables: settings (users can see org, everyone can see their own user settings)
drop policy if exists "settings_read" on settings
  for select using (
    has_perm('settings', 'read') and (
      scope = 'org' or
      scope::uuid = auth.uid()
    )
  );

drop policy if exists "settings_update" on settings
  for update using (
    has_perm('settings', 'update') and (
      scope = 'org' or
      scope::uuid = auth.uid()
    )
  ) with check (
    has_perm('settings', 'update') and (
      scope = 'org' or
      scope::uuid = auth.uid()
    )
  );
