# 09 — Audit Log

## 1. Purpose

Every mutation in the system writes an immutable record of who did what, to which entity,
and what the data looked like before and after. `/app/admin/audit` is the read-only viewer
over that record.

The write side is not optional and not per-module: it is **step 6 of the guard chain** in
[11-api-idempotency.md](11-api-idempotency.md), so a new endpoint gets auditing by
existing rather than by remembering to add it.

Build priority **P3** for the viewer. The *writing* is P0 — it ships with the guard.

---

## 2. Why it exists / ERP limitation answered

Three things it buys:

- **Accountability for the permission matrix.** The system's most powerful screen is the
  one where an Admin changes who can do what ([03](03-admin.md)). Without an audit trail,
  a permission change is untraceable — and permission changes are exactly what you want to
  trace. Every matrix save writes a before/after.
- **The cheap undo.** [05-orders.md](05-orders.md) § 3 cuts soft delete, and the audit log
  is what makes that affordable: the full `before` JSON of a deleted row is retained, so a
  deletion is reconstructable by hand. Recovery without a recycle bin's complexity.
- **Export visibility.** Bulk data leaving the system via `/api/export`
  ([08](08-insights-bi.md)) is recorded — who pulled which dataset, how many rows.

Most ERPs have audit logs. Two things typically make them unusable: they log the mutation
but not the payload, so you can see *that* something changed but not *what*; and they are
enabled per-model by configuration, so the model you care about is the one that wasn't
enabled. Both are avoided here — full before/after JSON, written centrally.

---

## 3. Scope

**In scope**

- `audit_log` written by the guard on every successful mutation
- Paginated viewer with filters: user, action, entity, date range
- Before/after JSON diff display
- Retention of the full payload, not just field names

**Out of scope**

- Logging *reads* — **Decision:** every list request would flood the table, and the
  question audit answers here is "who changed this", not "who looked at this". The one
  exception is `/api/export`, logged because bulk extraction is materially different from
  browsing.
- Editing or deleting audit rows from anywhere in the app. The table is append-only; the
  UI has no delete, and RLS permits no update or delete on it for any role.
- Retention policy, archival, log rotation
- Alerting on suspicious activity, anomaly detection
- Exporting the audit log itself — **Decision:** cut for MVP. It is a small extra
  surface for a compliance need this system does not yet have.
- Diffing across more than two versions, or a per-entity history timeline. The viewer is a
  flat chronological list with filters.

---

## 4. Data touched

| Table | Columns | Access |
|---|---|---|
| `audit_log` | `id`, `user_id`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb`, `at` | **append-only**; read by the viewer |
| `profiles`, `auth.users` | joined for the actor's name and email | read |

### Column semantics

| Column | Meaning |
|---|---|
| `user_id` | who acted. Never null — an unauthenticated request never reaches step 6 |
| `action` | `create` · `update` · `delete` · `export` — the same vocabulary as `permissions.action` |
| `entity` | the module: `orders`, `products`, `customers`, `roles`, `users`, `settings` |
| `entity_id` | the affected row's PK as text; for a matrix save, the `role_id`; for an export, the dataset name |
| `before` | full row JSON prior to the change. `null` on create |
| `after` | full row JSON after the change. `null` on delete |
| `at` | server timestamp, UTC |

**Decision:** store whole rows, not field-level diffs. The diff is computed at display
time from the two JSON blobs. Storing a diff means deciding at write time what will
matter later, which is exactly the decision that makes existing ERP audit logs useless.
The storage cost at MVP volume is irrelevant.

### Scope and RLS

**Decision:** the audit log is **not row-scoped**. It is gated on `audit.read`, which only
Admin holds, and an Admin is unscoped by definition. Scoping audit rows by the region of
the entity they reference would mean joining back to a row that may have been deleted —
which is precisely the row you most want to see.

RLS on this table permits `SELECT` for `has_perm('audit','read')` and **no** `INSERT`,
`UPDATE` or `DELETE` for any role. Rows are written by the guard through the elevated
path, which is the one justified service-role use in the codebase — and that justification
belongs in a comment at the call site.

---

## 5. API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/audit-log` | paginated, filtered list |

Read-only. There is no write endpoint — writes happen inside the guard, never through an
exposed route. A `POST /api/audit-log` would let a client forge history.

