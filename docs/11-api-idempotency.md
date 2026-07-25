# 11 — API, Idempotency & Anti-spam

The platform layer. No screens, no user-facing module — but every endpoint in the system
runs through it, and it is the module that answers `../Idea.txt`'s hardest single
requirement:

> *"API communication between frontend and backend that handle dedup and idempotency which
> disallow the user to spam the server."*

Read this alongside [02-permissions-rbac.md](02-permissions-rbac.md); together they are
what makes the rest of the app safe.

## 1. Purpose

`netlify/functions/_lib/guard.js` — a six-step middleware chain every Function runs before
it touches data. Verify identity, throttle abuse, collapse retries, enforce permission and
scope, execute as the user, record what happened.

Written once. A new endpoint gets all six by wrapping its handler, not by remembering six
things.

---

## 2. Why it exists / ERP limitation answered

**Duplicate records are the most common data-quality failure in every ERP.** Not a
theoretical one — every ERP deployment has a process for merging duplicate orders, and the
existence of that process is an admission the system permits them. The causes are mundane:

- A user double-clicks **Create** because the first click showed no feedback.
- The network hiccups, the client retries, and both requests land.
- The user hits refresh on a POST result and the browser resubmits.
- An impatient user hammers a button on a slow connection.

The usual mitigation is a disabled button on the client. That is a UI convention, not a
guarantee: it does nothing for the network retry, nothing for the refresh, and nothing for
anyone with curl.

This module fixes it **on the server**, where it is actually a guarantee:

1. **Idempotency keys** make a retry of the same logical request return the original
   result instead of doing the work again.
2. **Content dedup** catches the same case when no key was sent, inside a short window.
3. **Rate limiting** stops the hammering that the first two would otherwise merely absorb.

The enhancement over typical ERP is that all three are enforced centrally and verifiably —
§ 10 tests each with a curl command, so "we handle idempotency" is a claim with evidence
behind it.

---

## 3. Scope

**In scope**

- JWT verification on every request
- Postgres token-bucket rate limiting, separate read and write budgets
- `Idempotency-Key` contract: replay, conflict, expiry
- Content-hash dedup inside a 10-second window
- Permission + scope enforcement (the checks defined in
  [02-permissions-rbac.md](02-permissions-rbac.md))
- Execution as the user, so RLS applies as a second wall
- Audit write (the mechanism documented in [09-audit-log.md](09-audit-log.md))
- Consistent error envelope across every endpoint

**Out of scope**

- Distributed rate limiting with per-IP tracking — **Decision:** limits are per
  *authenticated user*, stored in Postgres. Unauthenticated requests never get past step 1,
  so there is no anonymous surface to protect. Per-IP limiting on a serverless platform
  means a shared store and an X-Forwarded-For trust decision, for a threat this design does
  not have.
- CAPTCHA, bot detection, WAF rules
- Request signing, mTLS, API keys for machine clients — the only client is the SPA
- Circuit breakers, retry-with-backoff on the server side
- GraphQL, REST resource nesting, HATEOAS. Endpoints are flat and few.
- Response caching / ETags — **Decision:** the data is small and scope-dependent; a cache
  keyed by user scope is a correctness risk for a latency win nobody has asked for.

---

## 4. Data touched

| Table | Columns | Written by |
|---|---|---|
| `idempotency_keys` | `key` PK, `user_id`, `endpoint`, `body_hash`, `response jsonb`, `status`, `created_at` | step 3 |
| `rate_limits` | `user_id`, `window_start`, `count` | step 2 |
| `audit_log` | see [09](09-audit-log.md) § 4 | step 6 |
| `profiles`, `roles`, `role_permissions` | read, via `has_perm()` / `in_scope()` | step 5 |

`idempotency_keys.status` tracks the lifecycle: `in_progress` → `completed`. That
distinction is what makes concurrent duplicate requests work — see § 6.3.

**Retention.** Keys older than 24 hours are deleted. **Decision:** a `pg_cron` job if the
free tier allows it, otherwise an opportunistic delete of expired rows on each write. A
key table that grows forever is a slow leak, and 24 hours far exceeds any legitimate
retry window.

---

## 5. The chain

Every request, in this order. Each step can terminate the request; nothing downstream runs
if it does.

```
1. Verify JWT          -> 401
2. Rate limit          -> 429 + Retry-After
3. Idempotency         -> replay 200 | 409
4. Content dedup       -> collapse to first result
5. Permission + scope  -> 403
6. Execute + store + audit
```

The order is deliberate and not rearrangeable:

- **Rate limiting before idempotency.** Otherwise an attacker's flood does key lookups
  and writes before being throttled, and the throttle is doing work proportional to the
  attack.
