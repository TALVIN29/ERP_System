# 07 — Dashboard & Metrics

## 1. Purpose

`/app/dashboard` — the landing screen after login and the first impression of the whole
system. Four KPI tiles and three charts, all scope-filtered, all served by one endpoint.
It answers *how is the business doing* in about five seconds of looking.

It deliberately does **not** answer *what should I do about it* — that is
[08-insights-bi.md](08-insights-bi.md). Keeping the two separate is what stops the
dashboard from turning into the usual wall of charts nobody acts on.

Build priority **P0**. With Auth, Orders and this page, the demo exists.

---

## 2. Why it exists / ERP limitation answered

`../Idea.txt`: *"ERP dashboard that can make more data driven business decision making for
management level regardless of the tier level."* The phrase **regardless of the tier
level** is the design constraint, and it drives two things:

- **Same page, different truth.** A Viewer, an East Manager and an Admin all open the same
  dashboard and each sees numbers scoped to what they own. There is no separate "manager
  dashboard" to build and maintain. The scope chip in the header explains why two people
  quoting "total sales" get different figures — without it, this reads as a bug, and it is
  the single most likely thing to be mistaken for one during a demo.
- **Comprehensible at first glance.** Four tiles, three charts, no configuration, no
  widget library, no drag-and-drop layout. Typical ERP dashboards are configurable and so
  arrive empty, which pushes the setup cost onto the person least equipped to pay it.

---

## 3. Scope

**In scope**

- Four KPI tiles with anime.js count-up and a period-over-period delta
- Sales trend line (monthly), category profit bar, region donut
- Date-range filter applying to all five at once
- Scope-filtered aggregates, matching the row-level rules everywhere else
- Light and dark chart palettes, both validated
- Hover tooltips, legends, table-view fallback

**Out of scope**

- Configurable / draggable widgets, saved layouts, per-user dashboards
- Drill-down from a chart into a filtered Orders list — **Decision:** tempting and cheap
  to half-build, expensive to get right (cross-filtering state, back-navigation, chart
  brush selection). The date filter is the only interaction that changes the data.
- Real-time refresh — `../PLAN.md` cuts realtime subscriptions
- Forecasting or trend projection (no trained model, per `../PLAN.md`)
- Comparison mode (this period vs custom baseline) beyond the single delta on each tile
- PDF / image export of the dashboard

---

## 4. Data touched

Read-only. Aggregates come from SQL views defined in `03_insights.sql`, so the arithmetic
lives in the database and the Function stays a thin pass-through.

| Source | Feeds | Scope axes |
|---|---|---|
| `order_items` | every monetary aggregate — `sales`, `profit`, `quantity`, `discount` | `region` **and** `category` |
| `orders` | order counts, `order_date` bucketing, `ship_lag_days` | `region` |
| `products` | category / sub-category labels | `category` |
| `customers` | customer counts for AOV denominators | `region` |

**Every aggregate must apply `in_scope()`.** This is the highest-risk line in the whole
document. Applying scope to a list endpoint is obvious and hard to forget; forgetting it
inside a `SUM()` produces a number that looks perfectly plausible and leaks the global
figure to a scoped user. Every view here is scope-filtered, and § 9 verifies it against
hand-written SQL.

---

## 5. API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/metrics` | every number on the page, in one request |

One endpoint, not five. **Decision:** the tiles and charts share filters and must agree
with each other; five endpoints means five chances to disagree and five loading spinners
racing on the most important screen in the app.

Query params: `date_from`, `date_to` (both optional; default is the full dataset range).

```json
{
  "range": { "from": "2014-01-03", "to": "2017-12-30" },
  "scope": { "regions": ["East"], "categories": [] },
  "kpis": {
    "sales":       { "value": 678781.24, "delta_pct": 12.4, "previous": 603902.11 },
    "profit":      { "value": 91522.78,  "delta_pct": -3.1, "previous": 94450.02 },
    "orders":      { "value": 2847,      "delta_pct": 8.2,  "previous": 2631 },
    "avg_order":   { "value": 238.42,    "delta_pct": 3.9,  "previous": 229.47 }
  },
  "sales_trend":     [{ "month": "2017-01", "sales": 43211.55, "profit": 5120.33 }],
  "category_profit": [{ "category": "Furniture", "sales": 206213.0, "profit": -17725.5 }],
  "region_share":    [{ "region": "East", "sales": 678781.24, "share_pct": 29.5 }]
}
```

