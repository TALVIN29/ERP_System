# 05 — Orders

The reference CRUD module. Products and Customers are documented in
[06-products-customers.md](06-products-customers.md) as a delta against this file, so
whatever is decided here propagates. Get this one right.

## 1. Purpose

The transactional core: a scoped, filterable, paginated table of orders with create, edit
and delete, each gated by permission *and* row scope, each write protected by idempotency.
It is where `../Idea.txt`'s *"User be able to perform CRUD from the frontend according to
the role and permission"* becomes something you can click.

It is also where the anti-spam requirement gets its most visible test: double-clicking
**Create** must produce exactly one row.

---

## 2. Why it exists / ERP limitation answered

Three limitations, all of them things people actually hit:

- **Duplicate records from double-submit and refresh-resubmit.** Every ERP has a support
  process for merging accidental duplicates, which is an admission the system allows them.
  Here the write path carries a real `Idempotency-Key` contract plus a content-dedup
  window ([11](11-api-idempotency.md)), so the duplicate is never created in the first
  place.
- **Grids that show everything to everyone and then hide the buttons.** Row scoping is
  applied in the query, not in the render, so an East Manager's export, count, and page
  total all agree with what they can see. Systems that filter only at the presentation
  layer produce totals that do not match the visible rows — and users notice.
- **Onboarding cost.** No modal-in-modal, no ten-tab record form. One table, one drawer,
  clear column names taken from the business vocabulary rather than the schema.

---

## 3. Scope

**In scope**

- Scoped list: pagination, sort, search, region/category/date filters
- Create, edit, delete a single order
- Order detail with its line items
- Idempotent writes, optimistic-free UI (see § 7.6)
- Permission-gated controls and row-level scope enforcement
- Every mutation audited

**Out of scope**

- Editing `order_items` individually — **Decision:** the MVP creates an order with its
  lines in one payload and edits order-level fields only. Per-line editing is a second
  table, a second set of idempotency concerns, and a second permission surface for very
  little demo value.
- Bulk actions (multi-select delete, bulk edit, CSV upload)
- Order lifecycle / status workflow, approvals, returns
- Inventory decrement, pricing rules, tax, invoicing, shipping integration
- Soft delete and restore — **Decision:** delete is hard, but `audit_log` retains the full
  `before` JSON, so a deletion is reconstructable. That is the cheap version of a recycle
  bin.

---

## 4. Data touched

| Table | Columns | Scope-filtered |
|---|---|---|
| `orders` | `order_id` PK, `customer_id` FK, `order_date`, `ship_date`, `ship_mode`, **`region`**, generated `ship_lag_days = ship_date - order_date` | yes, by `region` |
| `order_items` | `id` PK, `order_id` FK, `product_id` FK, `sales`, `quantity`, `discount`, `profit`, denormalized **`region`** + **`category`** | yes, by both axes |
| `customers` | read-only join for the customer name | inherits |
| `products` | read-only join for the product name | inherits |
| `audit_log` | write, one row per mutation | — |

`order_items` carries denormalized `region` and `category` precisely so `in_scope()` never
needs a join to evaluate. Any write to `order_items` must populate both from the parent
order's region and the product's category — a null there makes the row invisible to
scoped users and visible to nobody, which is a nasty silent bug.

`ship_lag_days` is a generated column. Never write it; it feeds the ship-lag insight rule
in [08](08-insights-bi.md).

---

## 5. API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/orders` | scoped, filtered, paginated list |
| `GET` | `/api/orders?id=…` | one order with its line items |
| `POST` | `/api/orders` | create — **requires `Idempotency-Key`** |
| `PATCH` | `/api/orders` | update order-level fields — **requires `Idempotency-Key`** |
| `DELETE` | `/api/orders` | delete order and its lines — **requires `Idempotency-Key`** |

### `GET /api/orders`

Query params: `page` (default 1), `page_size` (default from settings, max 100), `sort`
(e.g. `-order_date`), `q` (matches order id and customer name), `region`, `category`,
`date_from`, `date_to`.

```json
{
  "rows": [{
    "order_id": "CA-2017-152156",
    "order_date": "2017-11-08",
    "ship_date": "2017-11-11",
    "ship_lag_days": 3,
    "ship_mode": "Second Class",
    "region": "South",
    "customer": { "customer_id": "CG-12520", "name": "Claire Gute" },
    "line_count": 2,
    "sales": 993.66,
    "profit": 219.58
  }],
  "page": 1, "page_size": 25, "total": 2847,
  "scope": { "regions": ["East"], "categories": [] }
}
```

`total` is the **scoped** total. Echoing `scope` back lets the UI render its scope chip
from server truth rather than a client-side assumption.

Filters narrow within scope; they never widen it. A scoped user passing `region=West`
gets an empty list, not a `403` — **Decision:** a filter producing no results is an empty
state, not an error, and treating it as an error makes filter UIs infuriating.

### `POST /api/orders`