- **Idempotency before permission.** A replay must return the *original* response — the
  same status, the same body — even if the caller's permissions changed since. The stored
  response is the truth about what happened, not a fresh evaluation.
- **Permission before execute**, obviously.
- **Audit inside the execute transaction**, per [09](09-audit-log.md) § 5.

### Step 1 — Verify JWT

Bearer token from the `Authorization` header, verified against Supabase's JWKS. Missing,
malformed, expired, or bad signature → `401`. No audit row: an unidentified request has no
actor to record.

The verified token is then used to construct a `supabase-js` client **as the user**, which
is what makes RLS apply at step 6.

### Step 2 — Rate limit

Postgres token bucket keyed on `user_id`:

| Budget | Limit |
|---|---|
| Reads | 60 requests / minute |
| Writes | 20 requests / minute |
| `/api/export` | 5 requests / minute ([08](08-insights-bi.md) § 10) |

Over budget → `429` with a `Retry-After` header in seconds. Separate budgets because a
user paging through a table legitimately makes many reads, and no legitimate user makes 20
writes a minute by hand.

**Decision:** Postgres rather than an in-memory counter. Netlify Functions are stateless
and horizontally scaled — an in-memory counter resets per cold start and per instance,
which means it does not limit anything. The extra round trip is the cost of the guarantee.
<!-- ponytail: one extra query per request; move to Redis only if a profiler says it hurts -->

### Step 3 — Idempotency

**Every mutating request must send an `Idempotency-Key` header.** Missing → `428
Precondition Required`. Failing loudly during development is what stops an unprotected
write path from shipping.

Server computes `body_hash = sha256(canonical_json(body))` and looks up the key:

| Situation | Response |
|---|---|
| Key not seen | insert `(key, user, endpoint, body_hash, status='in_progress')`, continue |
| Key seen, **same** `body_hash`, `status='completed'` | replay the stored response with `Idempotency-Replayed: true`. **No execution, no audit row.** |
| Key seen, **same** hash, `status='in_progress'` | `409` with `Retry-After: 1` — a concurrent duplicate is still running |
| Key seen, **different** `body_hash` | `409 Conflict` — the key was reused for a different request, which is a client bug |
| Key older than 24h | treated as unseen |

The key is scoped to `(key, user_id)`. One user's key can never collide with another's.

`canonical_json` matters: key order and whitespace must not change the hash, or a
semantically identical retry looks like a different body and gets a spurious `409`.

### Step 4 — Content dedup

The safety net for when no key was sent, or when a double-click generated two keys.

Hash `(user_id, endpoint, body_hash)`; if an identical hash was seen within **10 seconds**
and completed, collapse to that first result — same response, `Idempotency-Replayed: true`.

**Decision:** 10 seconds. Long enough to cover a double-click and a fast retry; short
enough that a user legitimately creating two identical records (same customer, same
product, same quantity, twice in a row) is not blocked. That legitimate case is rare but
real, and a window measured in minutes would break it.

This is belt-and-braces. Step 3 is the contract; step 4 is what saves you when a client
forgets it.

### Step 5 — Permission + scope

`has_perm(module, action)` → `403` if false.
`in_scope(region, category)` on the target row → `403` if false.

For a create, scope is checked against the **submitted** region and category, not an
existing row — otherwise scope is escapable by writing yourself into another region
([05](05-orders.md) § 6).

Full semantics in [02-permissions-rbac.md](02-permissions-rbac.md).

### Step 6 — Execute, store, audit

Execute the handler using the **user's** Supabase client, so RLS re-checks everything
step 5 just checked. Then, in the same transaction:

- store the response body and status against the idempotency key, `status='completed'`
- write the `audit_log` row

One transaction. If the audit write fails, the mutation rolls back
([09](09-audit-log.md) § 8). If the handler throws, the idempotency key row is marked
failed and deleted so a retry can proceed — **a failed request must not be replayable as a
success.**

---

## 6. Contracts

### 6.1 Request headers

| Header | Required | Notes |
|---|---|---|
| `Authorization: Bearer <jwt>` | always | |
| `Idempotency-Key: <uuid>` | all mutations | client-generated UUID v4 |
| `Content-Type: application/json` | with a body | |

### 6.2 Response headers

| Header | When |
|---|---|
| `Idempotency-Replayed: true` | the response came from storage, not from execution |
| `Retry-After: <seconds>` | on `429`, and on the `in_progress` `409` |
| `X-RateLimit-Remaining` | **Decision:** always on `2xx`, so a client can back off before being throttled |

### 6.3 Client rules

Three rules the SPA must follow, and the first is the one everything depends on:

1. **Generate the key when the form opens, not when submit is clicked.** A key generated
   at submit time is a *new* key per click, and two clicks produce two keys, two hashes,
   and — but for step 4 — two records. Generating at form-open makes every click of that
   form the same logical request.
