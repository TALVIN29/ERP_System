# 00 — System Overview

Entry point for the ERP MVP documentation set. Read this first, then the module doc for
whatever you are building. Every module doc follows the same 10-section template, so once
you know one you know all of them.

Source of truth for architecture and build order stays `../PLAN.md`. Requirements origin
is `../Idea.txt`. Where these docs add detail `PLAN.md` did not specify, that detail is
marked **Decision:** so it is obvious what was invented here.

---

## 1. What this system is

An ERP dashboard MVP that lets management make data-driven decisions regardless of their
tier level. Six roles, each seeing a legitimately different slice of the same business
data, with an admin able to reshape who can do what from inside the website — no code
deploy, no database console.

The dataset is real: Kaggle **Superstore** (9,994 rows, 21 columns, ~2 MB), normalized
into four tables.

---

## 2. Architecture

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

Three facts that drive every module doc:

1. **Reads and writes both route through Netlify Functions.** The browser talks to
   Supabase for one thing only: the auth session. There is no direct table access from
   the client.
2. **`SUPABASE_SERVICE_ROLE_KEY` never ships to the client.** It lives in Netlify env
   vars. The client bundle is grepped for `service_role` as a release check.
3. **Two walls, not one.** The Function guard checks permission and scope in application
   code; Postgres RLS checks it again at the row level using the user's own JWT. A bug in
   the first wall does not leak data through the second.

---

## 3. Module index

| # | Doc | Module | Build priority | Route(s) |
|---|---|---|---|---|
| 01 | [Authentication](01-auth.md) | `auth` | P0 | `/login`, `/signup` |
| 02 | [Permissions & RBAC](02-permissions-rbac.md) | `roles` (engine) | P0 → P1 | — (cross-cutting) |
| 03 | [Admin](03-admin.md) | `roles`, `users` | P1 | `/app/admin/roles`, `/app/admin/users` |
| 04 | [Settings](04-settings.md) | `settings` | P2 | `/app/settings` |
| 05 | [Orders](05-orders.md) | `orders` | P0 | `/app/orders` |
| 06 | [Products & Customers](06-products-customers.md) | `products`, `customers` | P3 | `/app/products`, `/app/customers` |
| 07 | [Dashboard & Metrics](07-dashboard-metrics.md) | `insights` (read) | P0 | `/app/dashboard` |
| 08 | [Insights & BI](08-insights-bi.md) | `insights` | P1 → P3 | `/app/insights` |
| 09 | [Audit Log](09-audit-log.md) | `audit` | P3 | `/app/admin/audit` |
| 10 | [Landing](10-landing.md) | — (public) | P2 | `/` |
| 11 | [API, Idempotency & Anti-spam](11-api-idempotency.md) | — (platform) | P0 | — (all endpoints) |
| — | [UI Page Guide](UI-PAGE-GUIDE.md) | — | — | all routes |

Build order is strict — see `../PLAN.md` § Build order. Whatever the clock kills, dies
from the bottom (P3 first).

---

## 4. Roles at a glance

Six roles ship seeded. The matrix below is the **seed state** only — an Admin can change
any cell of it at runtime from `/app/admin/roles`, which is the whole point of the
permission module. Never hardcode this table into the UI; render from the permission set
the API returns.

| Role | Reads | Writes | Admin surfaces | Row scope (seed) |
|---|---|---|---|---|
| **Admin** | everything | everything | roles, users, audit, settings | none (= all rows) |
| **Manager** | orders, products, customers, insights | orders CRUD | — | one region |
| **Analyst** | orders, insights, export | — | — | none (= all rows) |
| **Viewer** | orders, dashboard | — | — | one region |
| **Finance** | orders, insights, export | orders update | — | all regions, all categories |
| **Warehouse** | orders, products | orders update (ship fields) | — | one region, subset of categories |

Empty scope array means **all** — so Admin and Analyst need no special-casing anywhere in
the code. See [02-permissions-rbac.md](02-permissions-rbac.md) § Scoping.

---

## 5. Permission grid shape

Permissions are `(module, action)` pairs:

- **Modules:** `orders`, `products`, `customers`, `insights`, `users`, `roles`, `audit`,
  `settings`
- **Actions:** `read`, `create`, `update`, `delete`, `export`

8 × 5 = 40 permission rows. `role_permissions` is the join table the admin edits — it is
literally the checkbox grid rendered as a database table.

---

## 6. What makes this different from off-the-shelf ERP

From `../Idea.txt`: *"Study the current internal ERP system and seek for their
limitation and make the enhancement."* Four limitations of typical open-source ERPs
(Odoo, ERPNext, Dolibarr), and the module that answers each:

| Limitation | Answer | Doc |
|---|---|---|
| Dashboards report numbers but never say what to *do* | Rule-based insight engine emitting findings **with a recommended action** | [08](08-insights-bi.md) |
| Permissions buried in dense back-office forms | Visual checkbox matrix, modules × actions, live dirty-state save | [02](02-permissions-rbac.md), [03](03-admin.md) |
| Onboarding takes days | Nav and buttons render only what you can use; nothing to learn to ignore | [UI guide](UI-PAGE-GUIDE.md) |
| Double-submit and refresh-resubmit create duplicate records | Real `Idempotency-Key` contract plus a content-dedup window | [11](11-api-idempotency.md) |

---

## 7. Glossary

- **Scope** — a user's row-level filter, held as two Postgres text arrays on their
  profile: `scope_regions` and `scope_categories`. An **empty array means no
  restriction**, not "no access". Enforced by the SQL function `in_scope(region,
  category)`.
- **Permission** — a `(module, action)` pair. A role holds a set of them via
  `role_permissions`. Checked by the SQL function `has_perm(module, action)`.
- **Idempotency key** — a client-generated UUID sent on every mutating request in the
  `Idempotency-Key` header. Lets the server recognise a retry of a request it already
  processed and replay the original response instead of doing the work twice.
- **Content dedup** — a shorter, key-less safety net: a hash of
  `(user, endpoint, body)` inside a 10-second window collapses to the first result.
  Catches the double-click that fires two requests with two different keys.
- **RLS (Row Level Security)** — Postgres policies that filter rows per connection based
  on the JWT. The second wall behind the Function guard.
- **Insight rule** — a SQL view that emits
  `{severity, title, finding, metric, delta, action, evidence}`. No LLM, no API key, no
  spend.
- **Guard** — `netlify/functions/_lib/guard.js`, the six-step middleware chain every
  endpoint runs before it touches data.

---

## 8. Doc template

Every `NN-*.md` in this folder has the same 10 sections, in this order:

1. Purpose
2. Why it exists / ERP limitation answered
3. Scope
4. Data touched
5. API surface
6. Permission gates
7. User experience flow
8. Edge cases
9. Acceptance checks
10. Depends on / blocks

If you are writing a new module doc, copy that skeleton.

---

## 9. Out of scope for the whole MVP

From `../PLAN.md` § Deliberate cuts, repeated here so nobody proposes them mid-build:

- No LLM narrative layer — no API key, no spend. `/api/export` is the "integrate to AI
  dev" answer.
- No trained predictive model — insight thresholds are derived from the data itself.
- No multi-tenancy, no i18n, no offline mode, no realtime subscriptions.
- Superstore over DataCo — the schema is written so DataCo can swap in later.
