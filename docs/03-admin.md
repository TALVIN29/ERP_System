# 03 — Admin

## 1. Purpose

The two screens where an Admin reshapes the system without touching code or a database
console: **Roles** (`/app/admin/roles`) edits the permission matrix, **Users**
(`/app/admin/users`) assigns a role and row scope to each person. Together they are the
visible face of [02-permissions-rbac.md](02-permissions-rbac.md) — that doc owns the
model, this one owns the screens and the workflows.

The audit viewer also lives under `/app/admin/` but is documented separately in
[09-audit-log.md](09-audit-log.md).

---

## 2. Why it exists / ERP limitation answered

Straight from `../Idea.txt`: *"Role & Permissions (User Permission Module) that is
editable by the admin from the website."* The requirement is not that permissions exist —
every ERP has permissions — but that an admin can change them **from the website**.

The limitation being answered is presentation. In Odoo you configure access rights as a
list of one-record-per-rule forms; in ERPNext through a role-permissions manager that
shows one doctype at a time. Neither lets you answer "what can a Manager do?" without
clicking through many screens and holding the answer in your head.

Here it is one grid. Modules down, actions across, one glance. The screen is
deliberately the same shape as the underlying `role_permissions` table, so what the admin
sees *is* the data model — nothing to translate, nothing to mis-map.

---

## 3. Scope

**In scope**

- Permission matrix grid: read, toggle, dirty-state, bulk save, discard
- Lockout guardrails (cannot remove the last `roles.update`)
- User list with role assignment
- Region / category scope editor per user
- Both screens gated on `roles.read`/`roles.update` and `users.read`/`users.update`
- Every change writes an `audit_log` row with before/after

**Out of scope**

- Creating, renaming or deleting roles — the 6 are seeded and `is_system`. What is
  editable is their permissions, which is what the requirement asks for.
- Inviting users by email from the admin screen — **Decision:** cut. It burns the same
  rate-limited transactional email that forced the demo-user workaround in
  [01-auth.md](01-auth.md). Users self-signup; the Admin assigns their role afterwards.
- Deactivating / deleting users, password resets on behalf of a user
- Per-user permission overrides (see [02](02-permissions-rbac.md) § 3)
- Bulk user import, org chart, teams, delegation

---

## 4. Data touched

| Table | Access | Notes |
|---|---|---|
| `roles` | read | the 6 seeded roles, used as the grid's column groups |
| `permissions` | read | the fixed 40 `(module, action)` rows, used as the grid's row/column axes |
| `role_permissions` | read + **write** | the checkbox state; the only table the Roles screen mutates |
| `profiles` | read + **write** | `role_id`, `scope_regions`, `scope_categories` |
| `auth.users` | read (email only) | joined for display; never mutated here |
| `orders`, `products` | read (distinct) | to populate the region and category pickers from real data |
| `audit_log` | write | one row per save |

**Decision:** the scope editor's region and category options come from
`SELECT DISTINCT region FROM orders` and `SELECT DISTINCT category FROM products`, not a
hardcoded list. Swapping the dataset later (DataCo, per `../PLAN.md` § Deliberate cuts)
then needs no code change.

---

## 5. API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin-roles` | full matrix: roles, permissions, and the current grants |
| `PUT` | `/api/admin-roles` | save the matrix (mutating → needs `Idempotency-Key`) |
| `GET` | `/api/admin-users` | user list with role, scope, email |
| `PATCH` | `/api/admin-users` | assign role and/or set scope for one user (mutating → needs `Idempotency-Key`) |

### `GET /api/admin-roles`

```json
{
  "roles":       [{ "id": 2, "key": "manager", "name": "Manager", "is_system": true }],
  "permissions": [{ "id": 7, "module": "orders", "action": "delete" }],
  "grants":      { "2": [1, 2, 3, 7] }
}
```

`grants` maps `role_id` → array of held `permission_id`. Flat and small — the whole
matrix is well under 10 KB.

### `PUT /api/admin-roles`

Send the **full desired state** for every role you changed, not a patch of individual
toggles:

```json
{ "grants": { "2": [1, 2, 3] } }
```

**Decision: full-state-per-role, not per-cell deltas.** Two admins editing at once with
per-cell deltas produce an interleaved mess that is impossible to reason about or audit.
Full state makes the write a clean replace, gives the audit log a meaningful before/after,
and makes the idempotency replay trivially correct.

Server behaviour: diff submitted state against current, delete removed grants, insert
added ones, all in one transaction, then write one `audit_log` row per role changed.