2. **Reuse the same key on retry**, including after a re-authentication
   ([01](01-auth.md) § 8).
3. **Generate a fresh key after a success.** The next create is a genuinely new request.

### 6.4 Error envelope

Every non-2xx response, from every endpoint, same shape:

```json
{
  "error": {
    "code": "out_of_scope",
    "message": "This record is outside your assigned region (East).",
    "status": 403,
    "details": { "region": "West" }
  }
}
```

`message` is user-facing English, written to be rendered directly. **Decision:** the API
writes the human message rather than the client mapping codes to strings — one place to
get the wording right, and the server is the only party that knows *which* region was the
problem.

### 6.5 Status code table

| Code | Meaning | Where |
|---|---|---|
| `200` / `201` | success | all |
| `400` | malformed request or invalid parameter | all |
| `401` | missing / invalid / expired JWT | step 1 |
| `403` | permission denied or out of scope | step 5 |
| `409` | idempotency key reused with a different body; concurrent duplicate; delete blocked by dependents | step 3, [06](06-products-customers.md) |
| `422` | referential integrity failure | handlers |
| `428` | mutating request without `Idempotency-Key` | step 3 |
| `429` | rate limit exceeded | step 2 |
| `500` | unhandled — never leaks a stack trace or a Postgres message to the client | all |

---

## 7. API surface — endpoint inventory & permission gates

Every endpoint in the system, from `../PLAN.md` § API contract:

| Method | Path | Guard notes |
|---|---|---|
| GET/POST/PATCH/DELETE | `/api/orders` | scoped list + CRUD |
| GET/POST/PATCH/DELETE | `/api/products` | same shape |
| GET/POST/PATCH/DELETE | `/api/customers` | same shape |
| GET | `/api/metrics` | read budget; scope on aggregates |
| GET | `/api/insights` | read budget; scope on aggregates |
| GET | `/api/export?dataset=` | tighter 5/min budget; **writes an audit row** |
| GET/PUT | `/api/admin-roles` | PUT is a full-state replace |
| GET/PATCH | `/api/admin-users` | |
| GET | `/api/audit-log` | read-only; no write endpoint exists by design |
| GET/PUT | `/api/settings` | GET doubles as the post-login bootstrap |

`_lib/` holds `guard.js`, `idempotency.js`, `ratelimit.js`, `audit.js`, `supa.js`.

**Permission gates.** This module has none of its own — it is the mechanism that *enforces*
everyone else's. Each endpoint declares the `(module, action)` pair step 5 checks it
against; those pairs are listed in the owning module doc's § Permission gates, and the
semantics live in [02-permissions-rbac.md](02-permissions-rbac.md). Adding an endpoint
without declaring its pair is a build error, not a permissive default — the guard **fails
closed**.

---

## 8. User experience flow

This module has no UI, but its behaviour is felt on every screen.

### 8.1 The double-click — what the user should experience

1. User double-clicks **Create order**. Two requests leave the browser, same key, same
   body.
2. Request A inserts the key as `in_progress`, executes, stores its response, commits.
3. Request B finds the key. If A has finished → replay. If A is still running → `409` with
   `Retry-After: 1`, and the client retries once, then replays.
4. → **The user sees one success toast and one new row.** No warning, no "duplicate
   detected" message. The correct experience of an anti-duplication system is that nothing
   noticeable happens.

### 8.2 Hitting the rate limit

1. A user (or a demo script) fires 25 writes in a minute.
2. Request 21 → `429` with `Retry-After: 34`.
3. → The UI shows a specific, non-alarming message: *"Too many requests. Try again in 34
   seconds."* Counting down. **Never** a generic "Something went wrong" — the user needs to
   know it is temporary and exactly how temporary.
4. Submit buttons across the app disable for the duration, then re-enable.

### 8.3 A stale key conflict

1. A client bug reuses a key with different data → `409`.
2. → *"This request conflicts with an earlier one. Please refresh and try again."* The
   client generates a fresh key on the next form open, which resolves it.

### 8.4 Feedback timing

The reason people double-click is that the first click did nothing visible.

1. On submit, the button enters a loading state **immediately** — before the request is
   even constructed.
2. If the response takes over 400 ms, the loading state is unambiguous (spinner plus
   "Creating…"), not a subtle opacity change.
3. The button stays disabled until the response lands, success or failure.

Client-side prevention plus server-side guarantee. The client makes duplicates unlikely;
the server makes them impossible.

### 8.5 States

| State | What the user sees |
|---|---|
| **Loading** | Button spinner, form still readable, no full-screen block |
| **Rate limited** | Countdown message, submit disabled until it expires |
| **Conflict** | Explanatory message with a clear next action |
| **Auth expired** | Re-auth in place, form preserved, retry with the same key |
| **Server error** | *"Something went wrong on our end."* No stack trace, no Postgres text — those go to the Function log |

