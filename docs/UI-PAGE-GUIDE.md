# UI Page Guide

Page-by-page build guide for every route in `../PLAN.md`. Each section names the route, its
owning module doc, the permission needed to reach it, a wireframe, the components it is
made of, its five states, its interactions and animation, responsive behaviour and
accessibility notes.

Read [00-overview.md](00-overview.md) first for the system map, and the owning module doc
for the data and API behind any page.

**Two shared sections come first** — App shell and Design tokens — because every
authenticated page sits inside the shell and every page uses the tokens.

---

## Contents

| Route | Owning doc | Permission |
|---|---|---|
| [App shell](#app-shell) | — | — |
| [Design tokens](#design-tokens) | — | — |
| [`/`](#-landing) | [10](10-landing.md) | public |
| [`/login`](#login) | [01](01-auth.md) | public |
| [`/signup`](#signup) | [01](01-auth.md) | public |
| [`/app/dashboard`](#appdashboard) | [07](07-dashboard-metrics.md) | `insights.read` |
| [`/app/insights`](#appinsights) | [08](08-insights-bi.md) | `insights.read` |
| [`/app/orders`](#apporders) | [05](05-orders.md) | `orders.read` |
| [`/app/products`](#appproducts) | [06](06-products-customers.md) | `products.read` |
| [`/app/customers`](#appcustomers) | [06](06-products-customers.md) | `customers.read` |
| [`/app/admin/roles`](#appadminroles) | [03](03-admin.md) | `roles.read` |
| [`/app/admin/users`](#appadminusers) | [03](03-admin.md) | `users.read` |
| [`/app/admin/audit`](#appadminaudit) | [09](09-audit-log.md) | `audit.read` |
| [`/app/settings`](#appsettings) | [04](04-settings.md) | `settings.read` |

---

## App shell

Wraps every `/app/*` route. Built once in `src/layout/`.

```
+----------------------------------------------------------------------+
| [logo] Superstore ERP        [scope: East]  [theme]  [avatar Dana v]  |  topbar 56px
+----------------+-----------------------------------------------------+
|                |                                                     |
| Dashboard      |                                                     |
| Insights       |   <Outlet />                                        |
| Orders         |                                                     |
| Products       |                                                     |
| Customers      |                                                     |
|                |                                                     |
| ADMIN          |                                                     |
|  Roles         |                                                     |
|  Users         |                                                     |
|  Audit         |                                                     |
|                |                                                     |
| Settings       |                                                     |
+----------------+-----------------------------------------------------+
   sidebar 240px
```

### Permission-driven navigation

**The rule that defines this app's UX:** nav items render from the permission set returned
at login ([01](01-auth.md) § 5). A user never sees a control they cannot use.

```
navItems.filter(item => perms.can(item.module, 'read'))
```

- The **ADMIN** group renders only if the user holds at least one of `roles.read`,
  `users.read`, `audit.read` — a user with only `audit.read` sees the group with one item,
  never an empty container.
- Items are **absent**, not disabled. A disabled nav item is an invitation to ask why.
- The nav renders after the permission set arrives, so nothing flashes and vanishes.

### Topbar

| Element | Behaviour |
|---|---|
| **Scope chip** | Always present. Reads "East" or "All regions". Hover explains it. The single most important affordance in the shell — it is what stops scoped totals reading as a bug ([07](07-dashboard-metrics.md) § 7.4) |
| **Theme toggle** | Instant repaint, persisted per user ([04](04-settings.md) § 7.1) |
| **Avatar menu** | Full name, role name, Settings, Sign out |

### Components

`src/layout/` — `AppShell.jsx`, `Sidebar.jsx`, `Topbar.jsx`, `NavItem.jsx`,
`ScopeChip.jsx`, `ThemeToggle.jsx`, `UserMenu.jsx`, `RouteGuard.jsx`.

### Responsive

| Width | Behaviour |
|---|---|
| ≥ 1024px | Sidebar fixed open |
| 768–1023px | Sidebar collapses to icons, labels on hover |
| < 768px | Sidebar becomes a drawer behind a hamburger; topbar keeps scope chip and avatar |

### Accessibility

`<nav>` landmark with `aria-current="page"` on the active item. Skip-to-content link as
the first focusable element. Focus order: skip link → nav → topbar → content. Focus is
visible everywhere; never `outline: none` without a replacement.

---

## Design tokens

`src/styles/tokens.css`. CSS custom properties on `:root`, swapped by `data-theme` on
`<html>`. Values are the validated `dataviz` reference palette — if they change, re-run
the palette validator against the new surfaces rather than eyeballing.

```css
:root {
  color-scheme: light;
  --surface-page:    #f9f9f7;
  --surface-card:    #fcfcfb;
  --surface-sunken:  #f0efec;
  --text-primary:    #0b0b0b;
  --text-secondary:  #52514e;
  --text-muted:      #898781;
  --border-hairline: rgba(11,11,11,0.10);
  --gridline:        #e1e0d9;
  --baseline:        #c3c2b7;

  --series-1: #2a78d6;  --series-2: #eb6834;
  --series-3: #1baf7a;  --series-4: #eda100;

  --status-good:     #0ca30c;
  --status-warning:  #fab219;
  --status-serious:  #ec835a;
  --status-critical: #d03b3b;

  --delta-up: #006300;  --delta-down: #d03b3b;

  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --radius-sm: 4px;  --radius-md: 8px;  --radius-lg: 12px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --surface-page:    #0d0d0d;
  --surface-card:    #1a1a19;
  --surface-sunken:  #232322;
  --text-primary:    #ffffff;
  --text-secondary:  #c3c2b7;
  --text-muted:      #898781;
  --border-hairline: rgba(255,255,255,0.10);
  --gridline:        #2c2c2a;
  --baseline:        #383835;

  --series-1: #3987e5;  --series-2: #d95926;
  --series-3: #199e70;  --series-4: #c98500;

  --delta-up: #0ca30c;
}
```

**Rules**

- Dark is **selected**, not a filter-inverted light. Each series has its own dark step.
- Status colors are **fixed across themes** and never reused as a chart series. They always
  ship with an icon and a text label — color alone never carries meaning.
- Text wears text tokens, never a series color. A colored mark sits *beside* a label.
- Tailwind v4 is configured over these custom properties, so utility classes and chart code
  read from one source.
- One typeface throughout, including large numbers. `tabular-nums` only in table columns
  and axis ticks; proportional figures for KPI values.

### Pre-paint theme script

Inline and synchronous in `index.html` `<head>`, before any bundle — otherwise dark-mode
users get a white flash on every cold load ([04](04-settings.md) § 7.4):

```html
<script>
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches))
      document.documentElement.dataset.theme = 'dark';
  } catch (e) {}
</script>
```

`localStorage` is a cache; the server value from settings wins on arrival.

### Motion

| Library | Used for | Where |
|---|---|---|
| **GSAP** | scroll parallax, scroll reveals | `/` only |
| **anime.js** | KPI count-ups, matrix checkbox pulse | dashboard, roles |
| **Chart.js** | line, bar, donut | dashboard |
| **D3** | profit-vs-discount scatter | insights |

`prefers-reduced-motion: reduce` disables **all** of the above. Content renders in its
final state; nothing is lost but movement.

---

## `/` — Landing

**Owning doc:** [10-landing.md](10-landing.md) · **Permission:** public · **No app shell**

```
+----------------------------------------------------------------------+
| [logo]                              Sign in   [ Get started ]        |  sticky
+----------------------------------------------------------------------+
|                                                                      |
|   [ full-bleed warehouse photo, gradient scrim, GSAP parallax ]      |
|                                                                      |
|   Your ERP tells you what happened.                                  |
|   This one tells you what to do.                                     |
|   [ Start free ]   See the dashboard v                               |
+----------------------------------------------------------------------+
|  9,994          $2.29M          17              20%                  |
|  order lines    revenue         margin leaks    break-even discount  |  count-up
+----------------------------------------------------------------------+
|  [photo]  |  Insight, not just charts                                |
|           |  Every finding carries a recommended action.             |  reveal
+----------------------------------------------------------------------+
|  Permissions you can see          |  [matrix screenshot]             |  reveal
+----------------------------------------------------------------------+
|  [photo]  |  No duplicate records, ever                              |  reveal
+----------------------------------------------------------------------+
|         [ real /app/dashboard screenshot, light + dark ]             |
+----------------------------------------------------------------------+
|  Free tier · 6 demo roles · no card required                         |
|  $231 in margin lost per day at 20%+ discount   [ 04.71 ticking ]    |  FOMO
|  Analysed on 9,994 real order lines · [github]                       |
|                        [ Find yours — start free ]                   |
+----------------------------------------------------------------------+
|  footer: dataset credit · Unsplash credit · repo                     |
+----------------------------------------------------------------------+
```

**Components** — `src/pages/Landing.jsx` with `components/landing/`: `Hero`, `StatBand`,
`FeatureRow`, `ScreenshotFrame`, `FomoBand`, `TickingCounter`, `LandingHeader`,
`LandingFooter`.

**States**

| State | Treatment |
|---|---|
| First load | Hero photo + headline in the first paint; below-fold sections pre-reveal |
| Loading | None — no data to fetch. Photos use a blurred placeholder |
| Empty | N/A |
| Permission denied | N/A — public |
| Error | A failed image falls back to a solid token block; text stays legible over it |

**Interactions & animation** — GSAP ScrollTrigger: hero parallax at 0.5× scroll, feature
rows fade + 24px rise over ~500 ms. anime.js counts the stat band up once on first entry,
not on every scroll-back. The FOMO counter ticks live. Header gains a background on scroll.

**Responsive** — Parallax disabled below 768px (janky on touch, fights the mobile URL bar).
Feature rows stack. Stat band goes 4-up → 2×2 → 1 column.

**Accessibility** — Reduced motion kills every animation. Every image has real alt text.
Headline contrast checked against the photo scrim in **both** themes. The stat band
reserves final digit width so the count-up does not reflow the layout.

---

## `/login`

**Owning doc:** [01-auth.md](01-auth.md) · **Permission:** public · **No app shell**

```
+---------------------------+------------------------------------------+
|                           |                                          |
|   [ warehouse photo ]     |   Sign in                                |
|                           |   Email    [____________________]        |
|   "Above 20% discount     |   Password [____________________]        |
|    every order loses      |            [ Sign in ]                   |
|    money."                |                                          |
|                           |   — or try a demo role —                 |
|                           |   [Admin] [Manager] [Analyst]            |
|                           |   [Viewer] [Finance] [Warehouse]         |
|                           |                                          |
|                           |   No account? Sign up                    |
+---------------------------+------------------------------------------+
```

**Components** — `src/pages/Login.jsx`: `AuthLayout`, `TextField`, `PasswordField`,
`DemoRoleChips`, `Button`, `InlineError`.

**The demo role chips are the most important element on this page.** Clicking one fills
the credentials **without submitting**, so the user sees exactly what is about to be sent.
Six chips, one per role, labelled with the role name and its scope
("Manager · East"). This is what makes the whole RBAC story demonstrable in two clicks and
what routes around the free-tier email limit ([01](01-auth.md) § 8).

**States**

| State | Treatment |
|---|---|
| First load | Form focused on email; photo panel already painted |
| Loading | Button spinner, fields stay readable, not greyed illegible |
| Empty | N/A |
| Permission denied | N/A |
| Error | **Inline under the form**, never a dismissable toast: "Email or password is incorrect" · "Please confirm your email first" + Resend · "Too many attempts, try again in 60s" |

**Interactions** — Enter submits. Chips fill and focus the submit button. On success, a
brief app-shell skeleton rather than a spinner on a blank page. A session that expired
elsewhere shows a banner and preserves the intended path for post-login redirect.

**Responsive** — Photo panel hidden below 768px; form centres full-width. Chips wrap to a
3×2 grid.

**Accessibility** — Real `<label>` elements, not placeholders as labels. `autocomplete`
on both fields. Errors wired with `aria-describedby` and announced via a live region.

---

## `/signup`

**Owning doc:** [01-auth.md](01-auth.md) · **Permission:** public · **No app shell**

Same split layout as `/login`. Fields: full name, email, password with an inline strength
meter. Submit stays disabled until the password passes.

**The success state is the whole page after submit** — not a toast. It shows the address
the mail went to, a "wrong address?" link back to the form, and states plainly that the
user is not signed in yet ([01](01-auth.md) § 7.2).

| State | Treatment |
|---|---|
| Loading | Button spinner |
| Error | Inline. Duplicate emails return the neutral "check your email" state by design — never confirm whether an address is registered |
| Success | Full-panel confirmation state, replacing the form |

---

## `/app/dashboard`

**Owning doc:** [07-dashboard-metrics.md](07-dashboard-metrics.md) ·
**Permission:** `insights.read`

```
+----------------------------------------------------------------------+
| Dashboard  [East]                        [ Last 90 days v ]          |
+----------------------------------------------------------------------+
| +----------+ +----------+ +----------+ +----------+                  |
| | Sales    | | Profit   | | Orders   | | Avg order|                  |
| | $678,781 | | $91,522  | | 2,847    | | $238.42  |                  |
| | ^ 12.4%  | | v 3.1%   | | ^ 8.2%   | | ^ 3.9%   |                  |
| +----------+ +----------+ +----------+ +----------+                  |
+----------------------------------------------------------------------+
| Sales over time                                                      |
| [ Chart.js line, monthly, series-1, crosshair + tooltip ]            |
|                                            [ View as table ]         |
+-----------------------------------+----------------------------------+
| Profit by category                | Sales by region                  |
| [ horizontal bar, diverging       | [ donut, 4 slices, total in      |
|   from a zero line — Furniture    |   the centre, legend with        |
|   is negative ]                   |   values ]                       |
| [ View as table ]                 | [ View as table ]                |
+-----------------------------------+----------------------------------+
```

**Components** — `src/pages/Dashboard.jsx`; `components/KpiTile.jsx`,
`components/DateRangePicker.jsx`, `components/TableView.jsx`;
`charts/SalesTrendLine.jsx`, `charts/CategoryProfitBar.jsx`, `charts/RegionDonut.jsx`.

**Chart rules** (full spec in [07](07-dashboard-metrics.md) § 8) — never a dual-axis chart;
categorical hues assigned by entity in fixed slot order and never repainted when a filter
changes the series count; legend present for ≥ 2 series; a table view under every chart;
recessive gridlines; direct-label the final point rather than every point.

**States**

| State | Treatment |
|---|---|
| First load | Skeletons at **exact final dimensions** — nothing reflows when data lands |
| Loading | Translucent overlay on refetch; previous numbers stay readable |
| Empty (range) | Tiles show `—`, not `$0.00`; charts show "No data in this range" + Reset to all time |
| Empty (scope) | "No data in your assigned region (East)" — names the cause |
| Permission denied | Nav item absent; direct URL shows the denial card; login redirects elsewhere |
| Error | "Could not load dashboard metrics" + Retry, range preserved. One endpoint means all-or-nothing, which is a feature |

**Interactions & animation** — anime.js counts tiles up from zero on first load, and **from
the previous value** on refetch — the direction of that movement is information. Charts
fade and draw over ~400 ms. Date range writes to the URL so a filtered dashboard is
linkable. Chart tooltips are keyboard-focusable, not hover-only.

**Responsive** — Tiles 4-up → 2×2 → 1 column. The two lower charts stack below 1024px.
Charts scroll inside their own container if needed; the page body never scrolls
horizontally.

**Accessibility** — `aria-label` on each chart summarising its headline. Deltas are
icon + arrow + label, never color alone. Theme switching triggers a chart update — Chart.js
does not re-read CSS custom properties on its own.

---

## `/app/insights`

**Owning doc:** [08-insights-bi.md](08-insights-bi.md) · **Permission:** `insights.read`

```
+----------------------------------------------------------------------+
| Insights  [East]   6 findings                       [ Export v ]     |
+----------------------------------------------------------------------+
| +------------------------------------------------------------------+ |
| | (!) CRITICAL   Discounts above 20% destroy margin                 | |
| | Every order line discounted above 20% loses money on average.     | |
| | 1,148 lines crossed it, costing $84,320 in profit.                | |
| |                                                                   | |
| |   Break-even discount        Profit lost                          | |
| |   20%                        -$84,320                             | |
| |                                                                   | |
| | +--------------------------------------------------------------+ | |
| | | ACTION  Cap discretionary discounts at 20%; require approval | | |
| | +--------------------------------------------------------------+ | |
| |                          [ Show evidence v ]                      | |
| +------------------------------------------------------------------+ |
| | (!) CRITICAL   Tables lose $17,725 on $206,965 of sales           | |
| +------------------------------------------------------------------+ |
| | (!) SERIOUS    Top 5% of customers generate 23% of revenue        | |
+----------------------------------------------------------------------+
```

Expanding **Show evidence** on the discount finding reveals the D3 scatter and the decile
table inline (not a modal — comparison against the next card matters):

```
| +--------------------------------------------------------------+ |
| |  profit                                                       | |
| |   +  . :.::. .                                                | |
| |   |  ::::::::. .        <- smoothed mean curve                | |
| |  0 +-----------\----------------------------  break-even ~20% | |
| |   |             \ x xx x   x                                  | |
| |   -              x  x xxx x x                                 | |
| |     0%    10%   20%    30%    40%    50%   discount           | |
| |  [ View as table ]        [ View matching orders -> ]         | |
| +--------------------------------------------------------------+ |
```

**Components** — `src/pages/Insights.jsx`; `components/InsightCard.jsx`,
`SeverityPill.jsx`, `ActionBand.jsx`, `EvidenceTable.jsx`, `ExportMenu.jsx`;
`charts/DiscountScatter.jsx` (D3).

**The action band is visually distinct from the finding text** — a tinted band, set apart.
A user skimming only the bands gets a to-do list, which is the intended reading mode.

**States**

| State | Treatment |
|---|---|
| First load | Three card skeletons at typical height |
| Loading | Skeletons first load; translucent overlay on refetch |
| Empty | A `good`-severity card: "No issues detected in your data" — a success state, not a blank page |
| Empty (scope) | "Not enough data in your assigned region to generate findings" |
| Permission denied | Nav item absent; direct URL shows the denial card. Missing export permission omits that dataset from the menu |
| Error | "Could not generate insights" + Retry. A single failed rule renders the rest and notes the failure — never blanks the page |

**Interactions** — Cards expand inline. **View matching orders** is the one cross-page
drill-down in the app, and it is justified here because "which orders?" is the immediate
next thought. The Export menu offers a copyable three-line pandas snippet
([08](08-insights-bi.md) § 9.3) — showing the code that consumes the endpoint is what turns
"we have an export" into "this integrates with your model".

**D3 scatter** — ~10k points rendered to `<canvas>` with SVG axes on top; hit-testing via a
quadtree. The break-even annotation with its leader line **is** the argument of the page —
without it a reader sees a cloud of dots. Below ~200 points, fall back to the decile table
alone. Redraw on theme change; a canvas does not re-read custom properties.

**Responsive** — Cards full-width, stacked. The scatter keeps a 16:9 aspect ratio and
scrolls horizontally inside its own container below 640px.

**Accessibility** — Severity is icon + word + color, never color alone. A table view under
the scatter gives mean profit per discount decile — the same argument in ten rows.
`aria-label` on the figure stating the break-even point.

---

## `/app/orders`

**Owning doc:** [05-orders.md](05-orders.md) · **Permission:** `orders.read`

The reference CRUD layout. Products and Customers copy it exactly.

```
+----------------------------------------------------------------------+
| Orders  [East]  2,847                            [ + New order ]     |
+----------------------------------------------------------------------+
| [ search ]  [ Region v ] [ Category v ] [ Date range v ] [ Clear ]   |
+----------------------------------------------------------------------+
| Order ID       Date       Customer      Region  Lines  Sales    ...  |
+----------------------------------------------------------------------+
| CA-2017-152156 2017-11-08 Claire Gute   South   2      $993.66  [/][x]|
| CA-2017-138688 2017-06-12 Darrin V.     West    1      $14.62   [/][x]|
+----------------------------------------------------------------------+
|                        < 1 2 3 ... 114 >        25 per page v        |
+----------------------------------------------------------------------+
```

Create/edit opens a **right-side drawer**, not a modal — the list stays visible behind it,
which matters when copying details from an existing row:

```
                          +-------------------------------------+
                          | New order                       [x] |
                          +-------------------------------------+
                          | Customer   [ search select      v ] |
                          | Order date [ 2024-03-14           ] |
                          | Ship date  [ 2024-03-17           ] |
                          | Ship mode  [ Second Class       v ] |
                          | Region     [ East (your scope)  v ] |
                          |                                     |
                          | LINE ITEMS                          |
                          | [ product v ] [ qty ] [ disc ] [x]  |
                          | + Add line                          |
                          |                                     |
                          | 2 lines · $523.92 sales             |
                          +-------------------------------------+
                          |          [ Cancel ] [ Create order ]|
                          +-------------------------------------+
```

**Components** — `src/pages/Orders.jsx`; `components/DataTable.jsx`, `FilterBar.jsx`,
`Pagination.jsx`, `Drawer.jsx`, `OrderForm.jsx`, `LineItemRepeater.jsx`,
`ConfirmDialog.jsx`, `RowActions.jsx`.

**Permission rendering** — The **New** button renders only with `orders.create`. Row
actions are computed **per row**, not per page: with mixed-scope data an admin can see rows
they may edit beside rows they may not. Controls are **absent, not disabled** — a Viewer
sees no action column at all.

**The idempotency rule** ([11](11-api-idempotency.md) § 6.3) — the `Idempotency-Key` is
generated **when the drawer opens**, not when submit is clicked. A key generated at submit
time is a new key per click, and two clicks produce two records. This is the single most
likely implementation mistake in the whole build.

**States**

| State | Treatment |
|---|---|
| First load | Table skeleton with correct column widths; header count as a placeholder dash |
| Loading | Translucent overlay on refetch — **never** collapse to a skeleton on a keystroke, it makes search feel broken |
| Empty (no data) | "No orders yet" + New button if permitted |
| Empty (filtered) | "No orders match these filters" + **Clear filters** — distinct copy, the fix is different |
| Empty (scope) | "No orders in your assigned region (East)" — names the reason |
| Permission denied | Nav item absent; out-of-scope row shows "This record is outside your assigned region (East)" |
| Error | Load: "Could not load orders" + Retry, filters preserved. Save: drawer **stays open with the data intact** and an inline error — never lose the user's typing |

**Interactions** — Search debounced 300 ms. Sort is server-side so it orders the whole
scoped set, not the visible page. Submit disables **immediately** on click, before the
request is even constructed — the reason people double-click is that the first click did
nothing visible. Delete confirms by naming what goes: "Delete order CA-2017-152156 and its
2 line items? This cannot be undone." Never a bare "Are you sure?".

**No optimistic updates** ([05](05-orders.md) § 7.6) — show pending, wait for the server,
render the server's row.

**Responsive** — Below 1024px the table drops secondary columns; below 768px rows become
cards. The drawer becomes a full-screen sheet below 640px. The table scrolls inside its own
container; the page body never scrolls horizontally.

**Accessibility** — Real `<table>` semantics with `<th scope="col">`. Sortable headers are
buttons with `aria-sort`. The drawer is a focus-trapped dialog, Escape closes, focus
returns to the trigger. Native `<input type="date">` — no picker library.

---

## `/app/products`

**Owning doc:** [06-products-customers.md](06-products-customers.md) ·
**Permission:** `products.read`

Identical to `/app/orders` in every structural respect. Deltas only:

- **Columns** — Product ID · Name · Category · Sub-category · Order lines · Total sales
- **Filters** — search, Category, Sub-category
- **Scope chip shows categories only** ("Furniture, Technology"), because `products` carries
  no region column. Each page shows only the axis that applies to it — a combined chip would
  imply a filter that is not happening ([06](06-products-customers.md) § 4)
- **Form** — id, name, category, sub-category. Category/sub-category are text inputs with
  autocomplete from existing distinct values: new taxonomy without a taxonomy screen
- **Category is disabled on edit** with the hint "Category cannot be changed — create a new
  product instead" ([06](06-products-customers.md) § 8)
- **Delete reports before it asks:** "This product appears on 47 order lines totalling
  $12,934.55." There is no override — the confirm button is replaced by **Close**
- **Empty (scope)** — "No products in your assigned categories (Furniture, Technology)"

---

## `/app/customers`

**Owning doc:** [06-products-customers.md](06-products-customers.md) ·
**Permission:** `customers.read`

Same as `/app/products`. Deltas:

- **Columns** — Customer ID · Name · Segment · City · State · Region · Orders · Total sales
- **Filters** — search, Segment, Region, State
- **Scope chip shows region only** ("Central")
- **Detail drawer** carries a compact read-only list of the customer's **last 5 orders**,
  scope-filtered, each linking to `/app/orders`. Capped at 5, no pagination — it answers
  "who is this?" without becoming a second orders screen
- **Region is disabled on edit**, same reasoning as product category
- **Empty (scope)** — "No customers in your assigned region (Central)"

---

## `/app/admin/roles`

**Owning doc:** [03-admin.md](03-admin.md) · **Permission:** `roles.read` /
`roles.update`

The screen the assignment is really about.

```
+----------------------------------------------------------------------+
| Permissions                                                          |
| Modules down, actions across. Changes apply on each user's next load.|
+----------------------------------------------------------------------+
|              | Admin       | Manager     | Analyst     | Viewer  ... |
|              | R C U D E   | R C U D E   | R C U D E   | R C U D E   |
+--------------+-------------+-------------+-------------+-------------+
| Orders       | x x x x x   | x x x .x x  | x . . . x   | x . . . .   |
| Products     | x x x x x   | x . . . .   | x . . . .   | x . . . .   |
| Customers    | x x x x x   | x x x x .   | x . . . .   | . . . . .   |
| Insights     | x . . . x   | x . . . .   | x . . . x   | x . . . .   |
| Users        | x . x . .   | . . . . .   | . . . . .   | . . . . .   |
| Roles        | x . x . .   | . . . . .   | . . . . .   | . . . . .   |
| Audit        | x [lock]    | . [lock]    | . [lock]    | . [lock]    |
| Settings     | x . x . .   | x . . . .   | x . . . .   | x . . . .   |
+--------------+-------------+-------------+-------------+-------------+
|  * 1 unsaved change                        [ Discard ] [ Save ]      |  sticky
+----------------------------------------------------------------------+
```

**Components** — `src/pages/admin/Roles.jsx`; `components/PermissionMatrix.jsx`,
`MatrixCell.jsx`, `DirtyStateBar.jsx`.

**Interactions**

- Hovering a cell highlights its row and column and shows a plain-language tooltip:
  *"Manager can delete orders."* No jargon, no permission ID.
- Toggling pulses the cell (anime.js) and marks it dirty with a small **amber dot**, not a
  color change — color alone fails for colorblind users and collides with the checked state.
- The sticky save bar counts unsaved changes and stays until resolved.
- **Discard needs no confirmation** — the change is unsaved and trivially redone.
- Navigating away dirty triggers both a `beforeunload` prompt and an in-app route guard.
- `PUT` sends the **full desired state per changed role**, not per-cell deltas
  ([03](03-admin.md) § 5). The grid re-renders from the server response, not from its own
  optimistic copy.
- **Lockout guard:** the last `roles.update` checkbox does not toggle, with a tooltip
  explaining why. Forced via curl → `409`. The client block is convenience; the server
  block is the guarantee.
- `audit.create/update/delete` cells render **locked** with a tooltip: "Audit records are
  written by the system and cannot be created or modified."

**States**

| State | Treatment |
|---|---|
| First load | Grid skeleton at correct dimensions so nothing reflows |
| Loading | On save the grid dims but stays fully readable |
| Empty | Not reachable — permissions are always seeded |
| Permission denied | `roles.read` without `roles.update` → full grid, every checkbox disabled, "View only — you cannot change permissions" banner. **This is the one place a disabled control beats a hidden one**, because the grid's value is being seen. No `roles.read` → nav item absent |
| Error | Load: "Could not load the permission matrix" + Retry. Save: **the grid keeps its dirty state** and the bar turns to an error state — never silently discard the admin's work |

**Responsive** — 6 roles × 5 actions = 30 columns. The grid scrolls horizontally inside its
own container with sticky module names; the page body never scrolls sideways. Below 768px
it switches to **one role at a time** behind a role picker.

**Accessibility** — Every checkbox has an accessible name spelling out the full meaning
("Manager can delete orders"), not just "checkbox". Real `<table>` semantics with row and
column headers. Full keyboard navigation across the grid. The dirty state is announced in a
live region.

---

## `/app/admin/users`

**Owning doc:** [03-admin.md](03-admin.md) · **Permission:** `users.read` /
`users.update`

```
+----------------------------------------------------------------------+
| Users                                                    6 users     |
+----------------------------------------------------------------------+
| Name          Email              Role       Scope            Active  |
+----------------------------------------------------------------------+
| Talvin Lee    admin@…            Admin      All regions      now     |
| Dana Chen     manager@…          Manager    East · all cats  2h ago  |
| Sam Ortiz     warehouse@…        Warehouse  Central · Furn…  1d ago  |
+----------------------------------------------------------------------+

                          +-------------------------------------+
                          | Dana Chen                       [x] |
                          | manager@example.com                 |
                          +-------------------------------------+
                          | Role       [ Manager            v ] |
                          |                                     |
                          | Regions    [ East x ]           [+] |
                          |            Leave empty for all      |
                          | Categories [                    ][+]|
                          |            Leave empty for all      |
                          |                                     |
                          | Dana will see 2,847 of 9,994        |
                          | order lines.                        |
                          +-------------------------------------+
                          |     [ Cancel ] [ Save changes ]     |
                          +-------------------------------------+
```

**Components** — `src/pages/admin/Users.jsx`; `DataTable`, `Drawer`, `RoleSelect.jsx`,
`ScopeMultiSelect.jsx`, `ScopePreview.jsx`.

**The scope preview is the highest-value affordance on this screen.** Scope is abstract
until you see the row count it produces. Backed by a scoped `count(*)`, debounced, updating
as the admin picks.

Scope options come from `SELECT DISTINCT` on the real data, so swapping the dataset needs
no code change. Under each scope field: *"Leave empty for access to all regions."* — the
empty-means-all rule stated where it is used, because it inverts the intuitive reading.

**Self-downgrade** warns but allows: *"This will remove your own admin access. You will need
another admin to restore it."* with an explicit confirm. Blocking it outright breaks the
legitimate handover case.

**States** — Standard table states. Empty reads "No other users yet" with the signup URL.
Denied: nav item absent, or a full-page denial card on direct URL.

**Responsive** — Rows become cards below 768px; the drawer becomes a full-screen sheet
below 640px.

**Accessibility** — Scope chips are removable with a keyboard, each with an accessible
"Remove East" label. The preview updates in a live region.

---

## `/app/admin/audit`

**Owning doc:** [09-audit-log.md](09-audit-log.md) · **Permission:** `audit.read`

```
+----------------------------------------------------------------------+
| Audit log                                          1,204 records     |
+----------------------------------------------------------------------+
| [ User v ] [ Action v ] [ Entity v ] [ Date range v ] [ Clear ]      |
+----------------------------------------------------------------------+
| When        Actor        Action  Entity  ID       Summary            |
+----------------------------------------------------------------------+
| 2 min ago   Talvin Lee   UPDATE  roles   Manager  Removed orders… v  |
+----------------------------------------------------------------------+
|   BEFORE                       |  AFTER                              |
|   grants: [1, 2, 3, 7]         |  grants: [1, 2, 3]                  |
|   > Show 12 unchanged fields   |                                     |
|   [ Copy JSON ]                |  [ Copy JSON ]                      |
+----------------------------------------------------------------------+
| 1 hr ago    Dana Chen    DELETE orders  CA-2017…  Deleted order   v  |
+----------------------------------------------------------------------+
|                        < 1 2 3 ... 25 >         50 per page v        |
+----------------------------------------------------------------------+
```

**Components** — `src/pages/admin/Audit.jsx`; `DataTable`, `FilterBar`, `Pagination`,
`JsonDiff.jsx`, `ActionPill.jsx`, `RelativeTime.jsx`.

**Interactions** — Rows expand inline to a two-column before/after. **Changed keys are
highlighted; unchanged keys collapse behind a "Show 12 unchanged fields" toggle** — a raw
JSON diff of a whole row is unreadable and the unchanged fields are most of it. For a
create the left column reads "Record did not exist"; for a delete the right reads "Record
deleted" — not an empty panel, which reads as a bug. **Copy JSON** on each side is how a
deleted row actually gets reconstructed: copy the `before`, paste into the create form.

Times are relative for scanning ("2 minutes ago") with the absolute UTC value in the title
attribute for correlating with anything else.

**States**

| State | Treatment |
|---|---|
| First load | Table skeleton, 10 placeholder rows, filters already interactive |
| Loading | Translucent overlay on refetch |
| Empty | "No changes recorded yet" — expected on a fresh install, not an error |
| Empty (filtered) | "No records match these filters" + Clear filters |
| Permission denied | Nav item absent; direct URL shows the denial card |
| Error | "Could not load the audit log" + Retry, filters preserved |

There is **no create, edit or delete anywhere on this page.** The table is append-only and
the UI must not imply otherwise.

**Responsive** — Rows become cards below 768px; the before/after diff stacks vertically.

**Accessibility** — Action pills are word + color, never color alone. Expanded rows use
`aria-expanded`. The deleted-actor case renders "Deleted user (a1b2…)" rather than dropping
the row — losing history because the actor left is the failure this module exists to
prevent.

---

## `/app/settings`

**Owning doc:** [04-settings.md](04-settings.md) · **Permission:** `settings.read` /
`settings.update`

```
+----------------------------------------------------------------------+
| Settings                                                             |
+----------------------------------------------------------------------+
| PREFERENCES                                          applies to you  |
|                                                                      |
|  Theme          [ Light ][ Dark ][ System ]              Saved       |
|  Default page   [ Dashboard                    v ]                   |
|  Rows per page  [ 25                           v ]                   |
+----------------------------------------------------------------------+
| ORGANISATION                            admin only                   |
|                                                                      |
|  Organisation name  [ Superstore Trading Co.          ]              |
|  Currency           [ USD ($)                       v ]              |
|                     Display only — values are not converted.         |
|  Fiscal year start  [ 01-01                           ]              |
|  Discount alert at  [ 0.20 ]                                         |
|                     At 15%, 2,310 lines would be flagged (now 1,148) |
|  Minimum loss       [ 1000 ]                                         |
|                                                                      |
|                              [ Discard ] [ Save changes ]            |
+----------------------------------------------------------------------+
```

**Components** — `src/pages/Settings.jsx`; `components/SettingsCard.jsx`,
`SegmentedControl.jsx`, `Select.jsx`, `NumberField.jsx`, `DirtyStateBar.jsx`,
`ThresholdPreview.jsx`.

**Two different save models, deliberately** ([04](04-settings.md) § 7.2):

| Section | Model | Why |
|---|---|---|
| Preferences | **Instant apply**, background write, quiet "Saved" that fades | Affects one person; a save button for a theme toggle is friction for nothing |
| Organisation | **Explicit Save** with a dirty-state bar | Affects everyone's dashboard |

**Theme repaints the entire app instantly** — `data-theme` flips on `<html>`, custom
properties cascade, no reload, no flash. If the background write fails, the control
**reverts** with an inline error; the UI must not claim a persisted state it does not have.

The threshold preview states the blast radius before saving, so the admin is not editing a
number in the dark.

**States**

| State | Treatment |
|---|---|
| First load | Card skeletons; theme already applied by the pre-paint script |
| Loading | Quiet inline spinner on the individual control being saved |
| Empty | Not reachable — every setting has a default |
| Permission denied | Non-admin sees the **Organisation card with real values, all inputs disabled**, and one line: "Only administrators can change these settings." Knowing the org currency is useful; being unable to change it is not a secret |
| Error | Load: "Could not load settings" + Retry. Save: control reverts, inline error, value never silently lost |

**Responsive** — Cards stack; controls go full-width below 640px.

**Accessibility** — The theme control is a real radio group, not styled divs. Every field
has a `<label>` and its hint wired via `aria-describedby`. Disabled org fields carry
`aria-disabled` with the explanatory text programmatically associated, not just visually
adjacent.

---

## Cross-page conventions

Decided once here so every page agrees.

| Concern | Convention |
|---|---|
| **Permission-gated controls** | **Absent, not disabled** — except the roles matrix and org settings in read-only mode, where seeing the values is the point |
| **Empty states** | Always distinguish *no data* from *filtered to nothing* from *out of scope*. Three different causes, three different fixes, three different messages |
| **Errors** | Inline and specific, never a generic toast. Preserve user input on every failure |
| **Destructive confirms** | Name the object and the consequence: "Delete order CA-2017-152156 and its 2 line items? This cannot be undone." Never a bare "Are you sure?" |
| **Skeletons** | Match the final layout's dimensions exactly. Nothing reflows when data lands |
| **Refetch** | Translucent overlay over previous data — never collapse to a skeleton on a keystroke |
| **Drawers over modals** | Context stays visible behind them. Modals are for destructive confirms only |
| **Scope chip** | Always in the topbar, including "All regions" for unscoped users. A chip that appears only sometimes is one nobody learns to look for |
| **Idempotency key** | Generated on **form open**, reused on retry, fresh after success |
| **Numbers** | Currency symbol from org settings. Proportional figures in KPI tiles, `tabular-nums` in table columns and axis ticks |
| **Dates** | `order_date` is a date, not a timestamp — bucket in SQL, in UTC. Native `<input type="date">`, no picker library |
| **Motion** | All animation off under `prefers-reduced-motion` |
| **Charts** | Never dual-axis. Fixed hue order by entity. Legend for ≥ 2 series. Table view under every chart |
| **Horizontal overflow** | Wide content scrolls inside its own container. **The page body never scrolls horizontally**, at any width |