Query params: `page` (default 1), `page_size` (default 50, max 200), `user_id`, `action`,
`entity`, `date_from`, `date_to`, `q` (matches `entity_id`).

```json
{
  "rows": [{
    "id": 8821,
    "at": "2026-07-25T10:14:22Z",
    "actor": { "user_id": "…", "full_name": "Talvin Lee", "email": "admin@…", "role": "Admin" },
    "action": "update",
    "entity": "roles",
    "entity_id": "2",
    "before": { "grants": [1, 2, 3, 7] },
    "after":  { "grants": [1, 2, 3] },
    "summary": "Removed orders.delete from Manager"
  }],
  "page": 1, "page_size": 50, "total": 1204
}
```

**Decision:** `summary` is generated **server-side**, not in the client. The server knows
what a `role_permissions` grant array means; asking the client to re-derive that from two
JSON blobs duplicates domain knowledge in the least maintainable place. The raw
`before`/`after` still ship, so the summary is a convenience over the truth, never a
replacement for it.

### Status codes

| Code | When |
|---|---|
| `200` | success |
| `400` | invalid filter value or unparseable date |
| `401` | no valid JWT |
| `403` | lacks `audit.read` |
| `429` | rate limited |

### What the guard writes

Step 6 of the chain, after a successful execute, inside the same transaction as the
mutation. **Decision: same transaction.** A mutation that commits while its audit row
fails leaves a silent hole in the record, and a hole in an audit log is worse than no
audit log because it is trusted.

A failed request writes nothing. A `403` is a denied attempt, not a change.
**Decision:** denied attempts are not logged for the MVP — that is security monitoring, a
different job with a different retention profile, and mixing the two makes the change
history noisy.

---

## 6. Permission gates

| Element | Requires |
|---|---|
| `/app/admin/audit` route and list | `audit.read` |

Seed state ([02](02-permissions-rbac.md) § 6): **Admin only**.

`audit.create`, `audit.update`, `audit.delete` exist as rows in `permissions` — the grid
is complete, per [02](02-permissions-rbac.md) § 4 — and are **never granted to anyone**.
The system writes those rows; people do not. The matrix UI renders those three cells with
a lock icon and a tooltip: *"Audit records are written by the system and cannot be created
or modified."*

No row scoping — see § 4.

---

## 7. User experience flow

### 7.1 Primary — review recent activity

1. Admin clicks **Admin → Audit**. → Route guard passes on `audit.read`; a table skeleton
   mounts.
2. `GET /api/audit-log?page=1` returns. → A chronological table, newest first: time, actor,
   action pill, entity, entity id, and the generated summary.
3. → The header reads **"Audit log · 1,204 records"**. Filters sit in one row above the
   table: user, action, entity, date range.
4. Rows are dense and scannable. Relative times ("2 minutes ago") with the absolute UTC
   timestamp in the title attribute — relative for scanning, absolute for correlating with
   anything else.

### 7.2 Inspect a change

1. Admin clicks a row. → It expands inline to a two-column before/after view.
2. → Changed keys are highlighted; unchanged keys are collapsed behind a **"Show 12
   unchanged fields"** toggle. A raw JSON diff of a whole row is unreadable, and the
   unchanged fields are the majority of it.
3. For a create: the left column reads *"Record did not exist"*; for a delete, the right
   column reads *"Record deleted"*. Not an empty panel — an empty panel reads as a bug.
4. → A **Copy JSON** button on each side. This is how a deleted row actually gets
   reconstructed: copy the `before`, paste into the create form.

### 7.3 Trace a permission change

The flow this module exists for:

1. A Manager reports their delete button vanished.
2. Admin opens the audit log, filters **entity = roles**.
3. → One row: *"Talvin Lee · update · roles · Manager · Removed orders.delete from
   Manager · 3 days ago."*
4. Expanding it shows the exact grant arrays before and after. The question is answered in
   three clicks, without a database console.

### 7.4 Trace a deletion

1. Someone says an order is missing.
2. Admin filters **action = delete**, **entity = orders**, and searches the order id.
3. → The row shows who deleted it and when, with the complete `before` JSON.
4. Copy JSON → recreate through the Orders form. The cheap undo from § 2, working.