---

## 9. Edge cases

- **Key generated at submit instead of form-open.** The single most likely implementation
  mistake in this module, and it silently defeats step 3 entirely — step 4 then quietly
  covers for it, so the bug ships undetected. § 10's curl test is what catches it.
- **Non-canonical JSON hashing.** `{"a":1,"b":2}` and `{"b":2,"a":1}` must hash
  identically. Otherwise a retry from a client that reorders keys gets a spurious `409`.
- **Concurrent duplicates.** Two identical requests racing before either completes. The
  `in_progress` status plus a unique constraint on `key` is what makes this correct — the
  second insert fails the constraint, reads the row, and sees `in_progress`. Without the
  status column both requests would find no completed record and both would execute.
- **A failed request's key.** If the handler throws, the key must be released, not left as
  `in_progress` (blocking every retry for 24 hours) and not marked `completed` (replaying a
  failure as success forever).
- **Replaying a `403`.** A replay returns the stored response, including its status. If
  the original was denied, the replay is denied identically — correct, because it is the
  same request.
- **Netlify Function cold starts** add latency but nothing else; every piece of state is in
  Postgres precisely so a fresh instance behaves identically to a warm one.
- **Clock skew on `Retry-After`.** Compute it as a duration in seconds from the server's
  own clock, never as an absolute timestamp the client must compare against its own.
- **Rate limit and the demo.** Six roles being demoed in quick succession is well inside
  60 reads/minute, but a reviewer clicking rapidly through every page could approach it.
  The limits above are chosen with that in mind; do not lower them for the demo.
- **`503` from Supabase.** The free tier can be slow or briefly unavailable. Surface it as
  a `500` with the friendly message and log the detail; do not retry server-side, which
  turns one slow request into three.
- **Body size.** Cap request bodies at 1 MB. Netlify has its own limit; failing early with
  a clear `400` beats a platform-level error the client cannot interpret.

---

## 10. Acceptance checks

Every check is one curl command. Run them and record the actual output — this is the
module where "it works" without evidence is worth nothing.

- [ ] **Replay:** same `Idempotency-Key` + same body, twice →
      one row created; the second response carries `Idempotency-Replayed: true`.
      Verify with `SELECT count(*)`.
- [ ] **Conflict:** same key + different body → `409`.
- [ ] **Missing key:** `POST /api/orders` with no `Idempotency-Key` → `428`.
- [ ] **Rate limit:** 25 writes inside one minute → `429` with a `Retry-After` header.
- [ ] **Read budget:** 61 reads inside one minute → `429`.
- [ ] **Export budget:** 6 exports inside one minute → `429`.
- [ ] **Dedup without a key:** two identical requests within 10 seconds, no key → one row.
- [ ] **Dedup window expiry:** the same two, 15 seconds apart → two rows (the legitimate
      duplicate case still works).
- [ ] **UI double-click:** double-click Create in the browser → exactly one row in
      `orders`.
- [ ] **No JWT:** any endpoint with no `Authorization` header → `401`, and no `audit_log`
      row.
- [ ] **Tampered JWT:** a modified signature → `401`.
- [ ] **Permission:** Viewer `POST /api/orders` → `403`.
- [ ] **Scope:** East Manager `PATCH` a West order → `403`.
- [ ] **Replay writes no audit row:** count `audit_log` before and after a replay →
      unchanged.
- [ ] **Failed handler releases the key:** force a handler error, then retry with the same
      key → the retry executes rather than replaying the failure.
- [ ] **RLS second wall:** disable the step-5 check in a local branch → the same requests
      still fail, proving RLS is enforcing independently.
- [ ] **No secrets in the bundle:** grep the built client JS for `service_role` → no match.
- [ ] **Error envelope:** every non-2xx response across all endpoints has the § 6.4 shape.

---

## 11. Depends on / blocks

**Depends on:** [01-auth.md](01-auth.md) (the JWT it verifies),
[02-permissions-rbac.md](02-permissions-rbac.md) (the SQL helpers step 5 calls),
`01_schema.sql` for `idempotency_keys` and `rate_limits`.

**Blocks:** **every endpoint in the system.** P0, item 5 in `../PLAN.md`'s build order,
before any business module. Building an endpoint before the guard means retrofitting six
concerns into a handler that already works, which is how they end up half-applied.

**Related:** [09-audit-log.md](09-audit-log.md) (step 6's output),
[05-orders.md](05-orders.md) (the module where idempotency is most visibly demonstrated),
[08-insights-bi.md](08-insights-bi.md) (export budget and audit).
