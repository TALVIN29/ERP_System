# 02 — Permissions & RBAC

The heart of the assignment. Read this one end to end before writing any endpoint or any
gated UI control.

## 1. Purpose

Decides *what a signed-in user may do* (permission) and *which rows they may do it to*
(scope), and makes both editable from inside the website by an Admin — no redeploy, no
SQL console. It is not a page; it is a cross-cutting engine consumed by every module, and
surfaced by two admin screens described in [03-admin.md](03-admin.md).

Two independent axes:

- **Permission** — a `(module, action)` pair granted to a role. *Can you delete orders at
  all?*
- **Scope** — region and category arrays on your profile. *Which orders count as yours?*

A Manager may hold `orders.delete` and still get a `403` deleting a West order, because
their scope is East. Keep these separate in your head and in the code; conflating them is
the classic RBAC bug.

---

## 2. Why it exists / ERP limitation answered

From `../Idea.txt`: *"Role & Permissions (User Permission Module) that is editable by the
admin from the website"*, and the CRUD requirement *"according to the role and
permission"*.

Odoo, ERPNext and Dolibarr all have capable permission systems buried in dense
back-office forms — long dropdown lists, one record per rule, no way to see the whole
picture at once. Answering "what can a Manager actually do?" means clicking through a
dozen screens. Three enhancements here:

1. **The whole grid on one screen.** Modules down, actions across, checkboxes. The
   permission model *is* the UI; there is nothing to translate.
2. **Row-level scoping as a first-class concept**, not an afterthought bolted on as
   record rules. Two array columns, one SQL function, applied identically in the API
   guard and in RLS.
3. **The UI never lies.** Controls render from the permission set, so a user cannot click
   something that will 403. Onboarding cost drops because there is nothing to learn to
   ignore.

---

## 3. Scope

**In scope**

- `roles`, `permissions`, `role_permissions`, `profiles` schema
- SQL helpers `current_role_key()`, `has_perm()`, `in_scope()`
- RLS policies on every table
- The Function-side guard steps that check permission and scope
- Client-side `perms.js` for rendering decisions
- Region + Category row scoping, end to end

**Out of scope**

- Per-user permission overrides — permissions attach to roles only. **Decision:** a
  one-off exception is exactly how permission systems rot; if a user needs a different
  set, they need a different role.
- Field-level permissions (hide a single column from a role)
- Permission inheritance / role hierarchies — the six roles are flat
- Time-bounded or delegated access, approval workflows
- Custom role creation in the UI — **Decision:** the 6 seeded roles are fixed for the
  MVP; what is editable is their *permissions*, which is what the requirement asks for.
  The `roles` table has `is_system` ready for when custom roles arrive.

---

## 4. Data touched

### Tables

| Table | Columns | Role |
|---|---|---|
| `roles` | `id`, `key`, `name`, `is_system` | the 6 seeded roles |
| `permissions` | `id`, `module`, `action` | the fixed 8 × 5 = 40 capability rows |
| `role_permissions` | `role_id`, `permission_id` | **the matrix the admin edits** — one row per checked box |
| `profiles` | `user_id`, `full_name`, `role_id`, `scope_regions text[]`, `scope_categories text[]` | who has which role, and their row scope |

Modules: `orders`, `products`, `customers`, `insights`, `users`, `roles`, `audit`,
`settings`.
Actions: `read`, `create`, `update`, `delete`, `export`.

Not every cell is meaningful (`audit.create` is never granted — the system writes those
rows, not people). **Decision:** seed all 40 rows anyway and render the full grid.
A partially-populated grid raises "why is this cell missing?" every time; a complete grid
with a never-checked cell raises nothing.

### Scope columns

`scope_regions` and `scope_categories` are Postgres `text[]`. The rule that makes
everything else simple:

> **An empty array means no restriction on that axis.**

So Admin and Analyst carry `{}` for both and need zero special-casing anywhere. A
Warehouse user carries `{'East'}` and `{'Furniture','Technology'}` and is filtered on
both axes. The two axes are ANDed.

`order_items` carries denormalized `region` and `category` columns specifically so scope
filters stay index-only and never need a join to evaluate.

---

## 5. API surface

This module has no endpoints of its own — the admin screens in
[03-admin.md](03-admin.md) own `/api/admin-roles` and `/api/admin-users`. What it
contributes is behaviour inside *every* endpoint.

### SQL helpers — written once, used by both RLS and the Function guard

```sql
current_role_key() returns text
-- the role key of the calling JWT's user, via profiles -> roles

has_perm(module text, action text) returns boolean
-- true if the caller's role holds that (module, action) in role_permissions

in_scope(region text, category text) returns boolean
-- true if (scope_regions is empty OR region = ANY(scope_regions))
--     AND (scope_categories is empty OR category = ANY(scope_categories))
```

