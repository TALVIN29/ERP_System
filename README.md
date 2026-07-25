# Superstore ERP

An ERP dashboard built to answer a question most ERPs dodge: *what should I do about
this number?* Every insight it surfaces carries a recommended action.

Live demo: _not deployed yet_ · Dataset: Kaggle Superstore · Stack: React + Vite +
Supabase + Netlify Functions

---

## What it does

- **Authentication** with six pre-seeded demo roles, switchable in two clicks on the login page
- **A permission matrix the admin edits from the browser** — modules down, actions across.
  Nav items and row controls render from the permission set returned at login, so a user
  never sees a control they cannot use
- **Row-level scoping by region and category** — a Manager scoped to East sees East orders,
  East totals, East insights. The scope chip in the topbar is always visible so a scoped
  total never reads as a bug
- **CRUD** on orders, products and customers, gated per row rather than per page
- **A rule-based insight engine** that derives findings from the data rather than asserting
  thresholds — including the break-even discount point, computed by bucketing profit by
  discount and finding where it crosses zero
- **An API that refuses to double-submit** — idempotency keys, content dedup, and rate
  limiting, all enforced server-side
- **An audit log** of every mutation, with a before/after diff

---

## Running it

```bash
npm install
npm run dev
```

That is enough. With no `.env`, the app runs against a local fixture backend
(`src/lib/mock.js`) that generates ~900 orders with a genuine discount-to-profit
relationship — so the whole UI, including the insight engine, is demoable before any
infrastructure exists.

To run against real Supabase, copy `.env.example` to `.env` and fill it in. The app
switches automatically.

### Demo accounts

All six use the password `demo1234`.

| Email | Role | Scope | Grants |
|---|---|---|---|
| `admin@superstore.demo` | Admin | all regions | 37 |
| `manager@superstore.demo` | Manager | East | 12 |
| `analyst@superstore.demo` | Analyst | all regions | 7 |
| `viewer@superstore.demo` | Viewer | West | 4 |
| `finance@superstore.demo` | Finance | all regions | 8 |
| `warehouse@superstore.demo` | Warehouse | Central, Furniture | 5 |

---

## Setting up Supabase

Run these in the SQL Editor **in order**. Each is idempotent and safe to re-run.

| File | What it does |
|---|---|
| `supabase/01_schema.sql` | 12 tables, indexes on the scope columns |
| `supabase/02_rls.sql` | Helper functions, RLS on every table, 32 policies |
| `supabase/03_insights.sql` | Six insight rules and `compute_insights()` |
| `supabase/04_seed.sql` | 40 permissions, 6 roles, 73 grants, 6 demo users, defaults |

Then set the Netlify environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

The service role key never reaches the browser. Only Netlify Functions hold it, and only
for idempotency, rate-limit and audit bookkeeping — every business read and write runs
through the user's own JWT so RLS applies as a second wall.

### Loading the dataset

Requires the **full** Kaggle Superstore export — the 21-column
`Sample - Superstore.csv` with `Order ID`, `Order Date`, `Ship Date`, `Customer ID`,
`Customer Name`, `Product ID` and `Product Name`. A trimmed 13-column variant also
circulates; it cannot populate this schema, which is normalized into customers,
products, orders and order items.

```bash
# place the file at data/Superstore.csv
npm run prepare-data
```

That writes four normalized CSVs to `data/out/`, ready to import through the Supabase
Table Editor in this order: `customers`, `products`, `orders`, `order_items`.

---

## Architecture

```
Browser (React SPA)
   |  supabase-js — auth only (session / JWT)
   |  fetch + Authorization: Bearer <jwt>
   v
Netlify Functions — the API
   verify JWT -> rate limit -> idempotency -> dedup -> permission -> execute -> audit
   |  supabase-js created with the USER's JWT, so RLS applies as a second wall
   v
Supabase Postgres — tables + RLS policies + SQL insight rules
```

Reads and writes both route through Functions. The browser touches Supabase directly only
for the auth session.