Response: the same shape as `GET`, so the client replaces its state from the server's
truth rather than trusting its own optimistic copy.

### `PATCH /api/admin-users`

```json
{
  "user_id":  "uuid",
  "role_id":  3,
  "scope_regions":    ["East"],
  "scope_categories": []
}
```

All fields except `user_id` optional. Omitted means unchanged; `[]` explicitly means
"unrestricted" — the client must distinguish absent from empty, so send `null` for "leave
alone" if the shape is ever ambiguous.

### Status codes

| Code | When |
|---|---|
| `200` | saved, current state returned |
| `400` | unknown `role_id` / `permission_id` / `user_id`, or malformed grants |
| `401` | no valid JWT |
| `403` | caller lacks `roles.update` / `users.update` |
| `409` | lockout guard tripped, or same `Idempotency-Key` with a different body |
| `422` | **Decision:** scope value not present in the dataset (e.g. region `"Mars"`) |
| `429` | rate limited |

---

## 6. Permission gates

| Screen | Read requires | Write requires |
|---|---|---|
| `/app/admin/roles` | `roles.read` | `roles.update` |
| `/app/admin/users` | `users.read` | `users.update` |

Seed state: **Admin only**, on all four. The nav group "Admin" renders only if the user
holds at least one of `roles.read`, `users.read`, `audit.read` — a role granted only
`audit.read` sees the Admin group with a single item, not an empty container.

Read-without-write is a real and useful state: a user with `roles.read` but not
`roles.update` sees the full matrix with every checkbox disabled and a banner reading
"View only — you cannot change permissions." That is the one place a disabled control
beats a hidden one, because the grid's value is being *seen*.

Scope does **not** apply to these screens. Permissions are global objects; there is no
"East half of the permission matrix".

---

## 7. User experience flow

### 7.1 Primary — edit the permission matrix

1. Admin clicks **Admin → Roles**. → Route guard passes on `roles.read`; the page mounts
   with a grid skeleton.
2. `GET /api/admin-roles` returns. → Grid paints: 8 module rows × 5 action columns, one
   column group per role, checkboxes reflecting current grants. Row and column headers are
   sticky, so scrolling never loses context.
3. Admin hovers a cell. → Its row and column highlight, and a tooltip states the plain
   meaning: *"Manager can delete orders."* No jargon, no permission ID.
4. Admin clicks the `orders / delete` cell under Manager. → Checkbox toggles immediately
   (optimistic, local only). anime.js pulses the cell. It gains a dirty marker — a small
   amber dot in the corner, **not** a colour change, because colour alone fails for
   colour-blind users and clashes with the checked state.
5. A sticky save bar slides up from the bottom: **"1 unsaved change · Discard · Save"**.
   It stays until resolved.
6. Admin toggles four more cells. → Bar reads "5 unsaved changes".
7. Admin clicks **Save**. → Bar enters a loading state, grid becomes non-interactive but
   stays fully readable. `PUT /api/admin-roles` fires with a fresh `Idempotency-Key`.
8. `200` returns with the new server state. → Grid re-renders from the response, dirty
   markers clear, save bar slides away, toast: *"Permissions updated. Affected users will
   see the change on their next page load."*

### 7.2 Discard

1. Admin has 3 dirty cells and clicks **Discard**. → Confirmation is skipped (**Decision:**
   the change is unsaved and trivially redone; a modal here is friction for nothing).
2. → Grid reverts to the last server state, markers clear, bar disappears.
3. Navigating away with unsaved changes → a browser-level `beforeunload` prompt plus an
   in-app route-change guard: *"You have 3 unsaved permission changes."*

### 7.3 Assign a role and scope to a user

1. Admin clicks **Admin → Users**. → Table of users: name, email, current role, scope
   summary chips ("East · all categories"), last active.
2. Admin clicks a row. → A side drawer opens (not a modal — the drawer keeps the list
   visible for comparison).
3. Drawer shows: **Role** (single select of the 6), **Regions** (multi-select), **Categories**
   (multi-select). Under each scope field sits a live hint: *"Leave empty for access to all
   regions."*
4. Admin sets Role = Manager, Regions = East. → As they pick, a preview line updates:
   *"Dana will see 2,847 of 9,994 order lines."* **Decision:** this preview is the single
   highest-value affordance on the screen — scope is abstract until you see the row count
   it produces. Backed by a scoped `count(*)`, debounced.
5. Admin clicks **Save changes**. → `PATCH /api/admin-users` with an `Idempotency-Key`.
6. → Drawer closes, the row updates in place with a brief highlight, toast confirms.

### 7.4 Blocked — lockout guard

