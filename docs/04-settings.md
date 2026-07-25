# 04 — Settings

## 1. Purpose

One screen, `/app/settings`, holding two kinds of configuration: **per-user preferences**
(theme, default landing page, table page size) that any signed-in user may change for
themselves, and **org-level settings** (org name, currency, fiscal year start, insight
thresholds) that only an Admin may change and which affect everyone.

Both live in the same `settings` table, separated by a `scope` column that is either the
literal string `'org'` or a user's UUID.

---

## 2. Why it exists / ERP limitation answered

`../Idea.txt` names a Settings Module as a requirement. Two smaller enhancements over the
usual ERP settings screen:

- **Preferences apply instantly, not on save.** Toggling the theme repaints immediately;
  the persistence write happens in the background. ERP settings screens that make you
  save and reload to see a visual change are the reason nobody customises them.
- **Org settings show their blast radius.** Changing the discount-alert threshold updates
  a live preview of how many insight findings that produces, so the admin is not editing a
  number in the dark.

The theme requirement itself is from `../PLAN.md`: light and dark are both first-class,
and the choice persists **per user** rather than per browser — log in on another machine
and your theme follows you.

---

## 3. Scope

**In scope**

- `settings` table, org and per-user rows
- Theme toggle (light / dark / follow system), persisted per user
- Per-user: default landing route, table page size, number formatting
- Org: org display name, currency symbol, insight thresholds
- Read on bootstrap so the first paint is already correct

**Out of scope**

- Notification preferences — there are no notifications in the MVP
- Locale / i18n / timezone selection (`../PLAN.md` § Deliberate cuts)
- Email or SMTP configuration
- Data import/export configuration — export is fixed, see [08](08-insights-bi.md)
- Feature flags, integrations, webhooks, API key management
- Account settings that belong to auth: password change, email change, account deletion.
  **Decision:** out for MVP, consistent with [01-auth.md](01-auth.md) cutting the reset
  flow.

---

## 4. Data touched

| Table | Columns | Notes |
|---|---|---|
| `settings` | `scope`, `key`, `value jsonb` | composite PK on `(scope, key)` |

`scope` is `'org'` or a user UUID as text. `value` is `jsonb` so a setting can hold a
scalar, an array or an object without a schema migration.

### Seeded keys

| Scope | Key | Example value | Who may write |
|---|---|---|---|
| user | `theme` | `"dark"` \| `"light"` \| `"system"` | the user |
| user | `default_route` | `"/app/dashboard"` | the user |
| user | `page_size` | `25` | the user |
| org | `org_name` | `"Superstore Trading Co."` | Admin |
| org | `currency` | `{"code":"USD","symbol":"$"}` | Admin |
| org | `fiscal_year_start` | `"01-01"` | Admin |
| org | `insight_discount_threshold` | `0.20` | Admin |
| org | `insight_min_loss` | `1000` | Admin |

**Decision:** the two `insight_*` keys are what stop [08-insights-bi.md](08-insights-bi.md)
being a black box. The insight rules read their thresholds from here instead of hardcoding
them, so an admin can tune sensitivity without a deploy. It costs one join and buys the
whole "why is this flagged?" conversation.

### Resolution order

A user's effective setting is: **user row → org row → code default.** A missing user row
is normal, not an error — most users never change most settings.

---

## 5. API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/settings` | resolved settings for the caller, plus the bootstrap payload |
| `PUT` | `/api/settings` | write one or more settings (mutating → needs `Idempotency-Key`) |

### `GET /api/settings`

This is also the post-login bootstrap from [01-auth.md](01-auth.md) — one round trip
gives the app shell everything it needs to paint correctly:

```json
{
  "profile":     { "user_id": "…", "full_name": "Dana Chen" },
  "role":        { "key": "manager", "name": "Manager" },
  "permissions": ["orders.read", "orders.create"],
  "scope":       { "regions": ["East"], "categories": [] },
  "settings": {
    "theme": "dark",
    "page_size": 25,
    "org_name": "Superstore Trading Co.",
    "currency": { "code": "USD", "symbol": "$" }
  }
}
```

Settings arrive already resolved — the client does not implement the fallback chain.

### `PUT /api/settings`

```json
{ "scope": "user", "values": { "theme": "light", "page_size": 50 } }
```

`scope` is `"user"` or `"org"`. Server maps `"user"` to the caller's own UUID — **a
client can never write another user's settings**, because it never gets to name the target
UUID. Writing `scope: "org"` requires `settings.update`.

### Status codes

| Code | When |
|---|---|
| `200` | written, resolved settings returned |
| `400` | unknown key, or a value failing its type check |
| `401` | no valid JWT |
| `403` | `scope: "org"` without `settings.update` |
| `409` | idempotency key reused with a different body |
| `429` | rate limited |

Unknown keys are rejected rather than stored. **Decision:** an open key-value endpoint is
a free-form write primitive attached to every user account; the allowlist keeps it a
settings API instead.

---

## 6. Permission gates

| Section | Read | Write |
|---|---|---|
| Preferences (own) | `settings.read` | none beyond authentication — a user always owns their own preferences |
| Organisation | `settings.read` | `settings.update` |

Seed state: all six roles hold `settings.read`; only Admin holds `settings.update`. So
every user reaches `/app/settings` and sees Preferences fully editable; the Organisation
section renders read-only with a "Only administrators can change these" note.

Scope does not apply — settings are not row-scoped data.

---

## 7. User experience flow

### 7.1 Primary — change theme

1. User clicks their avatar → **Settings**, or hits the theme toggle in the topbar
   directly (the toggle is duplicated there because it is the setting people actually
   change).
