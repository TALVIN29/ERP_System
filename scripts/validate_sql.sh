#!/usr/bin/env bash
# Validate the Supabase SQL against a throwaway Postgres before pasting it into
# a real project. Postgres checks a `language sql` function body at CREATE time,
# so this catches the nested-aggregate class of error locally instead of one
# round-trip at a time.
#
# Usage: bash scripts/validate_sql.sh
set -uo pipefail

CONTAINER=erp_sql_check
PORT=55432
PW=validate

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
echo "starting postgres..."
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PW" -p "$PORT:5432" postgres:16 >/dev/null

for i in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

run() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }

# Supabase gives us auth.users and auth.uid(); a bare Postgres does not. These
# stubs exist only so the real files can be parsed and planned unmodified.
echo "installing auth stubs..."
run -q <<'SQL'
create schema if not exists auth;
create extension if not exists pgcrypto;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud text,
  role text,
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- GoTrue scans these into non-nullable Go strings, so the seed has to leave
  -- them empty rather than null. Mirrored here so the harness exercises that.
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change_token_current text,
  email_change text,
  phone_change text,
  phone_change_token text,
  reauthentication_token text,
  last_sign_in_at timestamptz
);
create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text,
  user_id uuid references auth.users(id),
  identity_data jsonb,
  provider text,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);
-- Returns the first seeded user so scoped queries have someone to be.
create or replace function auth.uid() returns uuid
language sql stable as $$ select id from auth.users order by created_at limit 1 $$;
SQL

fail=0
for f in supabase/01_schema.sql supabase/02_rls.sql supabase/03_insights.sql supabase/04_seed.sql; do
  echo
  echo "=== $f ==="
  if run -q < "$f"; then
    echo "OK"
  else
    echo "FAILED: $f"
    fail=1
    break
  fi
done

if [ "$fail" -eq 0 ]; then
  echo
  echo "=== seeded counts ==="
  run -At -c "select 'roles', count(*) from roles union all
              select 'permissions', count(*) from permissions union all
              select 'role_permissions', count(*) from role_permissions union all
              select 'auth.users', count(*) from auth.users union all
              select 'auth.identities', count(*) from auth.identities union all
              select 'profiles', count(*) from profiles union all
              select 'settings', count(*) from settings;"

  echo
  echo "=== auth token columns must be '' not null (GoTrue cannot scan null) ==="
  run -At -c "select count(*) || ' demo users with a null token column (must be 0)'
              from auth.users
              where email like '%@superstore.demo'
                and (confirmation_token is null or recovery_token is null
                     or email_change is null or email_change_token_new is null
                     or email_change_token_current is null or phone_change is null
                     or phone_change_token is null or reauthentication_token is null);"

  echo
  echo "=== grants per role ==="
  run -At -c "select r.key, count(*) from roles r
              join role_permissions rp on rp.role_id = r.id
              group by r.key order by r.key;"

  # Creating the function only proves it parses and plans. Real rows are what
  # prove the rules fire and survive their own arithmetic.
  echo
  echo "=== generating sample business data ==="
  run -q <<'SQL' || fail=1
insert into customers (customer_id, name, segment, country, city, state, postal_code, region)
select 'CU-' || g, 'Customer ' || g, (array['Consumer','Corporate','Home Office'])[1 + g % 3],
       'United States', 'City ' || g, 'State ' || (g % 10), '10000',
       (array['East','West','Central','South'])[1 + g % 4]
from generate_series(1, 60) g on conflict do nothing;

insert into products (product_id, category, sub_category, name)
select 'PR-' || g,
       (array['Furniture','Office Supplies','Technology'])[1 + g % 3],
       (array['Tables','Chairs','Binders','Paper','Phones','Copiers'])[1 + g % 6],
       'Product ' || g
from generate_series(1, 60) g on conflict do nothing;

insert into orders (order_id, customer_id, order_date, ship_date, ship_mode, region)
select 'OD-' || g, 'CU-' || (1 + g % 60),
       (date '2024-01-01' + (g % 400)),
       (date '2024-01-01' + (g % 400) + (case when g % 7 = 0 then 11 else 2 + g % 4 end)),
       (array['Standard Class','Second Class','First Class','Same Day'])[1 + g % 4],
       (array['East','West','Central','South'])[1 + g % 4]
from generate_series(1, 600) g on conflict do nothing;

-- Margin erodes ~1.9pt per discount point, so profit crosses zero just above
-- 20% — the same relationship the fixture backend generates.
insert into order_items (order_id, product_id, sales, quantity, discount, profit, region, category)
select o.order_id, p.product_id,
       round((50 + (g % 700))::numeric, 2) as sales,
       1 + g % 8,
       d.discount,
       round(((50 + (g % 700)) * (0.26 - d.discount * 1.35))::numeric, 2) as profit,
       o.region, p.category
from generate_series(1, 600) g
join orders o on o.order_id = 'OD-' || g
join products p on p.product_id = 'PR-' || (1 + g % 60)
cross join lateral (select (array[0,0,0,0.1,0.2,0.2,0.3,0.4,0.5])[1 + g % 9]::numeric as discount) d;
SQL

  run -At -c "select 'order_items', count(*) from order_items union all select 'orders', count(*) from orders;"

  echo
  echo "=== compute_insights() with real rows ==="
  run -At -c "select jsonb_pretty(jsonb_agg(jsonb_build_object(
                'severity', f->>'severity',
                'title', f->>'title',
                'metrics', jsonb_array_length(f->'metrics'),
                'has_action', (f->>'action') is not null)))
              from jsonb_array_elements(compute_insights()) f;"

  echo
  echo "=== re-run idempotency: all four again ==="
  for f in supabase/01_schema.sql supabase/02_rls.sql supabase/03_insights.sql supabase/04_seed.sql; do
    run -q < "$f" >/dev/null 2>&1 && echo "  $f OK" || { echo "  $f FAILED ON RERUN"; fail=1; }
  done
fi

echo
[ "$fail" -eq 0 ] && echo "ALL GREEN" || echo "THERE ARE FAILURES ABOVE"
exit "$fail"