All three are `stable` and `security definer`, so RLS policies can call them without
recursing into the policies on `profiles` and `role_permissions`.

### RLS policy shape

Enabled on every table. Business tables read as:

```sql
USING (has_perm('orders','read') AND in_scope(region, category))
```

with mutations gated on the matching action (`orders.create`, `orders.update`,
`orders.delete`). This is the **second wall**: the Function guard has already checked the
same thing in application code, using a Supabase client constructed with the *user's* JWT
so the policies actually apply.

### Status codes this module produces

| Code | Meaning | Example |
|---|---|---|
| `403` | permission missing, **or** the row is out of scope | Viewer POSTs an order; East Manager PATCHes a West order |
| `404` | **Decision:** not used for out-of-scope rows | see § 8 |

---

## 6. Permission gates

Seed state of the matrix. **This is a starting point, not a contract** — an Admin can
change any cell at runtime, which is the feature. Never encode this table in the client.

| Module | Action | Admin | Manager | Analyst | Viewer | Finance | Warehouse |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| orders | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| orders | create | ✅ | ✅ | — | — | — | — |
| orders | update | ✅ | ✅ | — | — | ✅ | ✅ |
| orders | delete | ✅ | ✅ | — | — | — | — |
| orders | export | ✅ | ✅ | ✅ | — | ✅ | — |
| products | read | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| products | create/update/delete | ✅ | — | — | — | — | — |
| customers | read | ✅ | ✅ | ✅ | — | ✅ | — |
| customers | create/update/delete | ✅ | ✅ | — | — | — | — |
| insights | read | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| insights | export | ✅ | — | ✅ | — | ✅ | — |
| users | read | ✅ | — | — | — | — | — |
| users | update | ✅ | — | — | — | — | — |
| roles | read | ✅ | — | — | — | — | — |
| roles | update | ✅ | — | — | — | — | — |
| audit | read | ✅ | — | — | — | — | — |
| settings | read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| settings | update | ✅ | — | — | — | — | — |

Seed scopes:

| Role | `scope_regions` | `scope_categories` |
|---|---|---|
| Admin | `{}` | `{}` |
| Manager | `{'East'}` | `{}` |
| Analyst | `{}` | `{}` |
| Viewer | `{'West'}` | `{}` |
| Finance | `{}` | `{}` |
| Warehouse | `{'Central'}` | `{'Furniture','Technology'}` |

---

## 7. User experience flow

Three audiences experience this module differently.

### 7.1 The ordinary user — permission is invisible

1. User logs in. → Bootstrap returns `permissions: ["orders.read", "orders.update", …]`.
2. The app shell renders the sidebar by filtering nav items against that set. A Viewer's
   sidebar has four items; an Admin's has eight. → **The user never sees a control they
   cannot use.**
3. User opens `/app/orders`. → The table renders. The "New order" button is absent, not
   disabled — a disabled button is an invitation to wonder why. Row action buttons render
   per row, per action.
4. User is never shown a 403 in normal operation. If one appears, something disagreed
   between client and server and that is worth surfacing loudly, not swallowing.

### 7.2 The admin editing the matrix

Full screen detail in [03-admin.md](03-admin.md); the permission-model view of it:

1. Admin opens `/app/admin/roles`. → Grid loads: modules down the left, the five actions
   across the top, one column group per role.
2. Admin unchecks `orders.delete` for Manager. → The checkbox animates (anime.js pulse),
   the cell is marked dirty, and a sticky save bar slides in: "1 unsaved change · Save ·
   Discard".
3. Admin clicks **Save**. → `PUT /api/admin-roles` sends the full desired state for the
   changed role. Server diffs against current, writes `role_permissions`, writes an
   `audit_log` row with before/after.
4. → Toast: "Permissions updated. Affected users will see the change on their next page
   load." That last clause matters — see § 8 on propagation.

### 7.3 The affected user

1. A logged-in Manager, mid-session, still has the old permission set in memory. Their
   delete button is still on screen.
2. They click it. → The API rejects with `403`. The client shows: "Your permissions
   changed. Reloading." and refetches the bootstrap.
3. → After reload, the delete button is gone. State and reality agree again.

### 7.4 Scoping in practice

1. East Manager opens `/app/orders`. → The list shows East rows only. The header carries a
   scope chip: **"Scope: East"** — not buried in settings, visible on the page.
2. They open the dashboard. → Every KPI reflects East only. The same chip appears. Two
   roles seeing different totals for "Total sales" is correct, and the chip is what stops
   it reading as a bug.