```json
{
  "customer_id": "CG-12520",
  "order_date": "2024-03-14",
  "ship_date": "2024-03-17",
  "ship_mode": "Second Class",
  "region": "East",
  "items": [{ "product_id": "FUR-BO-10001798", "quantity": 2, "discount": 0.1, "sales": 261.96, "profit": 41.91 }]
}
```

Server derives each line's `region` from the order and `category` from the product. Returns
the created order in the same shape as the detail `GET`.

### Status codes

| Code | When |
|---|---|
| `200` / `201` | success |
| `400` | validation failure — ship date before order date, empty `items`, negative quantity |
| `401` | no valid JWT |
| `403` | missing permission, or the target row is outside the caller's scope |
| `409` | same `Idempotency-Key` with a different body |
| `422` | referential failure — unknown `customer_id` or `product_id` |
| `428` | **Decision:** mutating request sent with no `Idempotency-Key`. Literally "Precondition Required"; fails loudly during development instead of letting an unprotected write path ship |
| `429` | rate limited — `Retry-After` set |

Replayed requests return the original status with `Idempotency-Replayed: true`.

---

## 6. Permission gates

| Control | Requires | Also requires |
|---|---|---|
| Nav item, list, detail | `orders.read` | row in scope |
| **New order** button | `orders.create` | new row's region in scope |
| Row **Edit** | `orders.update` | that row in scope |
| Row **Delete** | `orders.delete` | that row in scope |
| **Export** | `orders.export` | scope applied to the export |

Seed state ([02](02-permissions-rbac.md) § 6): all six roles read. Admin and Manager get
full CRUD. Finance and Warehouse update but never create or delete. Analyst and Viewer are
read-only.

Two rules the implementation must follow:

1. **Controls are absent, not disabled.** A Viewer sees no New button and no row action
   column at all.
2. **Per-row, not per-page.** With mixed-scope data an admin could see rows they may edit
   next to rows they may not. Compute action availability per row.

A create is checked against the *submitted* region: an East Manager cannot create a West
order. Otherwise scope is trivially escapable by writing yourself into another region.

---

## 7. User experience flow

### 7.1 Primary — browse the list

1. Manager clicks **Orders** in the sidebar. → Route guard passes on `orders.read`; the
   page mounts with a table skeleton at the right dimensions so nothing reflows.
2. `GET /api/orders?page=1` returns. → Table paints. Header shows **"Orders · 2,847"** and a
   scope chip reading **"East"**. The chip is the answer to "why is my total different from
   my colleague's".
3. User types "Gute" in search. → Debounced 300 ms, request fires, table shows a subtle
   loading overlay rather than collapsing to a skeleton — **Decision:** losing the previous
   rows on every keystroke makes a search field feel broken.
4. User clicks the **Sales** column header. → Sorts descending; the sort is server-side so
   it orders the whole scoped set, not just the current page.

### 7.2 Create

1. User clicks **New order**. → A right-side drawer slides in. The list stays visible
   behind it, which matters when you are copying details from an existing row.
2. Form: customer (searchable select), order date (native `<input type="date">`), ship
   mode, region, then a line-items repeater — product, quantity, discount.
3. Region defaults to the user's scope when they have exactly one region, and is locked to
   their scope list otherwise. A scoped user is never offered a region that would 403 on
   submit.
4. As lines are added, a running total updates: *"2 lines · $523.92 sales."*
5. Client generates a UUID `Idempotency-Key` **when the drawer opens** — not at submit
   time. This is the whole trick: a retry of the same logical submission reuses the same
   key.
6. User clicks **Create order**. → Button disables and spins. `POST /api/orders` fires.
7. `201` returns. → Drawer closes, the new row appears at the top of the table with a brief
   highlight, toast: *"Order CA-2024-118234 created."*

### 7.3 Double-click — the anti-spam demo

1. User double-clicks **Create order**, firing two requests.
2. First request executes and stores its response against the key.
3. Second arrives with the **same key and same body hash** → the server replays the stored
   response with `Idempotency-Replayed: true` and does **not** write.
4. → The user sees one success toast and **exactly one row**. Nothing indicates anything
   unusual happened, which is the point.
5. Even without a key, the 10-second content-dedup window catches the same case. Belt and
   braces — see [11](11-api-idempotency.md) § Dedup.

### 7.4 Edit and delete

1. User clicks a row's **Edit**. → Same drawer, pre-filled, titled with the order id. A new
   `Idempotency-Key` is generated on open.
2. Changing nothing and saving is a no-op that still returns `200` — harmless, and simpler
   than a client-side dirty check that has to be right.
3. **Delete** → a confirm dialog naming what will go: *"Delete order CA-2017-152156 and its
   2 line items? This cannot be undone."* Never a bare "Are you sure?".
4. Confirm → `DELETE` with a key. → Row animates out, toast confirms, one `audit_log` row
   written with the full `before` JSON.

### 7.5 Scope collision

1. Admin sends an East Manager a link to a West order.
2. Manager opens it. → `403`. Full-page card: *"This record is outside your assigned region
   (East). Ask an administrator if you need access."*
