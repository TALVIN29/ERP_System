# 06 — Products & Customers

Two CRUD modules that share Orders' shape. This doc is written as a **delta** against
[05-orders.md](05-orders.md): everything not contradicted here is identical — the list
pattern, drawer form, idempotency handling, per-row action computation, empty/error
states, no-optimistic-writes decision. Read 05 first.

Build priority **P3** in `../PLAN.md` — the last things standing. If the clock kills them,
Orders alone still proves the CRUD requirement.

## 1. Purpose

Reference-data management for the two dimensions the business data hangs off:

- **Products** — the catalogue: `product_id`, category, sub-category, name. Feeds the
  `category` axis of row scoping and the margin-leak insight.
- **Customers** — the account list: `customer_id`, name, segment, geography, region. Feeds
  the `region` axis and the revenue-concentration insight.

They exist so the demo shows more than one CRUD surface, and so the scope axes are
demonstrably editable rather than fixed constants.

---

## 2. Why it exists / ERP limitation answered

Beyond what [05](05-orders.md) § 2 already covers, one limitation specific to reference
data:

**Reference data is where ERPs hide their scariest delete.** Removing a product that
30,000 order lines point at is a foot-gun most systems either allow (leaving dangling
references) or block with an opaque foreign-key error. Here the delete path checks
dependents first and answers in business language: *"This product appears on 47 order
lines and cannot be deleted."* Same for customers.

The second: **categories and regions are data, not code.** The scope pickers in
[03-admin.md](03-admin.md) read `DISTINCT` values from these tables, so adding a product
in a new sub-category immediately makes it scopable without a deploy.

---

## 3. Scope

**In scope**

- Products: scoped list, create, edit, delete, search, filter by category/sub-category
- Customers: scoped list, create, edit, delete, search, filter by segment/region
- Dependent-count guard on delete
- Same idempotency, permission and audit treatment as Orders

**Out of scope** — everything cut in [05](05-orders.md) § 3, plus:

- Product pricing, cost, stock levels, reorder points, supplier records, images
- Product variants or bundles
- Customer contacts, addresses beyond the Superstore columns, credit limits, contact
  history, merge/dedup tooling
- Category management as its own screen — **Decision:** category and sub-category are
  free-text fields on the product form with an autocomplete from existing values. A
  separate taxonomy CRUD is a third module for no additional demonstrated skill.

---

## 4. Data touched

| Table | Columns | Scope axis |
|---|---|---|
| `products` | `product_id` PK, **`category`**, `sub_category`, `name` | `category` |
| `customers` | `customer_id` PK, `name`, `segment`, `country`, `city`, `state`, `postal_code`, **`region`** | `region` |
| `order_items` | read-only, for dependent counts and the scope join | — |
| `orders` | read-only, for customer dependent counts | — |
| `audit_log` | write | — |

**The important asymmetry:** each of these tables carries only *one* of the two scope
axes. `products` has `category` but no region; `customers` has `region` but no category.
So `in_scope()` is called with a null on the missing axis, and the empty-array-means-all
rule makes that resolve correctly:

- A Warehouse user scoped to `regions={'Central'}`, `categories={'Furniture','Technology'}`
  sees **all** Central customers, and **only** Furniture and Technology products.
- A Manager scoped to `regions={'East'}`, `categories={}` sees **all** products (no
  category restriction) and only East customers.

This surprises people. State it in the UI: the scope chip on `/app/products` reads
**"Furniture, Technology"** and on `/app/customers` reads **"Central"** — each page shows
only the axis that applies to it, rather than a combined chip that implies a filter that
is not happening.

---

## 5. API surface