`delta_pct` compares the selected range against the immediately preceding range of equal
length. `previous` ships alongside so the tooltip can state the comparison in absolute
terms rather than making the user reverse-engineer a percentage.

`region_share` returns a single slice for a single-region user. **Decision:** still render
the donut, at 100%, with the region named. Hiding a chart based on the viewer's scope makes
the page shift shape per role and makes screenshots inconsistent between demo users.

### Status codes

| Code | When |
|---|---|
| `200` | success |
| `400` | `date_from` after `date_to`, or an unparseable date |
| `401` | no valid JWT |
| `403` | caller lacks `insights.read` |
| `429` | rate limited |

Read-only, so no `Idempotency-Key` and no `audit_log` row.

---

## 6. Permission gates

| Element | Requires |
|---|---|
| Route + all tiles and charts | `insights.read` |

Seed state ([02](02-permissions-rbac.md) § 6): Admin, Manager, Analyst, Viewer and
Finance hold it; **Warehouse does not**. So Warehouse logs in and lands on Orders instead,
with no Dashboard nav item — a clean demonstration that the default route follows
permissions rather than being hardcoded.

**Decision:** the dashboard is gated as a single unit rather than per tile. Per-tile
permissions would need eight more permission rows to hide four numbers, and a dashboard
with holes in it is worse than no dashboard.

Row scope applies to every figure. Two roles seeing different totals is correct
behaviour — see § 7.4.

---

## 7. User experience flow

### 7.1 Primary — first load after login

1. Login completes → redirect to `/app/dashboard` (or the user's `default_route` from
   [04-settings.md](04-settings.md)).
2. The shell paints instantly with skeletons: four tile outlines at final height, three
   chart areas at final aspect ratio. → **Nothing reflows when data lands.** A dashboard
   that jumps as each chart arrives feels broken regardless of how fast it is.
3. `GET /api/metrics` returns. → Tiles count up from zero to their value with anime.js,
   roughly 800 ms, staggered ~80 ms apart. Charts fade and draw in over ~400 ms.
4. → The header reads **"Dashboard · East"** with the scope chip, and the date-range
   control shows the active range.
5. Total time to a readable screen: one request. The count-up is the only animation that
   delays comprehension, and it is short enough not to.

### 7.2 Change the date range

1. User opens the range control: preset rows — Last 30 days · Last 90 days · This year ·
   All time · Custom.
2. Picks "Last 90 days". → All five components enter a translucent loading state
   simultaneously. Previous values stay visible underneath rather than collapsing to
   skeletons.
3. Response lands. → Tiles animate **from the old value to the new one**, not from zero.
   The direction of that movement is itself information.
4. → The range is reflected in the URL (`?from=…&to=…`) so a filtered dashboard is
   linkable and survives a refresh.

### 7.3 Reading a chart

1. User hovers the sales trend line. → A crosshair follows, with a tooltip giving the
   month, sales, and profit for that point.
2. Hovering a category bar → tooltip with category, sales, profit, and margin percent.
3. Every chart has a **"View as table"** toggle beneath it, revealing the same numbers as
   a plain HTML table. This is the accessibility fallback and, in practice, what people
   use when they want to copy a figure into a message.

### 7.4 Two roles, two truths — the flow that prevents a bug report

1. Admin reads Total Sales: **$2,297,200**.
2. East Manager, same page, same range, reads **$678,781**.
3. Both are correct. The East Manager's header shows the **East** chip; the Admin's shows
   **All regions**. Hovering the chip explains: *"You are seeing data for the East region
   only. Your administrator sets this."*
4. **Decision:** the chip is always present, including for unscoped users where it reads
   "All regions". A chip that appears only sometimes is a chip nobody learns to look for.

### 7.5 States

