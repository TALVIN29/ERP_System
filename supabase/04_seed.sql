-- Seed RBAC: permissions, roles, role_permissions
-- Also seed demo users and settings

-- crypt()/gen_salt() below need pgcrypto; not created anywhere else.
create extension if not exists pgcrypto;

-- Modules: orders, products, customers, insights, users, roles, audit, settings
-- Actions: read, create, update, delete, export

-- Insert 40 permissions (8 modules × 5 actions)
insert into permissions (module, action) values
  ('orders', 'read'), ('orders', 'create'), ('orders', 'update'), ('orders', 'delete'), ('orders', 'export'),
  ('products', 'read'), ('products', 'create'), ('products', 'update'), ('products', 'delete'), ('products', 'export'),
  ('customers', 'read'), ('customers', 'create'), ('customers', 'update'), ('customers', 'delete'), ('customers', 'export'),
  ('insights', 'read'), ('insights', 'create'), ('insights', 'update'), ('insights', 'delete'), ('insights', 'export'),
  ('users', 'read'), ('users', 'create'), ('users', 'update'), ('users', 'delete'), ('users', 'export'),
  ('roles', 'read'), ('roles', 'create'), ('roles', 'update'), ('roles', 'delete'), ('roles', 'export'),
  ('audit', 'read'), ('audit', 'create'), ('audit', 'update'), ('audit', 'delete'), ('audit', 'export'),
  ('settings', 'read'), ('settings', 'create'), ('settings', 'update'), ('settings', 'delete'), ('settings', 'export')
on conflict (module, action) do nothing;

-- Insert 6 roles
insert into roles (key, name, is_system) values
  ('admin', 'Admin', true),
  ('manager', 'Manager', true),
  ('analyst', 'Analyst', true),
  ('viewer', 'Viewer', true),
  ('finance', 'Finance', true),
  ('warehouse', 'Warehouse', true)
on conflict (key) do nothing;

-- Role permissions: map each role to its granted permissions per GRANTS in mock.js

-- Admin: all except audit.create, audit.update, audit.delete
-- That's 40 - 3 = 37 permissions
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.key = 'admin'
  and not (p.module = 'audit' and p.action in ('create', 'update', 'delete'))
on conflict do nothing;

-- Manager: 12 permissions
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.key = 'manager'
  and (
    (p.module = 'orders' and p.action in ('read', 'create', 'update', 'delete', 'export'))
    or (p.module = 'products' and p.action = 'read')
    or (p.module = 'customers' and p.action in ('read', 'create', 'update', 'delete'))
    or (p.module = 'insights' and p.action = 'read')
    or (p.module = 'settings' and p.action = 'read')
  )
on conflict do nothing;

-- Analyst: 7 permissions
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.key = 'analyst'
  and (
    (p.module = 'orders' and p.action in ('read', 'export'))
    or (p.module = 'products' and p.action = 'read')
    or (p.module = 'customers' and p.action = 'read')
    or (p.module = 'insights' and p.action in ('read', 'export'))
    or (p.module = 'settings' and p.action = 'read')
  )
on conflict do nothing;

-- Viewer: 4 permissions
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.key = 'viewer'
  and (
    (p.module = 'orders' and p.action = 'read')
    or (p.module = 'products' and p.action = 'read')
    or (p.module = 'insights' and p.action = 'read')
    or (p.module = 'settings' and p.action = 'read')
  )
on conflict do nothing;

-- Finance: 8 permissions
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.key = 'finance'
  and (
    (p.module = 'orders' and p.action in ('read', 'export'))
    or (p.module = 'products' and p.action = 'read')
    or (p.module = 'customers' and p.action = 'read')
    or (p.module = 'insights' and p.action in ('read', 'export'))
    or (p.module = 'audit' and p.action = 'read')
    or (p.module = 'settings' and p.action = 'read')
  )
on conflict do nothing;

-- Warehouse: 5 permissions
insert into role_permissions (role_id, permission_id)
select r.id, p.id from roles r, permissions p
where r.key = 'warehouse'
  and (
    (p.module = 'orders' and p.action in ('read', 'update'))
    or (p.module = 'products' and p.action in ('read', 'update'))
    or (p.module = 'settings' and p.action = 'read')
  )
on conflict do nothing;

-- Seed demo users in auth.users and profiles
-- Note: In a real Supabase setup, user creation goes through auth endpoints,
-- but for seeding we can insert directly with email_confirmed_at pre-set.
-- instance_id/aud/role are required by GoTrue for password login to find the
-- user at all, and an auth.identities row (provider='email') is required too --
-- without it GoTrue returns "Invalid login credentials" even though the
-- auth.users row exists.