2. `/app/settings` mounts. Two cards: **Preferences**, then **Organisation**.
3. User clicks the theme segmented control: Light · Dark · System. → **The whole app
   repaints instantly.** `data-theme` flips on `<html>`, CSS custom properties cascade, no
   reload, no flash.
4. In the background, `PUT /api/settings` fires. → A quiet "Saved" appears next to the
   control and fades. No toast, no save button.
5. If the write fails → the control reverts with an inline message: *"Could not save your
   theme preference."* The UI must not claim a persisted state it does not have.

### 7.2 Admin edits an org setting

1. Admin scrolls to **Organisation**. Fields are editable rather than greyed.
2. Admin changes `insight_discount_threshold` from `0.20` to `0.15`. → A live preview line
   updates beneath it: *"At 15%, 2,310 order lines would be flagged (currently 1,148)."*
3. Unlike preferences, org settings use an explicit **Save** button with a dirty-state bar.
   **Decision:** instant-apply is right for a preference affecting one person and wrong for
   a value affecting everyone's dashboard.
4. Admin clicks Save → `PUT /api/settings` with `scope: "org"` and an `Idempotency-Key`.
   → Toast: *"Organisation settings updated."* An `audit_log` row is written.

### 7.3 Non-admin views org settings

1. Any non-admin opens `/app/settings`. → Preferences card fully interactive.
2. Organisation card renders with real values, all inputs disabled, one line at the top:
   *"Only administrators can change these settings."*
3. **Decision:** show them rather than hide the card. Knowing the org currency is USD is
   useful; being unable to change it is not a secret. This is the same read-only-is-useful
   argument as the permission matrix in [03-admin.md](03-admin.md) § 6.

### 7.4 First paint with a saved theme

1. User with `theme: "dark"` loads the app on a new device. → Between the HTML parsing and
   the settings response there is a window where the theme is unknown.
2. **Decision:** a tiny inline script in `index.html` reads the last theme from
   `localStorage` and sets `data-theme` before first paint; the settings response then
   confirms or corrects it. Without this you get a white flash on every cold load in dark
   mode, which looks broken.
3. `localStorage` is a **cache**, never the source of truth. The server value wins on
   arrival, so the preference genuinely follows the user across machines.

### 7.5 States

| State | What the user sees |
|---|---|
| **First load** | Card skeletons at correct heights; theme already applied from the pre-paint script |
| **Loading** | Skeleton rows; individual controls show a quiet inline spinner while saving |
| **Empty** | Not reachable — every setting has a default |
| **Permission denied** | Org card visible and disabled with the explanatory line. Missing `settings.read` entirely → nav item absent, direct URL shows the denial card |
| **Error** | Load failed → "Could not load settings" + Retry. Save failed → control reverts, inline error, value never silently lost |

---

## 8. Edge cases

- **Flash of wrong theme (FOUC).** Covered in § 7.4. The pre-paint script must be inline
  and synchronous in `<head>`; a deferred module bundle is already too late.
- **`system` theme and a live OS change.** If the user picked `system`, listen to
  `matchMedia('(prefers-color-scheme: dark)')` and repaint on change. Users do flip their
  OS theme at sunset and expect the app to follow.
- **Two tabs, one theme change.** Tab A switches to dark; tab B keeps its old value until
  reload. **Decision:** accepted. Cross-tab sync via the `storage` event is a
  three-line fix if it grates, but it is not worth a subscription channel.
- **Org setting changed while a user is mid-session.** They keep the old value until their
  next bootstrap. Same propagation model as permissions
  ([02](02-permissions-rbac.md) § 8), same reasoning: the server is authoritative, the
  client refreshes on load.
- **`jsonb` type drift.** `page_size` stored once as `25` and later as `"25"` breaks
  arithmetic silently. The key allowlist carries an expected type and the endpoint
  validates before writing.
- **Insight threshold set to something absurd.** `insight_discount_threshold: 0` flags
  every order and makes the Insights page useless. Clamp to a sane range (0.05–0.90) and
  say so in the field hint.
- **Currency is display-only.** Changing it re-labels the UI; it does **not** convert
  values. The field hint must say so, or someone will change it to EUR and believe the
  numbers converted.
- **A user's settings row after they are gone.** Orphaned rows are harmless; skip cascade
  cleanup for the MVP.

---

## 9. Acceptance checks

- [ ] Toggle theme → repaints immediately, no reload. Reload the page → the choice
      persisted, with no white flash in dark mode.
- [ ] Log in as the same user in a different browser → the theme follows.
- [ ] Log in as a non-admin → Organisation card visible, all inputs disabled.
- [ ] `PUT /api/settings` with `scope: "org"` as a non-admin via curl → `403`.
- [ ] `PUT /api/settings` with an unknown key → `400`.
- [ ] Change `insight_discount_threshold`, reload `/app/insights` → the discount finding's
      numbers move accordingly.
- [ ] Same `Idempotency-Key` + same body twice → second carries
      `Idempotency-Replayed: true`, one `audit_log` row only.
- [ ] `SELECT * FROM settings WHERE scope='org'` shows exactly the seeded org keys, no
      stray rows.

---

## 10. Depends on / blocks

**Depends on:** [01-auth.md](01-auth.md) — `GET /api/settings` *is* the bootstrap call;
[02-permissions-rbac.md](02-permissions-rbac.md) for `settings.update`;
[11-api-idempotency.md](11-api-idempotency.md) for the guard chain.

**Blocks:** the theme system used by every page; the tunable thresholds in
[08-insights-bi.md](08-insights-bi.md).

**Related:** [UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § Design tokens (the light/dark custom
properties this screen switches between), § `/app/settings`.