| State | What the user sees |
|---|---|
| **First load** | Skeletons at exact final dimensions; header and range control already live |
| **Loading (refetch)** | Translucent overlay, previous numbers still readable |
| **Empty (no data in range)** | Tiles show `—` (not `$0.00`, which reads as a real zero); each chart shows "No data in this range" with a **Reset to all time** action |
| **Empty (scope)** | "No data in your assigned region (East)" — names the cause |
| **Permission denied** | No `insights.read` → nav item absent, direct URL shows the denial card, and login redirects elsewhere |
| **Error** | "Could not load dashboard metrics" + Retry, with the date range preserved. Partial failure is impossible — one endpoint means all-or-nothing, which is a feature |

---

## 8. Chart specifications

Applying the `dataviz` skill. Palette values below are the validated reference palette;
if the app's brand tokens change, re-run
`scripts/validate_palette.js` against the new surfaces rather than eyeballing.

### 8.1 Non-negotiables

- **Never a dual-axis chart.** Sales and profit have different magnitudes; they are never
  plotted against two y-scales. The trend chart shows sales as the line and profit as a
  second line only if both are indexed to a common base — otherwise profit gets its own
  small chart. This is the single most common chart mistake.
- **Categorical hues in fixed order, never cycled.** Category and region colors are
  assigned by entity, in slot order, and **never repaint when a filter changes the number
  of visible series**. A category keeps its color when another is filtered out.
- **Sequential = one hue light→dark. Diverging = two hues with a neutral gray midpoint.**
  Never a rainbow.
- **Legend always present for ≥ 2 series**; a single-series chart needs none because the
  title names it. Identity is never carried by color alone.
- **Text wears text tokens, never the series color.** A colored mark sits beside the
  label; the label itself stays in primary/secondary ink.
- **Dark mode is selected, not flipped.** Each series has its own dark step, validated
  against the dark surface.

### 8.2 Palette

| Role | Light | Dark |
|---|---|---|
| Series 1 (blue) | `#2a78d6` | `#3987e5` |
| Series 2 (orange) | `#eb6834` | `#d95926` |
| Series 3 (aqua) | `#1baf7a` | `#199e70` |
| Series 4 (yellow) | `#eda100` | `#c98500` |
| Chart surface | `#fcfcfb` | `#1a1a19` |
| Primary ink | `#0b0b0b` | `#ffffff` |
| Muted (axis/labels) | `#898781` | `#898781` |
| Gridline | `#e1e0d9` | `#2c2c2a` |
| Baseline | `#c3c2b7` | `#383835` |
| Positive delta | `#006300` | `#0ca30c` |
| Negative delta / loss | `#d03b3b` | `#d03b3b` |

Superstore has exactly **3 categories** and **4 regions** — comfortably inside the
first-three / first-four slots that validate cleanly. No "Other" bucket is needed.

### 8.3 The four KPI tiles

Magnitude with a single headline value → **stat tile, not a chart**.

| Tile | Value | Delta |
|---|---|---|
| Total Sales | `$2,297,200` | vs previous period, arrow + percent |
| Total Profit | `$286,397` | same |
| Orders | `5,009` | same |
| Avg Order Value | `$458.61` | same |

- anime.js counts up on first load; on refetch it animates from the previous value.
- Delta is **icon + arrow + label**, never color alone — a red number with no arrow is
  invisible to a large fraction of readers and ambiguous to everyone else.
- Values use the system sans with proportional figures; only the table view uses
  `tabular-nums`.

### 8.4 Sales trend — line, Chart.js

Change over time → line. Monthly buckets, sales as series 1. 2px line, ≥8px markers on
hover only, recessive gridlines, y-axis starting at zero. Crosshair plus tooltip.
Direct-label the final point rather than every point.

### 8.5 Category profit — horizontal bar, Chart.js

Magnitude across a few named categories → bar. Horizontal, because category names are
long enough that vertical bars force rotated labels.

**This is the chart that earns the page.** Furniture shows roughly $206k of sales against
**negative** profit — the number that makes a viewer lean in. Because the values cross
zero, the bars diverge from a zero baseline: positive bars use series 1, negative bars use
the loss color, and a visible zero line anchors them. 4px rounded ends on the data end
only, 2px gap between adjacent bars, values direct-labeled at the bar ends.

### 8.6 Region share — donut, Chart.js

Part-to-whole across 4 slices → donut is acceptable here (it fails past ~5 slices; four is
fine). Series slots 1–4 in fixed order by region name so a region's color is stable across
sessions. Total sales in the centre. Legend with values, since slice angles alone are
hard to compare.