3. **Decision:** `403` over `404`, per [02](02-permissions-rbac.md) § 8 — in an internal
   ERP, "you cannot see West data" is not a secret, and a `404` on a record a colleague
   just linked generates a support ticket every time.

### 7.6 Optimistic updates — explicitly not doing them

**Decision: no optimistic UI on writes.** Show the pending state, wait for the server,
then render the server's row. The reasons are specific to this system: idempotent replays
mean the server response is authoritative in ways a client guess is not; RLS can reject a
write the client believed was fine; and reconciling a failed optimistic insert against a
scope filter is more code than the latency saves.

<!-- ponytail: no optimistic writes; revisit only if a profiler shows the round trip hurts -->

### 7.7 States

| State | What the user sees |
|---|---|
| **First load** | Table skeleton, correct column widths, header count as a placeholder dash |
| **Loading** | Skeleton on first load; translucent overlay on refetch, previous rows still readable |
| **Empty (no data)** | "No orders yet" plus a New button if the user holds `orders.create` |
| **Empty (filtered)** | "No orders match these filters" plus **Clear filters** — distinct copy from the above, because the fix is different |
| **Empty (scope)** | "No orders in your assigned region (East)" — names the reason so it does not read as broken |
| **Permission denied** | No `orders.read` → nav item absent; direct URL shows the denial card. Out-of-scope row → the § 7.5 card |
| **Error** | Load failed → "Could not load orders" + Retry, filters preserved. Save failed → drawer stays open with the data intact and an inline error; **never lose the user's typing** |

---

## 8. Edge cases

- **Double-submit.** Covered by the key; verified in § 9. The single most demo-visible
  requirement in `../Idea.txt`.
- **Refresh-resubmit.** Browser refresh mid-POST re-fires with the same key from the drawer
  session → replay, not a duplicate.
- **Session expires with the drawer open.** `401` on submit. Do not close the drawer.
  Re-auth in place, then retry with the **same key** ([01](01-auth.md) § 8).
- **Region changed on edit, out of the user's scope.** Rejected `403`. A user must not be
  able to push a row out of their own visibility.
- **Line items with a null category.** Breaks `in_scope` on that axis. The server derives
  category from the product and rejects with `422` if the product is unknown — never
  writes a null.
- **`ship_date` before `order_date`.** `400`. The generated `ship_lag_days` would go
  negative and poison the ship-lag insight rule.
- **Deleting an order with line items.** Cascade the lines in one transaction. A partial
  delete leaves orphaned `order_items` that still appear in every aggregate.
- **Pagination past the end.** `page=999` on a 3-page set returns an empty `rows` array
  with the true `total`, not a `404`. The UI shows the empty state and offers page 1.
- **Sorting on a computed column.** `sales` and `profit` on the list are per-order
  aggregates of `order_items`. Sorting them requires ordering by the aggregate, not by a
  column that exists on `orders`. Easy to get wrong and it silently returns plausible
  garbage.
- **Superstore ids are strings, not integers.** `CA-2017-152156`. Nothing may assume a
  numeric primary key.
- **Concurrent edit.** Two users editing one order: last write wins. Acceptable at MVP
  scale; the audit log makes it reconstructable.
  <!-- ponytail: last-write-wins; add an updated_at precondition if concurrent editing becomes real -->

---

## 9. Acceptance checks

- [ ] `GET /api/orders` as East Manager → `total` equals
      `SELECT count(*) FROM orders WHERE region='East'`, not the global count.
- [ ] Log in as Viewer → no New button, no row action column. `POST /api/orders` via curl →
      `403`.
- [ ] Same `Idempotency-Key` + same body twice → **one** row in `orders`; the second
      response carries `Idempotency-Replayed: true`.
- [ ] Same key + different body → `409`.
- [ ] 25 writes inside one minute → `429` with a `Retry-After` header.
- [ ] Double-click **Create** in the UI → exactly one row. Confirm with
      `SELECT count(*) FROM orders WHERE order_date = CURRENT_DATE`.
- [ ] `POST` with no `Idempotency-Key` → `428`.
- [ ] As East Manager, `PATCH` a West order id → `403`.
- [ ] Delete an order → both the order and its `order_items` are gone, and one `audit_log`
      row exists with a populated `before`.
- [ ] Create an order → its `order_items` rows have non-null `region` and `category`
      matching the parent order and the product.
- [ ] Filter to a region outside scope → empty state, `200`, not an error.

---

## 10. Depends on / blocks

**Depends on:** [01-auth.md](01-auth.md), [02-permissions-rbac.md](02-permissions-rbac.md),
[11-api-idempotency.md](11-api-idempotency.md), and the Superstore import
(`scripts/prepare_superstore.mjs`).

**Blocks:** [06-products-customers.md](06-products-customers.md) copies this module's
shape; [07-dashboard-metrics.md](07-dashboard-metrics.md) and
[08-insights-bi.md](08-insights-bi.md) aggregate this data.

**Related:** [09-audit-log.md](09-audit-log.md) (records every mutation here),
[UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/app/orders`.