3. They try to deep-link to a West order's detail URL. → `403`, with a clear message:
   "This record is outside your assigned region."

### 7.5 States

| State | What the user sees |
|---|---|
| **First load** | Nav renders after the permission set arrives — no flash of items that then vanish |
| **Loading** | App-shell skeleton with placeholder nav rows |
| **Empty** | Zero permissions → "No modules assigned yet" card (see [01](01-auth.md)) |
| **Permission denied** | Full-page card on route access; inline message on an action; never a bare "403" |
| **Error** | Bootstrap failed → "Could not load your permissions" with a retry button. **Fail closed** — render nothing gated, never default to showing everything |

---

## 8. Edge cases

- **Admin locks themselves out.** An Admin unchecking `roles.update` for Admin makes the
  matrix un-editable by anyone, permanently, from inside the app. Guard it: the server
  rejects any save that would leave zero roles holding `roles.update`, and the UI blocks
  the last such checkbox with an explanatory tooltip rather than letting the save fail.
  Same protection for `users.update`.
- **Empty array means all.** Say it again because it inverts the intuitive reading. A
  scope of `{}` is *unrestricted*, not *nothing*. Any code that treats an empty scope as
  "match nothing" silently hides all data from Admin.
- **Propagation lag.** Permissions are read at bootstrap and cached client-side for the
  session. A revoked permission does not remove a button until the next load. This is
  acceptable because the **server** enforces immediately — the stale button 403s. Do not
  fix it with polling; fix it by handling the 403 as in § 7.3.
- **Out-of-scope row: 403 or 404?** `404` leaks less (it does not confirm the record
  exists). **Decision: return `403` with a clear message.** In an internal ERP, "you
  cannot see East data" is not a secret, and a `404` on a record a colleague just emailed
  you about generates a support ticket every time.
- **Scope on aggregates.** Every metric and insight query must apply `in_scope` too.
  Easy to remember on a list endpoint, easy to forget on a `SUM()`. A dashboard that
  aggregates across all regions for a scoped user is a real data leak.
- **A user with `create` but no `read`.** Legal in the model, incoherent in the UI — they
  could create a row and immediately not see it. **Decision:** the matrix UI warns on save
  ("Manager can create orders but not read them") without blocking. Flag it, don't
  babysit it.
- **Role deleted while users hold it.** `is_system` roles cannot be deleted, and role
  creation is out of scope, so this cannot arise in the MVP. Note it here for whoever adds
  custom roles: reassign or block.
- **RLS recursion.** `has_perm()` queries `role_permissions`, which itself has RLS. Without
  `security definer` on the helpers the policy evaluation recurses and Postgres errors.
  This bites during `02_rls.sql` and looks mysterious — check it first.
- **Service-role bypass.** RLS does not apply to the service-role key. Any Function that
  constructs its client with the service key has silently disabled the second wall. Only
  the seed/admin paths may do that, and they must justify it in a comment.

---

## 9. Acceptance checks

- [ ] Log in as each of the 6 roles → screenshot the sidebar. Viewer has no Create button;
      Warehouse sees no Finance-only module.
- [ ] As East Manager, `/app/orders` returns East rows only. Run
      `SELECT count(*) FROM orders WHERE region='East'` in the Supabase SQL editor and
      confirm the UI count matches that number, **not** the global one.
- [ ] Admin unchecks `orders.delete` for Manager → after reload the Manager's delete button
      is gone, and a direct `DELETE /api/orders/:id` returns `403`.
- [ ] As East Manager, `PATCH /api/orders/:id` against a West order id → `403`.
- [ ] Dashboard totals for East Manager ≠ dashboard totals for Admin, and the East figure
      matches a hand-written scoped SQL sum.
- [ ] With RLS temporarily the only wall (bypass the guard's permission check in a local
      branch), the same requests still fail → proves the second wall is live, not
      decorative.
- [ ] Attempt to uncheck the last `roles.update` → blocked in UI, and rejected by the API
      if forced via curl.

---

## 10. Depends on / blocks

**Depends on:** [01-auth.md](01-auth.md) for the JWT and the bootstrap that carries the
permission set; `01_schema.sql`, `02_rls.sql`, `04_seed.sql`.

**Blocks:** every CRUD module ([05](05-orders.md), [06](06-products-customers.md)), the
metrics and insight queries ([07](07-dashboard-metrics.md), [08](08-insights-bi.md)), the
admin screens ([03](03-admin.md)), and the guard chain
([11](11-api-idempotency.md) steps 5).

**Related:** [09-audit-log.md](09-audit-log.md) records every matrix change;
[UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § App shell for permission-driven nav rendering.