For a single-region user the donut renders as one full ring with the region named — see
§ 5.

### 8.7 Accessibility

Legends on every multi-series chart; direct labels where there are ≤ 4 marks; a table view
under each chart; texture fill available for the forced-colors and print cases; tooltips
reachable by keyboard focus, not hover alone; `aria-label` on each chart summarising its
headline ("Category profit: Furniture negative, Technology and Office Supplies positive").

**After building: render it and look at it.** The palette validator checks color, not
layout — screenshot the page in both themes and check for label collisions, clipped axis
text, and horizontal overflow before calling it done.

---

## 9. Edge cases

- **Scope leaking through an aggregate.** The headline risk. Every view applies
  `in_scope()`; § 10 verifies each figure against hand-written scoped SQL.
- **Delta with a zero previous period.** A percent change from zero is undefined. Show
  `—` with a tooltip reading *"No data in the previous period"*, never `∞` or `100%`.
- **Negative profit and percentage deltas.** Profit going from −$5,000 to −$2,000 is an
  *improvement*, but the naive percent formula reports −60%. Compute the delta on the
  absolute change and set the arrow direction from whether the number moved toward
  positive.
- **Superstore's date range ends in 2017.** A "Last 30 days" preset computed against the
  real clock returns nothing. **Decision:** presets are computed relative to the **latest
  order date in the data**, not `now()`, and the range control says so: *"Relative to the
  most recent order (Dec 2017)."* Otherwise the flagship screen opens empty during the
  demo.
- **Very long category names** overflow the bar labels. Truncate with an ellipsis, full
  text in the tooltip and the table view.
- **A month with no orders** must render as a gap or a zero point, decided once and applied
  consistently — a line chart that silently connects across missing months implies data
  that does not exist.
- **Timezone bucketing.** `order_date` is a date, not a timestamp. Bucket in SQL, in UTC,
  never with client-side `Date` arithmetic that shifts a boundary order into the previous
  month.
- **Currency display.** The symbol comes from the org setting
  ([04](04-settings.md)); changing it re-labels but does **not** convert.
- **Chart.js and theme switching.** Charts do not re-read CSS custom properties on
  their own. Switching the theme must trigger a chart update, or the dashboard turns dark
  around four light-mode charts.
- **anime.js count-up on a slow response.** The animation must start on data arrival, not
  on mount, or it counts up to zero and then jumps.

---

## 10. Acceptance checks

- [ ] Log in as Admin → Total Sales matches `SELECT sum(sales) FROM order_items` exactly.
- [ ] Log in as East Manager → Total Sales matches
      `SELECT sum(sales) FROM order_items WHERE region='East'`, and is **not** the global
      figure.
- [ ] Log in as Warehouse → no Dashboard nav item; direct URL shows the denial card;
      `GET /api/metrics` via curl → `403`.
- [ ] Category profit chart shows Furniture with negative profit; cross-check against
      `SELECT category, sum(profit) FROM order_items GROUP BY category`.
- [ ] Region donut slices sum to 100% and each share matches a hand-written share query.
- [ ] Set a date range → all four tiles and all three charts change together; the URL
      carries the range; refresh preserves it.
- [ ] Set a range with no data → tiles show `—`, charts show the empty state, nothing
      errors.
- [ ] Toggle theme → all three charts repaint with dark steps; no light-mode axis text on
      a dark surface.
- [ ] Run `node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100" --mode light`
      and again `--mode dark` → no FAIL.
- [ ] Screenshot both themes at 1440px and 390px → no clipped labels, no horizontal page
      scroll.
- [ ] Every chart's "View as table" toggle shows numbers matching the chart.

---

## 11. Depends on / blocks

**Depends on:** [01-auth.md](01-auth.md), [02-permissions-rbac.md](02-permissions-rbac.md)
(scope on aggregates), [04-settings.md](04-settings.md) (theme, currency), the Superstore
import, and `03_insights.sql` for the views.

**Blocks:** nothing — but it is P0 and it is the first thing anyone sees.

**Related:** [08-insights-bi.md](08-insights-bi.md) (the "so what" layer this page
deliberately omits), [UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/app/dashboard`.
