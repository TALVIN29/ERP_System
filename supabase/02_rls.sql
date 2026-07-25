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

-- Every signed-in user has to read their OWN role and grants to build the nav,
-- long before anyone checks whether they may read the roles module. Without
-- this the login succeeds and the permission set comes back empty, so the user
-- lands on an app with no navigation at all.
create or replace function current_role_id()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select role_id from profiles where user_id = auth.uid()
$$;

-- A NULL argument means "this axis does not apply, skip it" -- do not rely on
-- three-valued logic here. Previously `category is null` alone made the whole
-- AND clause NULL (not true) whenever scope_categories was non-empty, which
-- silently denied every row for scoped roles (e.g. Warehouse could never
-- update/delete any order because orders_update/delete pass category = null).
create or replace function in_scope(region text, category text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    (region is null or scope_regions is null or array_length(scope_regions, 1) is null or region = any(scope_regions))
    and
    (category is null or scope_categories is null or array_length(scope_categories, 1) is null or category = any(scope_categories))
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
-- content_dedup gets RLS with no policy at all: only the service client touches
-- it, and the service role bypasses RLS. No policy means no client can read it.
alter table content_dedup enable row level security;
alter table audit_log enable row level security;
alter table settings enable row level security;

-- Business tables: customers
drop policy if exists "customers_read" on customers;
create policy "customers_read" on customers
  for select using (has_perm('customers', 'read'));

drop policy if exists "customers_create" on customers;
create policy "customers_create" on customers
  for insert with check (has_perm('customers', 'create'));

drop policy if exists "customers_update" on customers;
create policy "customers_update" on customers
  for update using (has_perm('customers', 'update')) with check (has_perm('customers', 'update'));

drop policy if exists "customers_delete" on customers;
create policy "customers_delete" on customers
  for delete using (has_perm('customers', 'delete'));

-- Business tables: products
drop policy if exists "products_read" on products;
create policy "products_read" on products
  for select using (has_perm('products', 'read'));

drop policy if exists "products_create" on products;
create policy "products_create" on products
  for insert with check (has_perm('products', 'create'));

drop policy if exists "products_update" on products;
create policy "products_update" on products
  for update using (has_perm('products', 'update')) with check (has_perm('products', 'update'));

drop policy if exists "products_delete" on products;
create policy "products_delete" on products
  for delete using (has_perm('products', 'delete'));

-- Business tables: orders
-- read/create must scope by region too, or an East-scoped Manager can see
-- and insert rows for every region (category doesn't apply to orders, so
-- pass null for it -- in_scope() treats null as "axis skipped").
drop policy if exists "orders_read" on orders;
create policy "orders_read" on orders
  for select using (has_perm('orders', 'read') and in_scope(region, null));

drop policy if exists "orders_create" on orders;
create policy "orders_create" on orders
  for insert with check (has_perm('orders', 'create') and in_scope(region, null));

drop policy if exists "orders_update" on orders;
create policy "orders_update" on orders
  for update using (has_perm('orders', 'update') and in_scope(region, null)) with check (has_perm('orders', 'update') and in_scope(region, null));

drop policy if exists "orders_delete" on orders;
create policy "orders_delete" on orders
  for delete using (has_perm('orders', 'delete') and in_scope(region, null));

-- Business tables: order_items (denormalized region + category for scope)
drop policy if exists "order_items_read" on order_items;
create policy "order_items_read" on order_items
  for select using (has_perm('orders', 'read') and in_scope(region, category));

drop policy if exists "order_items_create" on order_items;
create policy "order_items_create" on order_items
  for insert with check (has_perm('orders', 'create') and in_scope(region, category));

drop policy if exists "order_items_update" on order_items;
create policy "order_items_update" on order_items
  for update using (has_perm('orders', 'update') and in_scope(region, category)) with check (has_perm('orders', 'update') and in_scope(region, category));

drop policy if exists "order_items_delete" on order_items;
create policy "order_items_delete" on order_items
  for delete using (has_perm('orders', 'delete') and in_scope(region, category));

-- Platform tables: roles (only admins can see/edit)
-- You can always see your own role; seeing everyone's needs roles.read.
drop policy if exists "roles_read" on roles;
create policy "roles_read" on roles
  for select using (id = current_role_id() or has_perm('roles', 'read'));

drop policy if exists "roles_update" on roles;
create policy "roles_update" on roles
  for update using (has_perm('roles', 'update')) with check (has_perm('roles', 'update'));

-- The permission catalogue is the app's vocabulary, not a secret: it is the
-- same 40 module/action pairs for everyone and is needed to join grants.
drop policy if exists "permissions_read" on permissions;
create policy "permissions_read" on permissions
  for select using (auth.uid() is not null);

-- Your own grants build your nav; everyone else's needs roles.read.
drop policy if exists "role_permissions_read" on role_permissions;
create policy "role_permissions_read" on role_permissions
  for select using (role_id = current_role_id() or has_perm('roles', 'read'));

drop policy if exists "role_permissions_update" on role_permissions;
create policy "role_permissions_update" on role_permissions
  for update using (has_perm('roles', 'update')) with check (has_perm('roles', 'update'));

-- Note: role_permissions inserts/deletes are done via admin operations, not direct user queries
-- But for completeness, guard them too
drop policy if exists "role_permissions_delete" on role_permissions;
create policy "role_permissions_delete" on role_permissions
  for delete using (has_perm('roles', 'update'));

-- Platform tables: profiles (users can see/edit their own and admins can see/edit all)
drop policy if exists "profiles_read" on profiles;
create policy "profiles_read" on profiles
  for select using (has_perm('users', 'read') or user_id = auth.uid());

drop policy if exists "profiles_update" on profiles;
create policy "profiles_update" on profiles
  for update using (has_perm('users', 'update')) with check (has_perm('users', 'update'));

-- Platform tables: idempotency_keys (users can only see their own)
drop policy if exists "idempotency_keys_select" on idempotency_keys;
create policy "idempotency_keys_select" on idempotency_keys
  for select using (user_id = auth.uid() or has_perm('users', 'read'));

drop policy if exists "idempotency_keys_insert" on idempotency_keys;
create policy "idempotency_keys_insert" on idempotency_keys
  for insert with check (user_id = auth.uid());

-- Platform tables: rate_limits (users can only see their own)
drop policy if exists "rate_limits_select" on rate_limits;
create policy "rate_limits_select" on rate_limits
  for select using (user_id = auth.uid() or has_perm('users', 'read'));

drop policy if exists "rate_limits_update" on rate_limits;
create policy "rate_limits_update" on rate_limits
  for update using (user_id = auth.uid() or has_perm('users', 'update')) with check (user_id = auth.uid() or has_perm('users', 'update'));

drop policy if exists "rate_limits_insert" on rate_limits;
create policy "rate_limits_insert" on rate_limits
  for insert with check (user_id = auth.uid() or has_perm('users', 'update'));

-- Platform tables: audit_log (only admins can read)
drop policy if exists "audit_log_read" on audit_log;
create policy "audit_log_read" on audit_log
  for select using (has_perm('audit', 'read'));

-- Platform tables: settings (users can see org, everyone can see their own user settings)
-- scope is text and holds either the literal 'org' or a uuid-as-text user id.
-- Postgres does not guarantee OR short-circuits, so `scope::uuid` must only be
-- reached when scope actually looks like a uuid, or an 'org' row throws
-- "invalid input syntax for type uuid".
drop policy if exists "settings_read" on settings;
create policy "settings_read" on settings
  for select using (
    has_perm('settings', 'read') and (
      scope = 'org' or
      (scope ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and scope::uuid = auth.uid())
    )
  );

drop policy if exists "settings_update" on settings;
create policy "settings_update" on settings
  for update using (
    has_perm('settings', 'update') and (
      scope = 'org' or
      (scope ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and scope::uuid = auth.uid())
    )
  ) with check (
    has_perm('settings', 'update') and (
      scope = 'org' or
      (scope ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and scope::uuid = auth.uid())
    )
  );