-- Admin
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'authenticated',
  'authenticated',
  'admin@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'admin@superstore.demo',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'email', 'admin@superstore.demo'),
  'email',
  now(), now(), now()
) on conflict do nothing;

insert into profiles (user_id, full_name, role_id, scope_regions, scope_categories) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Talvin Lee',
  (select id from roles where key = 'admin'),
  array[]::text[],
  array[]::text[]
) on conflict do nothing;

-- Manager
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'authenticated',
  'authenticated',
  'manager@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  'manager@superstore.demo',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'email', 'manager@superstore.demo'),
  'email',
  now(), now(), now()
) on conflict do nothing;

insert into profiles (user_id, full_name, role_id, scope_regions, scope_categories) values (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'Dana Chen',
  (select id from roles where key = 'manager'),
  array['East']::text[],
  array[]::text[]
) on conflict do nothing;

-- Analyst
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  'authenticated',
  'authenticated',
  'analyst@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  'analyst@superstore.demo',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000000003', 'email', 'analyst@superstore.demo'),
  'email',
  now(), now(), now()
) on conflict do nothing;

insert into profiles (user_id, full_name, role_id, scope_regions, scope_categories) values (
  '00000000-0000-0000-0000-000000000003'::uuid,
  'Priya Raman',
  (select id from roles where key = 'analyst'),
  array[]::text[],
  array[]::text[]
) on conflict do nothing;

-- Viewer
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  'authenticated',
  'authenticated',
  'viewer@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  'viewer@superstore.demo',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000000004', 'email', 'viewer@superstore.demo'),
  'email',
  now(), now(), now()
) on conflict do nothing;

insert into profiles (user_id, full_name, role_id, scope_regions, scope_categories) values (
  '00000000-0000-0000-0000-000000000004'::uuid,
  'Jon Reyes',
  (select id from roles where key = 'viewer'),
  array['West']::text[],
  array[]::text[]
) on conflict do nothing;

-- Finance
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid,
  'authenticated',
  'authenticated',
  'finance@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000005'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid,
  'finance@superstore.demo',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000000005', 'email', 'finance@superstore.demo'),
  'email',
  now(), now(), now()
) on conflict do nothing;

insert into profiles (user_id, full_name, role_id, scope_regions, scope_categories) values (
  '00000000-0000-0000-0000-000000000005'::uuid,
  'Mei Tan',
  (select id from roles where key = 'finance'),
  array[]::text[],
  array[]::text[]
) on conflict do nothing;

-- Warehouse
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000006'::uuid,
  'authenticated',
  'authenticated',
  'warehouse@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000006'::uuid,
  '00000000-0000-0000-0000-000000000006'::uuid,
  'warehouse@superstore.demo',
  jsonb_build_object('sub', '00000000-0000-0000-0000-000000000006', 'email', 'warehouse@superstore.demo'),
  'email',
  now(), now(), now()
) on conflict do nothing;

insert into profiles (user_id, full_name, role_id, scope_regions, scope_categories) values (
  '00000000-0000-0000-0000-000000000006'::uuid,
  'Sam Ortiz',
  (select id from roles where key = 'warehouse'),
  array['Central']::text[],
  array['Furniture']::text[]
) on conflict do nothing;

-- GoTrue reads auth.users into Go structs whose token fields are plain strings,
-- not pointers. A NULL in any of them fails the scan and every login returns
-- "Database error querying schema" — the row looks fine in SQL and still cannot
-- authenticate. Inserting rows by hand is the only way to hit this, so it has
-- to be repaired by hand too.
--
-- The column set differs between GoTrue versions, so only touch what exists.
do $$
declare
  col text;
begin
  foreach col in array array[
    'confirmation_token', 'recovery_token', 'email_change', 'email_change_token_new',
    'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = col
    ) then
      execute format(
        'update auth.users set %I = %L where %I is null and email like %L',
        col, '', col, '%@superstore.demo'
      );
    end if;
  end loop;
end $$;

-- Seed default settings
insert into settings (scope, key, value) values
  ('org', 'org_name', '"Superstore Trading Co."'),
  ('org', 'currency', '"USD"'),
  ('org', 'fiscal_year_start', '"01-01"'),
  ('org', 'insight_discount_threshold', '0.20'),
  ('org', 'insight_min_loss', '1000')
on conflict do nothing;
