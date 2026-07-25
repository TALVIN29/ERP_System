# ERP MVP — Implementation Plan

## Context

Greenfield build. `E:\Full_Stack\Assignment` holds only `Idea.txt`; the target repo
`github.com/TALVIN29/ERP_System` is empty. Goal is an MVP ERP dashboard that proves
full-stack skill in one working day: authentication, an admin-editable role/permission
matrix with row-level scoping, CRUD gated by those permissions, a BI layer that surfaces
a genuine business insight, a spam-proof API, and a landing page with a FOMO CTA.

The referenced repo `thebingoai/thebingoai` was reviewed: it is a BI platform
(FastAPI + Nuxt + Qdrant + Celery + LangGraph), not an ERP, and its architecture does
not transfer to a Supabase/Netlify stack. It is a reference for the *insight* layer only.

Limitations of typical open-source ERPs (Odoo, ERPNext, Dolibarr) this build answers:
- Dashboards report numbers but do not tell you what to *do* — we ship an insight engine
  that emits findings with recommended actions.
- Permissions are configured in dense back-office screens — we ship a visual matrix grid.
- Onboarding takes days — we target first-glance comprehension.
- Double-submit and refresh-resubmit create duplicate records — we ship real idempotency.

Constraints agreed with the user: zero paid services, no LLM API keys, Supabase free tier,
Netlify deploy, MVP demoable tomorrow.

## Decisions locked

| Area | Decision |
|---|---|
| Dataset | Kaggle **Superstore** (9,994 rows, 21 cols, ~2 MB) |
| Frontend | React + Vite SPA, React Router, Tailwind v4 over CSS custom-property tokens |
| Backend | Netlify Functions — the only write path; frontend holds no service key |
| DB | Supabase Postgres + RLS as second wall |
| Auth | Email + password, confirmation **ON**; 6 demo users pre-seeded as confirmed |
| Roles | Admin, Manager, Analyst, Viewer, Finance, Warehouse |
| Scoping | Row-level by **Region + Category** |
| Theme | Light + dark, both first-class, toggle persisted per user |
| AI/BI | Rule-based SQL insight engine + model-ready export endpoint. No API keys, $0 |
| Charts | Chart.js standard, D3 showpiece, GSAP scroll/landing, anime.js counters |

### Known risk
Supabase free tier sends ~2 confirmation emails/hour. Live signup during a demo will hit
that wall. Mitigation is built in: seed 6 demo users directly with `email_confirmed_at`
pre-set and a role-switcher on the login screen. The real signup flow still exists and
still works — the demo just never depends on it.

---

## Architecture

```
Browser (React SPA, Vite)
   |  supabase-js  -- auth only (session / JWT)
   |  fetch + Authorization: Bearer <jwt>
   v
Netlify Functions  -- the API
   verify JWT -> rate limit -> idempotency -> permission -> scope -> execute -> audit
   |  supabase-js created with the USER's JWT, so RLS applies as a second wall
   v
Supabase Postgres -- tables + RLS policies + SQL insight views
```

Reads and writes both route through Functions. The browser touches Supabase only for the
auth session. `SUPABASE_SERVICE_ROLE_KEY` lives in Netlify env vars and never ships to the
client.

---

## Repo layout

```
ERP_System/
  index.html
  netlify.toml
  vite.config.js
  package.json
  .env.example
  supabase/
    01_schema.sql          business + platform tables
    02_rls.sql             helper functions + policies
    03_insights.sql        views + insight rules
    04_seed.sql            roles, permissions, demo users, scopes
  scripts/
    prepare_superstore.mjs CSV -> 4 normalized CSVs for dashboard import
  netlify/functions/
    _lib/                  guard.js, idempotency.js, ratelimit.js, audit.js, supa.js
    orders.js  products.js  customers.js
    insights.js  export.js  metrics.js
    admin-roles.js  admin-users.js  audit-log.js  settings.js
  src/
    main.jsx  App.jsx  styles/tokens.css
    lib/      api.js  auth.js  perms.js
    components/  charts/  layout/  ui/
    pages/    Landing.jsx Login.jsx Signup.jsx
              Dashboard.jsx Insights.jsx
              Orders.jsx Products.jsx Customers.jsx
              admin/Roles.jsx admin/Users.jsx admin/Audit.jsx
              Settings.jsx
```