### The guard chain

Every request passes through `netlify/functions/_lib/guard.js` in this order. No endpoint
reimplements a step.

1. **Verify JWT** via `auth.getUser` — a real signature check, not a base64 decode → `401`
2. **Rate limit** — Postgres token bucket, compare-and-swap so concurrent requests cannot
   both pass the same budget → `429` + `Retry-After`
3. **Idempotency** — the key row is inserted *before* the handler runs, so two concurrent
   identical requests collapse into one execution. Same key + same body replays the stored
   response; same key + different body → `409`
4. **Content dedup** — a 10-second window on `hash(user, endpoint, body)`, catching the
   accidental double-submit that carried no key
5. **Permission + scope** — role and grants re-read from the database for the JWT's user,
   never taken from the request → `403`
6. **Execute, store, audit** — as one step, so an audit row cannot be forgotten

The client generates its `Idempotency-Key` when a form *opens*, not when submit is
clicked. A key generated at submit time is a new key per click, and two clicks produce two
records.

---

## Design decisions worth defending

**Controls are absent, not disabled.** A disabled button is an invitation to ask why. The
two exceptions are the permission matrix and the organisation settings in read-only mode,
where seeing the values is the entire point.

**Empty states name their cause.** "No orders yet", "No orders match these filters" and
"No orders in your assigned region (East)" are three different problems with three
different fixes, so they are three different messages.

**Drawers, not modals**, for create and edit — the list stays visible behind them, which
matters when copying details from an existing row. Modals are reserved for destructive
confirms, and those name the object and the consequence rather than asking "Are you sure?".

**No optimistic updates.** Show pending, wait for the server, render the server's row.

**Dark mode is selected, not inverted.** Each chart series has its own dark step. Chart.js
and the D3 canvas re-read the CSS custom properties on theme change, because a canvas has
no cascade.

**Insights derive their thresholds.** The break-even discount is found by bucketing profit
by discount and taking the first bucket that crosses zero — not read from a config value
and asserted.

---

## Verification

Run the SQL against a throwaway Postgres before touching a real project:

```bash
bash scripts/validate_sql.sh    # needs Docker
```

It runs all four files, re-runs them to prove idempotency, seeds sample rows, checks the
grant counts per role, asserts `compute_insights()` actually produces findings, and —
importantly — exercises the RLS policies through a **non-superuser** role. psql connects
as a superuser by default, which bypasses RLS entirely and makes every policy look fine.

The API's pure logic has its own check:

```bash
node netlify/functions/_lib/selfcheck.mjs
```

Verified against a live Supabase project: all six demo users authenticate, each reads its
own role and exactly its own grant count (37/12/7/4/8/5), and scope values load correctly.

---

## Known gaps

- **No runtime UI verification.** The build compiles and the code has been reviewed, but
  the pages have not been driven in a browser end to end.
- **Scope correctness is proven for reads of roles and grants, not for business rows** —
  the business tables are still empty pending the dataset.
- **Page-level scope chips** on Orders, Products and Customers list every value when the
  user is unscoped, instead of reading "All regions". The topbar chip is correct.
- **No LLM layer.** `/api/export` returns model-ready JSON instead; the Insights export
  menu includes a pandas snippet that consumes it.

---

## Layout

```
supabase/          01_schema · 02_rls · 03_insights · 04_seed
netlify/functions/ _lib/ (guard, idempotency, ratelimit, audit, supa) + 14 endpoints
scripts/           prepare_superstore.mjs · validate_sql.sh
src/
  lib/             api · auth · perms · mock (fixture backend) · useApi
  layout/          AppShell · RouteGuard
  components/      ui · crud · admin · insights · landing
  charts/          useChart · SalesTrendLine · CategoryProfitBar · RegionDonut · DiscountScatter
  pages/           Landing · Login · Signup · Dashboard · Insights · Orders · Products ·
                   Customers · Settings · admin/{Roles,Users,Audit}
docs/              module-by-module specs and the page-by-page UI guide
```
