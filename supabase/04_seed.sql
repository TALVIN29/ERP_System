-- Seed RBAC: permissions, roles, role_permissions
-- Also seed demo users and settings

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

-- Admin
insert into auth.users (
  id, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'admin@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
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
  id, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000002'::uuid,
  'manager@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
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
  id, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000003'::uuid,
  'analyst@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
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
  id, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000004'::uuid,
  'viewer@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
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
  id, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000005'::uuid,
  'finance@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
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
  id, email, email_confirmed_at, encrypted_password, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) values (
  '00000000-0000-0000-0000-000000000006'::uuid,
  'warehouse@superstore.demo',
  now(),
  crypt('demo1234', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb
) on conflict do nothing;

insert into profiles (user_id, full_name, role_id, scope_regions, scope_categories) values (
  '00000000-0000-0000-0000-000000000006'::uuid,
  'Sam Ortiz',
  (select id from roles where key = 'warehouse'),
  array['Central']::text[],
  array['Furniture']::text[]
) on conflict do nothing;

-- Seed default settings
insert into settings (scope, key, value) values
  ('org', 'org_name', '"Superstore Trading Co."'),
  ('org', 'currency', '"USD"'),
  ('org', 'fiscal_year_start', '"01-01"'),
  ('org', 'insight_discount_threshold', '0.20'),
  ('org', 'insight_min_loss', '1000')
on conflict do nothing;