### 7.5 States

| State | What the user sees |
|---|---|
| **First load** | Table skeleton, 10 placeholder rows, filters already interactive |
| **Loading** | Translucent overlay on refetch; previous rows stay readable |
| **Empty (no activity)** | *"No changes recorded yet."* — expected on a fresh install, not an error |
| **Empty (filtered)** | *"No records match these filters"* + **Clear filters** — distinct copy, because the fix is different |
| **Permission denied** | No `audit.read` → nav item absent; direct URL shows the denial card |
| **Error** | "Could not load the audit log" + Retry, with filters preserved |

---

## 8. Edge cases

- **The audit write fails.** Same transaction as the mutation, so the mutation rolls back
  too. The user sees the write fail, which is correct: a change nobody can account for
  should not happen.
- **Idempotent replays.** A replayed request returns the stored response and performs no
  write, so it writes **no second audit row**. One logical change, one record. Getting
  this wrong turns every double-click into a phantom second edit in the history.
- **The actor is deleted.** `user_id` may reference a profile that no longer exists. The
  join must be a left join; the viewer renders *"Deleted user (a1b2…)"* rather than
  dropping the row. Losing history because the actor left is the failure mode this module
  exists to prevent.
- **Large `before`/`after` payloads.** An order with 20 line items produces a sizable
  blob. Fine to store; the viewer collapses long arrays behind a **Show all** toggle
  rather than rendering 200 lines inline.
- **Secrets in payloads.** Nothing here touches passwords or tokens, but the rule is
  worth stating: the guard must never write an `Authorization` header, a JWT, or a
  password field into `before`/`after`. Redact by field-name allowlist at the write site.
- **Clock consistency.** `at` is set by the database (`now()` in the transaction), never
  by the client and never by the Function's own clock. Client-supplied timestamps in an
  audit log are worthless.
- **Table growth.** Small at MVP scale. Index `(at desc)` and `(entity, at desc)` from the
  start — without them the viewer's default query gets slow well before the table gets
  big.
- **Pagination during writes.** New rows arriving while an admin pages through shift the
  offsets. **Decision:** accepted for the MVP. Keyset pagination on `(at, id)` is the fix
  if it ever matters.
  <!-- ponytail: offset pagination; switch to keyset on (at, id) if the log gets busy -->
- **Timezone.** Store and serve UTC; render in the viewer's local time with the UTC value
  in the tooltip.

---

## 9. Acceptance checks

- [ ] Create an order → exactly one `audit_log` row with `action='create'`, `before` null,
      `after` populated.
- [ ] Update an order → one row with both `before` and `after` populated, and the changed
      field visibly different between them.
- [ ] Delete an order → one row with `after` null and the full `before`; the order is gone
      from `orders`.
- [ ] Save the permission matrix → one row per changed role, `entity='roles'`, with grant
      arrays in `before` and `after`.
- [ ] Replay a request with the same `Idempotency-Key` and body → **no second audit row**.
      Verify with `SELECT count(*) FROM audit_log` before and after.
- [ ] `GET /api/export?dataset=orders` → one row with `action='export'` and the row count
      recorded.
- [ ] A request that returns `403` → **no** audit row written.
- [ ] Log in as Manager → no Audit nav item; `GET /api/audit-log` via curl → `403`.
- [ ] Attempt `DELETE`/`UPDATE` on `audit_log` as any role in the Supabase SQL editor
      under RLS → rejected.
- [ ] Filter by entity, action and date range → results match a hand-written SQL query
      with the same predicates.
- [ ] Expand a row → the diff highlights only genuinely changed keys.

---

## 10. Depends on / blocks

**Depends on:** [11-api-idempotency.md](11-api-idempotency.md) (the guard step that writes
every row — this module has no write path of its own),
[02-permissions-rbac.md](02-permissions-rbac.md) (`audit.read`),
[01-auth.md](01-auth.md) (the actor identity).

**Blocks:** nothing. P3.

**Related:** [03-admin.md](03-admin.md) (the changes most worth auditing),
[05-orders.md](05-orders.md) (the cheap-undo argument),
[08-insights-bi.md](08-insights-bi.md) (export logging),
[UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/app/admin/audit`.