---

## Data model

### Business tables (normalized from the Superstore CSV)

- `customers` — `customer_id` PK, name, segment, country, city, state, postal_code, **region**
- `products` — `product_id` PK, **category**, sub_category, name
- `orders` — `order_id` PK, `customer_id` FK, order_date, ship_date, ship_mode, **region**,
  generated column `ship_lag_days = ship_date - order_date`
- `order_items` — id PK, `order_id` FK, `product_id` FK, sales, quantity, discount, profit,
  denormalized `region` + `category` so scope filters stay index-only

### Platform tables

- `roles` — id, key, name, is_system
- `permissions` — id, module, action  (modules: orders, products, customers, insights,
  users, roles, audit, settings × actions: read, create, update, delete, export)
- `role_permissions` — role_id, permission_id  ← **the matrix the admin edits**
- `profiles` — user_id PK → `auth.users`, full_name, role_id, `scope_regions text[]`,
  `scope_categories text[]`
- `idempotency_keys` — key PK, user_id, endpoint, body_hash, response jsonb, status, created_at
- `rate_limits` — user_id, window_start, count
- `audit_log` — id, user_id, action, entity, entity_id, before jsonb, after jsonb, at
- `settings` — scope ('org' | user_id), key, value jsonb

### SQL helpers (written once, used by both RLS and Function guards)

- `current_role_key()`
- `has_perm(module text, action text) returns boolean`
- `in_scope(region text, category text) returns boolean`
  — empty scope array means "all", so Admin/Analyst need no special-casing

RLS enabled on every table. Business tables: `USING (has_perm('orders','read') AND
in_scope(region, category))`, mutations gated on the matching action.

---

## API contract (Netlify Functions)

Every mutating request must send `Idempotency-Key`. Middleware chain in `_lib/guard.js`:

1. **Verify JWT** — missing/invalid → `401`
2. **Rate limit** — Postgres token bucket, 60 req/min read, 20/min write →
   `429` + `Retry-After`
3. **Idempotency** — same key + same body hash → replay the stored response with
   `Idempotency-Replayed: true`; same key + *different* body → `409`
4. **Content dedup** — hash of `(user, endpoint, body)` inside a 10s window → collapse to
   the first result
5. **Permission + scope** — `has_perm` / `in_scope` → `403`
6. **Execute** as the user (their JWT, RLS active), store the response against the key,
   write an `audit_log` row

Endpoints:

