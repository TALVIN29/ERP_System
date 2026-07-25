# 01 — Authentication

## 1. Purpose

Establishes who the user is and hands the rest of the app two things: a JWT for calling
the API, and the user's permission set plus row scope for rendering the UI. Email +
password, backed by Supabase Auth. Every authenticated route in the SPA sits behind this
module; every Netlify Function starts by verifying the token it issues.

Auth answers *who are you*. It does not answer *what may you do* — that is
[02-permissions-rbac.md](02-permissions-rbac.md). Keep the seam clean: this module never
hardcodes a role check.

---

## 2. Why it exists / ERP limitation answered

Two problems in typical ERP login flows:

- **The user lands somewhere generic and has to find their own way.** Here the permission
  set is fetched as part of the login handshake, so the first painted screen is already
  tailored — a Warehouse user never sees a Finance nav item flash and then disappear.
- **Session expiry is discovered by a failed save.** You fill a form for two minutes, hit
  Create, and lose it to a 401. This module treats an expired session mid-form as a
  first-class case: refresh silently where possible, and where not, preserve the form
  state across the re-login.

---

## 3. Scope

**In scope**

- Email + password signup with email confirmation **ON**
- Login, logout, session persistence across reload
- Session context provider that exposes `{ user, profile, permissions, scope, loading }`
- Route guard for everything under `/app/*`
- Demo role-switcher on the login screen (6 pre-seeded confirmed users)
- Token refresh, and 401 handling on any API call

**Out of scope**

- OAuth / social login / magic links / SSO
- Password reset flow — **Decision:** cut for MVP; it depends on the same rate-limited
  transactional email that forced the demo-user workaround below. Supabase's hosted reset
  page remains available if genuinely needed.
- MFA, session device management, "remember me" duration controls
- Multi-tenancy — one org, one user pool

---

## 4. Data touched

| Table | Columns | Notes |
|---|---|---|
| `auth.users` | managed by Supabase | `email_confirmed_at` is pre-set for the 6 demo users |
| `profiles` | `user_id` PK → `auth.users`, `full_name`, `role_id`, `scope_regions text[]`, `scope_categories text[]` | created on signup; role assigned by an Admin afterwards |
| `roles` | `id`, `key`, `name`, `is_system` | joined for the role key |
| `role_permissions` → `permissions` | | joined to build the permission set returned at login |

A profile row must exist for every auth user. **Decision:** create it with a Postgres
trigger on `auth.users` insert, defaulting `role_id` to the `viewer` role and both scope
arrays to `{}`. A signup that lands without a profile is a user who can log in and see
nothing, which is a confusing failure — the trigger removes that class of bug.

---

## 5. API surface

Auth itself goes through `supabase-js` in the browser (the one exception to the
"everything through Functions" rule — it is the session handshake, no business data
crosses it). Everything after login goes through Functions.

| Call | Where | Purpose |
|---|---|---|
| `supabase.auth.signUp({ email, password })` | browser | creates the user, sends the confirmation email |
| `supabase.auth.signInWithPassword({ email, password })` | browser | returns session + JWT |
| `supabase.auth.signOut()` | browser | clears the local session |
| `supabase.auth.onAuthStateChange` | browser | drives the session context |
| `GET /api/settings` | Function | **Decision:** the post-login bootstrap. Returns `{ profile, role, permissions[], scope, settings }` in one round trip so the app shell paints once. Reuses the existing settings endpoint rather than adding a `/api/me`. |

### Bootstrap response shape

```json
{
  "profile":     { "user_id": "…", "full_name": "Dana Chen" },
  "role":        { "key": "manager", "name": "Manager" },
  "permissions": ["orders.read", "orders.create", "orders.update", "insights.read"],
  "scope":       { "regions": ["East"], "categories": [] },
  "settings":    { "theme": "dark" }
}
```

`permissions` is a flat array of `module.action` strings — cheapest thing for the client
to hold in a `Set` and check with `perms.can('orders','create')`.

### Status codes

| Code | When |
|---|---|
| `200` | session valid, bootstrap returned |
| `401` | missing, malformed, or expired JWT — client must re-authenticate |
| `429` | rate limit (shared with every endpoint, see [11](11-api-idempotency.md)) |

---

## 6. Permission gates

None. This module is what *produces* permissions; it cannot consume them. The only gate
is authentication itself: `/app/*` requires a session, `/`, `/login`, `/signup` do not.

One nuance worth stating: a user with a valid session but **zero** permissions is not an
error. They log in successfully and land on a "no modules assigned, contact your
administrator" state. That is the correct behaviour for a freshly signed-up user awaiting
role assignment.

---

## 7. User experience flow

### 7.1 Primary — demo login (the path the demo actually uses)

1. User lands on `/login`. Below the email/password fields sits a row of six role chips:
   Admin · Manager · Analyst · Viewer · Finance · Warehouse.
2. User clicks **Manager**. → The email and password fields fill with that demo account's
   credentials. Nothing is submitted yet; the user can see exactly what is about to be
   sent.
3. User clicks **Sign in**. → Button enters a loading state and disables. `signInWithPassword`
   fires.