Identical shape to `/api/orders`. From `../PLAN.md`: *"`/api/products`, `/api/customers` —
same shape."*

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/products`, `/api/customers` | scoped, filtered, paginated list |
| `GET` | `…?id=…` | single record + dependent counts |
| `POST` | `…` | create — **requires `Idempotency-Key`** |
| `PATCH` | `…` | update — **requires `Idempotency-Key`** |
| `DELETE` | `…` | delete — **requires `Idempotency-Key`** |

### List response deltas

```json
{
  "rows": [{
    "product_id": "FUR-BO-10001798",
    "name": "Bush Somerset Collection Bookcase",
    "category": "Furniture",
    "sub_category": "Bookcases",
    "order_line_count": 47,
    "total_sales": 12934.55
  }],
  "page": 1, "page_size": 25, "total": 1862,
  "scope": { "categories": ["Furniture", "Technology"] }
}
```

`order_line_count` and `total_sales` per row are **Decision:** additions — a bare
catalogue list of 1,862 rows is inert, and these two columns make it something a manager
would actually read. Both are scope-filtered, so a Central-scoped user sees Central
volume for that product, consistent with every other number in the app.

Customers carry `order_count` and `total_sales` for the same reason.

### Filter params

- Products: `q` (name, id), `category`, `sub_category`
- Customers: `q` (name, id), `segment`, `region`, `state`

### Status codes

Same table as [05](05-orders.md) § 5, with one addition:

| Code | When |
|---|---|
| `409` | **delete blocked by dependents** — body carries the count and a plain-language message |

**Decision:** `409 Conflict` rather than `400`. The request is well-formed; it conflicts
with the current state of the data. The body must carry the count so the UI can say
*"47 order lines"* rather than *"cannot delete"*.

---

## 6. Permission gates

| Control | Products | Customers |
|---|---|---|
| List / detail | `products.read` | `customers.read` |
| New | `products.create` | `customers.create` |
| Edit | `products.update` | `customers.update` |
| Delete | `products.delete` | `customers.delete` |

Seed state ([02](02-permissions-rbac.md) § 6) — note these two differ, deliberately, so
the demo shows the matrix producing genuinely different navigation:

| Role | Products | Customers |
|---|---|---|
| Admin | full CRUD | full CRUD |
| Manager | read | read + create/update/delete |
| Analyst | read | read |
| Viewer | read | **no access — nav item absent** |
| Finance | **no access** | read |
| Warehouse | read | **no access** |

Logging in as Finance and seeing no Products item, then as Warehouse and seeing no
Customers item, is a two-click proof that the matrix drives the UI.

---

## 7. User experience flow

Flows follow [05-orders.md](05-orders.md) § 7 exactly — list, drawer create, drawer edit,
confirm delete, per-row actions, no optimistic writes. Only the deltas below.

### 7.1 Delete with dependents — the distinctive flow

1. Admin opens `/app/products`, clicks **Delete** on "Bush Somerset Collection Bookcase".
2. → The confirm dialog does not just ask; it **reports first**:
   *"This product appears on 47 order lines totalling $12,934.55. Deleting it would leave
   those lines without a product."*
3. The confirm button is replaced by a single **Close** action. There is no override.
   **Decision:** no force-delete and no cascade. Cascading here deletes revenue history to
   remove a catalogue row — the destructive-by-accident case is far more likely than the
   legitimate one.
4. For a product with zero dependents → the normal confirm appears: *"Delete
   'Test Product'? This cannot be undone."* → deletes cleanly.

### 7.2 Create a product

1. **New product** → drawer. Fields: id, name, category, sub-category.
2. Category and sub-category are text inputs with autocomplete from existing distinct
   values — type "Furn" and "Furniture" offers itself; type something new and it is
   accepted. New taxonomy without a taxonomy screen.
3. If the user's scope restricts categories, the field is **limited to their scoped
   categories** — the same rule as region on order create ([05](05-orders.md) § 6). You
   cannot create a record you would immediately be unable to see.
4. `product_id` is user-supplied and must be unique. Duplicate → `409` with *"A product
   with this ID already exists."* **Decision:** user-supplied rather than generated,
   because Superstore ids are meaningful strings (`FUR-BO-10001798`) and generating an
   incompatible format in the same table would look sloppy in the demo.

### 7.3 Customer detail

1. Clicking a customer row opens the drawer with their fields **plus** a compact recent
   orders list — the last 5, scope-filtered, each linking through to
   `/app/orders?id=…`.
2. **Decision:** read-only, capped at 5, no pagination inside the drawer. It answers "who
   is this?" in one glance without becoming a second orders screen.

### 7.4 States

Same table as [05](05-orders.md) § 7.7, with the scope-empty copy adjusted per page:

- Products: *"No products in your assigned categories (Furniture, Technology)."*
- Customers: *"No customers in your assigned region (Central)."*

---

## 8. Edge cases

Everything in [05](05-orders.md) § 8 applies. Additionally:

- **The single-axis scope asymmetry.** Described in § 4. The bug to avoid is calling
  `in_scope(region, category)` on `products` with a fabricated region value instead of
  null — that silently hides the whole catalogue from every scoped user.
- **Editing a product's category.** It changes which users can see it, and it desynchs the
  denormalized `category` on every existing `order_items` row pointing at it.
  **Decision:** category is **not editable after creation**. The field renders disabled on
  edit with the hint *"Category cannot be changed — create a new product instead."*
  Retro-updating thousands of denormalized rows inside a request is exactly the kind of
  hidden expensive write that makes an ERP feel unreliable.
- **Editing a customer's region.** Same class of problem, same resolution: region is fixed
  after creation.
- **Duplicate ids.** Both tables use meaningful string PKs. Uniqueness is enforced by the
  database; the endpoint maps the constraint violation to a `409` with readable copy
  rather than leaking the Postgres error text.
- **A product with zero orders.** Perfectly normal — new catalogue entries. `total_sales`
  renders as `—`, not `$0.00`, which reads as a real zero.
- **1,862 products, 793 customers.** Both need server-side pagination and search from day
  one. Neither is small enough to ship to the client whole.
- **Deleting a customer with orders.** Same dependent guard as products, counted against
  `orders` rather than `order_items`.

---

## 9. Acceptance checks

- [ ] Log in as Finance → no Products nav item. `GET /api/products` via curl → `403`.
- [ ] Log in as Warehouse → no Customers nav item; Products list shows **only** Furniture
      and Technology rows, and `total` matches
      `SELECT count(*) FROM products WHERE category IN ('Furniture','Technology')`.
- [ ] Log in as East Manager → Products list shows **all** 1,862 products (no category
      scope), Customers shows East only.
- [ ] Delete a product with order lines → `409`, dialog states the dependent count, and
      `SELECT count(*) FROM products` is unchanged.
- [ ] Create a throwaway product, delete it → succeeds, one `audit_log` row with a
      populated `before`.
- [ ] Create with a duplicate `product_id` → `409` with readable copy, not a raw Postgres
      error.
- [ ] Open a product for edit → the category field is disabled with the explanatory hint.
- [ ] Same `Idempotency-Key` + same body on `POST /api/customers` twice → one row,
      `Idempotency-Replayed: true` on the second.
- [ ] Every mutation on both endpoints appears in `audit_log` with the correct `entity`.

---

## 10. Depends on / blocks

**Depends on:** [05-orders.md](05-orders.md) (the pattern this copies),
[01-auth.md](01-auth.md), [02-permissions-rbac.md](02-permissions-rbac.md),
[11-api-idempotency.md](11-api-idempotency.md).

**Blocks:** nothing. P3 — the tail of the build order.

**Related:** [03-admin.md](03-admin.md) (scope pickers read `DISTINCT` values from these
tables), [08-insights-bi.md](08-insights-bi.md) (margin-leak and revenue-concentration
rules read them), [UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/app/products`,
§ `/app/customers`.