1. Admin tries to uncheck `roles.update` for the Admin role, and Admin is the only role
   holding it. → The checkbox does not toggle. A tooltip appears immediately: *"At least
   one role must keep permission management, or nobody could ever change permissions
   again."*
2. If forced via curl anyway → `409` with the same message in the body. The client-side
   block is convenience; the server-side block is the actual guarantee.

### 7.5 States

| State | Roles screen | Users screen |
|---|---|---|
| **First load** | Grid skeleton, correct dimensions so nothing reflows | Table skeleton, 8 placeholder rows |
| **Loading** | Skeleton; on save, grid dims but stays readable | Same; drawer save button spins |
| **Empty** | Not reachable — permissions are always seeded | "No other users yet" with a line pointing at the signup URL |
| **Permission denied** | `roles.read` only → full grid, all checkboxes disabled, "View only" banner. No `roles.read` → nav item absent; direct URL shows a full-page denial card |
| **Error** | Load failed → "Could not load the permission matrix" + Retry. Save failed → grid keeps the dirty state, save bar turns to an error state; **never silently discard the admin's work** |

---

## 8. Edge cases

- **Self-lockout, the general case.** Beyond the last-`roles.update` guard: an Admin can
  legitimately downgrade *their own* user to Viewer on the Users screen and lose the admin
  screens instantly. **Decision:** warn but allow — *"This will remove your own admin
  access. You will need another admin to restore it."* — with an explicit confirm. Blocking
  it outright breaks the legitimate "I'm handing over" case.
- **Concurrent admins.** Two admins editing the matrix, last write wins. Acceptable at MVP
  scale (one admin), but the audit log makes it forensically clear who overwrote what. If
  it ever matters, add an `updated_at` precondition to the `PUT`.
  <!-- ponytail: last-write-wins; add optimistic-concurrency check if a second admin ever exists -->
- **Save partially applied.** Must not happen — the whole diff runs in one transaction. If
  the transaction fails, nothing is written and the client keeps its dirty state.
- **Idempotency replay on the matrix.** Same key + same body → the stored response replays
  with `Idempotency-Replayed: true` and no second write. Same key + *different* body →
  `409`. See [11-api-idempotency.md](11-api-idempotency.md).
- **Scope values that no longer exist.** A user scoped to a region later absent from the
  data sees an empty list, not an error. The Users screen flags it: *"Region 'South' has no
  matching records."*
- **Incoherent grants.** `create` without `read` is legal in the model and confusing in
  practice. Warn on save, do not block — see [02](02-permissions-rbac.md) § 8.
- **The grid is wide.** 6 roles × 5 actions = 30 columns. It must scroll horizontally
  inside its own container with sticky module names; the page body must never scroll
  sideways. On narrow screens, switch to one-role-at-a-time with a role picker.
- **Users list growth.** Six demo users now. Paginate at 25 from the start rather than
  retrofitting it.

---

## 9. Acceptance checks

- [ ] Log in as Admin → both admin nav items visible. Log in as Manager → Admin group
      absent entirely.
- [ ] Toggle a cell → dirty marker and save bar appear. Discard → grid returns to the
      server state exactly.
- [ ] Uncheck `orders.delete` for Manager, save, then log in as Manager → delete button
      gone, and `DELETE /api/orders/:id` returns `403`.
- [ ] Replay the same `PUT /api/admin-roles` with the same `Idempotency-Key` and body →
      second response carries `Idempotency-Replayed: true`; `SELECT count(*) FROM
      role_permissions` is unchanged.
- [ ] Same key, different body → `409`.
- [ ] Attempt to remove the last `roles.update` in the UI → blocked with the explanation.
      Force it with curl → `409`.
- [ ] Set a user's scope to East, save, log in as them → order count matches
      `SELECT count(*) FROM order_items WHERE region='East'`.
- [ ] Every save produces exactly one `audit_log` row per changed role, with populated
      `before` and `after` JSON.
- [ ] `PATCH /api/admin-users` as a non-admin → `403`.

---

## 10. Depends on / blocks

**Depends on:** [01-auth.md](01-auth.md) (session), [02-permissions-rbac.md](02-permissions-rbac.md)
(the entire model these screens edit), [11-api-idempotency.md](11-api-idempotency.md)
(guard chain, idempotency on both writes).

**Blocks:** nothing structurally — but this is the screen that makes the assignment's
central requirement demonstrable. Without it the permission system is real but invisible.

**Related:** [09-audit-log.md](09-audit-log.md) (reads what these screens write),
[UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/app/admin/roles`, § `/app/admin/users`.