4. Session returns. → The app immediately calls the bootstrap endpoint. The screen shows a
   brief skeleton of the app shell rather than a spinner on a blank page.
5. Bootstrap returns. → Redirect to `/app/dashboard`. The sidebar renders with exactly the
   nav items this role's permissions allow — Orders and Insights present, Admin absent.

### 7.2 Real signup

1. User clicks the landing page CTA → `/signup`.
2. Fills name, email, password. Password strength shown inline; submit stays disabled
   until it passes.
3. Submits. → "Check your email to confirm your account." The user is **not** logged in
   yet. The screen stays put and shows the address the mail went to, with a "wrong
   address?" link back to the form.
4. User clicks the emailed link. → Supabase confirms the account, redirects to `/login`
   with a success banner.
5. First login lands on `/app/dashboard` with the empty-permissions state, because their
   seeded role is Viewer with no assignments. An Admin grants them a role from
   [03-admin.md](03-admin.md) § Users.

### 7.3 Return visit

1. User opens the site with a stored session. → The session context resolves from local
   storage before first paint; the bootstrap call fires in parallel.
2. If the stored token is expired, `supabase-js` refreshes it silently. The user sees a
   skeleton, not a login screen.
3. If the refresh token is also dead, → redirect to `/login` with an "your session
   expired" banner and the intended path preserved in state, so login returns them there.

### 7.4 Logout

1. User opens the avatar menu in the topbar → **Sign out**.
2. `signOut()` clears the session, the context resets, → redirect to `/`.
3. **Decision:** wipe the cached permission set on logout. Leaving it in memory means the
   next user on a shared machine gets a flash of the previous user's nav.

### 7.5 States

| State | What the user sees |
|---|---|
| **First load** | App shell skeleton — sidebar and topbar outlines, no content flash |
| **Loading** | Submit button disabled with an inline spinner; fields stay readable, not greyed to illegibility |
| **Empty** | Logged in, zero permissions: centered card, "No modules assigned yet", admin contact line |
| **Permission denied** | Not applicable here — see § 6 |
| **Error** | Inline under the form, never a toast that can be missed: "Email or password is incorrect", "Please confirm your email first", "Too many attempts, try again in 60s" |

---

## 8. Edge cases

- **Free-tier email wall.** Supabase free tier sends roughly **2 confirmation emails per
  hour**. A live signup during a demo will hit it. Mitigation is structural: the 6 demo
  users are seeded directly with `email_confirmed_at` pre-set, and the login screen has
  the role switcher. The real signup flow exists and works — the demo just never depends
  on it. Say this out loud when demoing; it reads as foresight, not as a gap.
- **Unconfirmed user tries to log in.** Supabase returns an error mentioning confirmation.
  Map it to a specific message with a "resend confirmation" action, not the generic
  "invalid credentials" — otherwise the user retypes their correct password five times.
- **Session expires mid-form.** An API call returns 401 while a create/edit drawer is
  open. Do not blow away the form. Show a re-auth prompt over the drawer; on success,
  retry the original request with the same `Idempotency-Key`. See
  [11-api-idempotency.md](11-api-idempotency.md) § Retry semantics.
- **Signup with an email that already exists.** Supabase deliberately does not confirm
  whether the address is registered (account enumeration). Do not try to defeat that —
  show the neutral "check your email" state and move on.
- **Profile row missing.** Bootstrap returns a profile-less user. Treat as the
  zero-permission empty state, and log it — it means the signup trigger failed.
- **Two tabs, one logout.** `onAuthStateChange` fires across tabs. The second tab must
  react and redirect, not sit there with a dead token issuing 401s.
- **Clock skew.** A client whose clock is minutes ahead can consider a valid token
  expired. Rely on the Supabase client's own refresh handling rather than comparing `exp`
  against `Date.now()` yourself.

---

## 9. Acceptance checks

Run each and record the actual output.

- [ ] Log in as each of the 6 demo users. Screenshot the sidebar each time — Viewer shows
      no Create button anywhere; Warehouse shows no Finance-only module.
- [ ] Reload the page while logged in → lands back on the same route, no login flash.
- [ ] `supabase.auth.signOut()` then hit `/app/dashboard` directly → redirected to
      `/login`.
- [ ] Call any `/api/*` endpoint with no `Authorization` header → `401`.
- [ ] Call any `/api/*` endpoint with a hand-mangled JWT → `401`, and no row appears in
      `audit_log` for it.
- [ ] Sign up a fresh address → confirmation email arrives, link confirms, first login
      shows the zero-permission state.
- [ ] Grep the built client bundle for `service_role` → no match.

---

## 10. Depends on / blocks

**Depends on:** Supabase project with Auth enabled; `04_seed.sql` for the demo users;
`01_schema.sql` for `profiles`.

**Blocks:** everything. [02](02-permissions-rbac.md) needs the JWT and the permission set,
[11](11-api-idempotency.md)'s guard chain opens with JWT verification, and every `/app/*`
route sits behind the guard this module installs.

**Related:** [02-permissions-rbac.md](02-permissions-rbac.md) (consumes the permission
set), [03-admin.md](03-admin.md) (assigns the roles this module reads),
[UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/login`, § `/signup`.