| Method | Path | Notes |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/orders` | scoped list + CRUD |
| GET/POST/PATCH/DELETE | `/api/products`, `/api/customers` | same shape |
| GET | `/api/metrics` | dashboard aggregates from SQL views |
| GET | `/api/insights` | rule engine output |
| GET | `/api/export?dataset=` | flat, model-ready JSON |
| GET/PUT | `/api/admin-roles` | read + save the permission matrix |
| GET/PATCH | `/api/admin-users` | assign role, set region/category scopes |
| GET | `/api/audit-log` | paginated |
| GET/PUT | `/api/settings` | org + per-user |

---

## Insight engine — rule-based, zero cost

SQL views in `03_insights.sql`. Each rule emits
`{severity, title, finding, metric, delta, action, evidence}`:

1. **Discount break-even** — profit by discount bucket; find the point profit crosses zero.
   *"Above 20% discount every order loses money — 1,148 orders crossed it."*
2. **Margin leak by sub-category** — high sales, negative profit. *"Tables: $206k sales, −$17.7k profit."*
3. **Ship-lag outliers** — `ship_lag_days` vs the mode's own median, flag the tail
4. **Revenue concentration** — top 5% of customers as a share of revenue
5. **Loss-making SKUs** — negative-profit products, ranked by absolute loss
6. **Region trend break** — region below its own trailing 3-month trend

Rule 1 rendered as a **D3 profit-vs-discount scatter with a break-even curve** is the
showpiece chart.

---

## UI

Routes: `/` landing · `/login` · `/signup` · `/app/dashboard` · `/app/insights` ·
`/app/orders` · `/app/products` · `/app/customers` · `/app/admin/roles` ·
`/app/admin/users` · `/app/admin/audit` · `/app/settings`

- Nav items and row action buttons render from the permission set returned at login —
  a user never sees a control they cannot use.
- **Permission matrix**: modules down, actions across, checkbox grid, dirty-state save,
  anime.js pulse on toggle.
- **Dashboard**: 4 KPI tiles (anime.js count-up), sales trend line, category profit bar,
  region donut, the D3 break-even scatter.
- **Landing**: real Unsplash logistics/warehouse photos, GSAP scroll parallax, FOMO CTA
  (live-counting stat tiles, scarcity band, social proof), CTA into signup.
- Theme: `data-theme` on `<html>`, CSS custom-property tokens, persisted via settings.

---

## Build order

Strict. Whatever the clock kills, dies from the bottom.

**P0 — demo cannot exist without these**
1. Scaffold Vite + React + Tailwind + Router; `netlify.toml`; push to the repo
2. Supabase project; run `01_schema.sql`
3. `scripts/prepare_superstore.mjs` → import 4 CSVs via the Supabase dashboard
4. `02_rls.sql` + `04_seed.sql` — roles, permissions, 6 confirmed demo users, scopes
5. `_lib/guard.js` — JWT, rate limit, idempotency, dedup, permission, scope, audit
6. Auth pages + session context + `perms.js`
7. `/api/metrics` + Dashboard: 4 KPIs, 3 Chart.js charts
8. `/api/orders` + Orders CRUD table

**P1**
9. `/api/admin-roles` + permission matrix UI
10. Region/Category scoping applied end to end; `/api/admin-users` scope editor
11. `/api/insights` + Insights feed

**P2**
12. Landing page — photos, GSAP, FOMO CTA
13. Theme toggle + Settings page

**P3**
14. Audit log viewer
15. Products + Customers CRUD
16. D3 break-even scatter
17. `/api/export`

---

## Verification

Run each check and record the actual output — no claim of "done" without it.

**Local**
- `netlify dev` serves the SPA and Functions on one origin
- `npm run build` completes with no errors

**Auth + RBAC**
- Log in as each of the 6 demo users; screenshot the nav — Viewer sees no Create button,
  Warehouse sees no Finance module
- As East Manager, `/app/orders` returns only East rows; `SELECT count(*)` in Supabase SQL
  editor confirms the number matches the scoped total, not the global one
- Admin unchecks `orders.delete` for Manager → Manager's delete button disappears on
  reload and a direct `DELETE /api/orders/:id` returns `403`

**Idempotency / anti-spam** (curl, one command each)
- Same `Idempotency-Key` + same body twice → one row created, second response carries
  `Idempotency-Replayed: true`
- Same key + different body → `409`
- 25 writes inside a minute → `429` with `Retry-After`
- Double-click Create in the UI → exactly one row in `orders`

**BI**
- `/api/insights` returns ≥ 4 findings; cross-check the discount break-even number against
  a hand-written SQL query in the Supabase editor
- `/api/export?dataset=orders` returns valid JSON, `jq` parses it

**Deploy**
- Netlify build green, env vars set, live URL loads the landing page
- Log in on the deployed site and load the dashboard
- Confirm the client bundle contains no service-role key: search the built JS for
  `service_role`

---

## Deliberate cuts

- No LLM narrative layer — no API key, no spend. `/api/export` covers "integrate to AI dev".
- No trained predictive model — rule thresholds are derived from the data itself.
- No multi-tenant, no i18n, no offline, no realtime subscriptions.
- Superstore over DataCo — 2 MB imports in minutes; DataCo's cleaning cost does not fit
  one day. Schema is written so DataCo can be swapped in later.
