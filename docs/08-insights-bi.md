# 08 — Insights & BI

## 1. Purpose

`/app/insights` — the layer that turns numbers into recommendations. Six SQL rules run
against the scoped dataset and emit findings, each shaped as
`{severity, title, finding, metric, delta, action, evidence}`. The `action` field is the
point: every finding says what to do about itself.

Paired with `/api/export`, which serves flat, model-ready JSON — the "integrate to AI dev"
requirement from `../Idea.txt`, satisfied without an API key or a cent of spend.

No LLM. No trained model. Rule thresholds are derived from the data itself and tunable
from [04-settings.md](04-settings.md).

---

## 2. Why it exists / ERP limitation answered

The headline limitation from `../PLAN.md`:

> Dashboards report numbers but do not tell you what to *do*.

Every ERP ships charts. Odoo, ERPNext and Dolibarr all render sales by category. None of
them says *"stop discounting above 20%, it costs you money on every order past that
point."* The gap between a chart and a decision is left entirely to the person looking at
it, and that person is usually not the person who built the chart.

Three enhancements:

1. **Findings carry actions.** `finding` states what is true; `action` states what to do.
   A finding without an action does not ship.
2. **Evidence is attached.** Each finding carries the rows behind it, so the natural next
   question — *"which orders?"* — is one click, not a support request.
3. **Zero-cost and explainable.** A rule engine has no API key, no latency, no
   hallucination, and its thresholds are visible and adjustable. Every number on the page
   is reproducible with a SQL query, which § 10 requires you to actually run.

`../Idea.txt` also asks the insight layer be *"integrate to model or AI dev"*. That is
`/api/export`: a clean, flat, scoped JSON feed a data scientist can pull straight into
pandas. The reference repo `thebingoai/thebingoai` was reviewed as a BI reference for this
layer only — its FastAPI/Nuxt/Qdrant/Celery architecture does not transfer to this stack.

---

## 3. Scope

**In scope**

- Six insight rules as SQL views in `03_insights.sql`
- `/api/insights` returning ranked findings with evidence
- Insights feed UI: severity grouping, evidence drawer, action text
- D3 profit-vs-discount scatter with a break-even curve — the showpiece chart
- `/api/export` — flat JSON per dataset, scope-applied
- Thresholds read from org settings, not hardcoded

**Out of scope**

- Any LLM call, narrative generation, or natural-language Q&A (`../PLAN.md`: no API key,
  no spend)
- Trained predictive models, forecasting, anomaly detection beyond fixed rules
- User-authored custom rules — **Decision:** a rule builder is a query builder is a
  second product. The six rules are fixed; their *thresholds* are tunable, which covers
  the real need.
- Scheduled digests, email alerts, notifications
- Dismissing / snoozing / assigning findings — no workflow state. **Decision:** findings
  are recomputed from data on every request and hold no state of their own. Adding
  "dismissed" means a table, a permission, and a story about what happens when the
  underlying data changes.
- CSV or Excel export — JSON only, because the stated consumer is a model, not a
  spreadsheet.

---

## 4. Data touched

Read-only, entirely through views in `03_insights.sql`.

| Source | Feeds rules | Scope axes |
|---|---|---|
| `order_items` | 1, 2, 4, 5 — every monetary rule | `region` + `category` |
| `orders` | 3, 6 — `ship_lag_days`, monthly trend | `region` |
| `products` | 2, 5 — sub-category and product names | `category` |
| `customers` | 4 — revenue concentration | `region` |
| `settings` | thresholds (`insight_discount_threshold`, `insight_min_loss`) | — |

Same rule as [07](07-dashboard-metrics.md) § 4, and it matters more here: **every view
applies `in_scope()`**. A finding computed globally and shown to a scoped user is both a
data leak and a wrong recommendation — "stop discounting" derived from West data is not
advice an East manager should act on.

---

## 5. API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/insights` | ranked findings for the caller's scope |
| `GET` | `/api/export?dataset=` | flat, model-ready JSON |

### `GET /api/insights`

```json
{
  "scope": { "regions": ["East"], "categories": [] },
  "generated_at": "2026-07-25T10:14:22Z",
  "thresholds": { "discount": 0.20, "min_loss": 1000 },
  "findings": [{
    "id": "discount-breakeven",
    "severity": "critical",
    "title": "Discounts above 20% destroy margin",
    "finding": "Every order line discounted above 20% loses money on average. 1,148 lines crossed that threshold, costing $84,320 in profit.",
    "metric": { "label": "Break-even discount", "value": 0.20, "format": "percent" },
    "delta": { "label": "Profit lost", "value": -84320.11, "format": "currency" },
    "action": "Cap discretionary discounts at 20% and require approval above it.",
    "evidence": {
      "type": "table",
      "columns": ["discount_bucket", "lines", "avg_profit", "total_profit"],
      "rows": [["0-10%", 4211, 32.11, 135255.2], ["20-30%", 611, -18.44, -11266.8]],
      "query_hint": "SELECT width_bucket(discount, 0, 1, 10) …"
    }
  }]
}
```

Findings are sorted by severity (`critical` → `serious` → `warning` → `good`) and, within
a severity, by the absolute magnitude of `delta`. A rule that finds nothing emits no
finding — the endpoint returns fewer than six, and that is success, not an error.

`format` on `metric` and `delta` lets the client render currency, percent and count
correctly without parsing English out of the string.

### `GET /api/export?dataset=`

`dataset` ∈ `orders` · `order_items` · `products` · `customers` · `insights`.

Flat JSON, one array of objects, no nesting, no envelope beyond a small header:

```json
{
  "dataset": "order_items",
  "scope": { "regions": ["East"], "categories": [] },
  "row_count": 8102,
  "generated_at": "2026-07-25T10:14:22Z",
  "rows": [
    { "order_id": "CA-2017-152156", "product_id": "FUR-BO-10001798", "region": "South",
      "category": "Furniture", "sales": 261.96, "quantity": 2, "discount": 0.0, "profit": 41.91 }
  ]
}
```

**Decision:** flat and denormalized, one row per record, no joins required by the
consumer. `pd.DataFrame(r.json()["rows"])` must work in one line — that is the entire
design goal, and any nesting breaks it.

**Decision:** the export is **scope-applied**, not raw. An export endpoint that ignores
scope is the easiest possible way to defeat the entire permission system, and it would be
the first thing a reviewer tries.

`row_count` is capped at 10,000 per request with `page` / `page_size` params beyond that.
Superstore's 9,994 rows fit in one response by design.

### Status codes

| Code | When |
|---|---|
| `200` | success |
| `400` | unknown `dataset` value |
| `401` | no valid JWT |
| `403` | lacks `insights.read` (feed) or `insights.export` / `orders.export` (export) |
| `429` | rate limited — export is heavier, see § 9 |

Both read-only: no `Idempotency-Key`, no `audit_log` row for the feed. **Decision:**
`/api/export` **does** write an audit row — bulk data leaving the system is exactly the
event an audit log exists to record.

---

## 6. Permission gates

| Element | Requires |
|---|---|
| `/app/insights` route and feed | `insights.read` |
| Evidence drawer | `insights.read` |
| Export button, `/api/export` | `insights.export` for `dataset=insights`; the owning module's `export` for the rest (`orders.export` → `dataset=orders`) |

Seed state ([02](02-permissions-rbac.md) § 6):

| Role | Read insights | Export |
|---|---|---|
| Admin | ✅ | ✅ |
| Manager | ✅ | orders only |
| Analyst | ✅ | ✅ |
| Viewer | ✅ | — |
| Finance | ✅ | ✅ |
| Warehouse | — | — |

**Decision:** export permission is checked against the *dataset being exported*, not a
single blanket `insights.export`. A Manager who may export orders should not thereby be
able to export the customer list.

---

## 7. The six rules

All thresholds come from org settings where marked; the rest are derived from the data at
query time rather than hardcoded.

### Rule 1 — Discount break-even  · severity `critical`

Bucket `order_items` by discount decile, average profit per bucket, find where the average
crosses zero. Superstore's crossing sits around 20%.

> *"Above 20% discount every order loses money — 1,148 order lines crossed it, costing
> $84,320."*
> **Action:** cap discretionary discounts at 20%; require approval above it.

Threshold: `insight_discount_threshold` (default `0.20`, clamped 0.05–0.90).
This rule is also the showpiece chart — see § 8.

### Rule 2 — Margin leak by sub-category · `critical`

Sub-categories with high sales and negative total profit.

> *"Tables: $206,965 in sales, −$17,725 in profit."*
> **Action:** review Tables pricing and discount policy, or discontinue.

Threshold: `insight_min_loss` (default `1000`) — losses smaller than this are noise.

### Rule 3 — Ship-lag outliers · `warning`

Compare each order's `ship_lag_days` against the median for its own `ship_mode`, flag the
upper tail.

> *"38 Second Class orders shipped 6+ days late against a 4-day median for that mode."*
> **Action:** audit fulfilment for the affected region and period.

Comparing each mode against its own median, rather than a global one, is what stops this
rule from simply reporting "Standard Class is slower than First Class" — which is true,
expected, and useless.

### Rule 4 — Revenue concentration · `serious`

Share of revenue held by the top 5% of customers.

> *"The top 5% of customers (40 accounts) generate 23% of revenue."*
> **Action:** assign named account owners to the top 40; a single churn there is material.

### Rule 5 — Loss-making SKUs · `serious`

Products with negative total profit, ranked by absolute loss.

> *"17 products lose money on every unit sold. Worst: Cubify CubeX 3D Printer, −$8,880."*
> **Action:** reprice or delist the top 5 loss-makers.

Threshold: `insight_min_loss`.

### Rule 6 — Region trend break · `warning`

A region running below its own trailing 3-month trend.

> *"Central is 18% below its trailing 3-month average for the second consecutive month."*
> **Action:** review Central pipeline and discounting for the last 60 days.

Against its *own* trend, not against other regions — regions have permanently different
sizes and cross-region comparison produces the same finding forever.

### Severity vocabulary

`critical` `#d03b3b` · `serious` `#ec835a` · `warning` `#fab219` · `good` `#0ca30c`.
Reserved status colors, never reused for a chart series, and **always** paired with an
icon and a text label — color alone never carries the severity.

---

## 8. The showpiece — D3 profit-vs-discount scatter

Rule 1 rendered as the one hand-built D3 chart on the site. Everything else is Chart.js;
this one earns the dependency.

**Form.** Relationship between two continuous variables → scatter. One dot per order line:
x = discount, y = profit.

**Marks.** ~9,994 points, so: 3px radius, low opacity so density reads as shading rather
than a solid mass, no stroke. Points above zero profit in series-1 blue
(`#2a78d6` / `#3987e5`); points below zero in the loss red (`#d03b3b`). Two colors, one
meaning — profitable or not — so this is a diverging encoding, not a categorical one.

**The curve.** A LOESS-style smoothed mean-profit line drawn over the cloud, plus a
horizontal zero line. Where they intersect is the break-even point, annotated directly on
the chart: *"Break-even ≈ 20%"* with a leader line. **That annotation is the entire
argument of the page** — without it a reader sees a cloud of dots.

**Interaction.** Hover a point → tooltip with order id, product, discount, sales, profit.
Brush along the x-axis → the finding text above updates to reflect the selected discount
band. Keyboard-focusable annotation, so the headline is reachable without a mouse.

**Performance.** ~10k SVG circles is at the edge of comfortable. **Decision:** render to
`<canvas>` with D3 handling scales and axes in SVG on top. Hit-testing for tooltips uses a
quadtree, not per-element listeners.
<!-- ponytail: canvas + quadtree only because 10k SVG nodes janks; SVG is fine under ~2k points -->

**Scope.** The scatter plots only rows in the viewer's scope, so an East Manager sees East
break-even. The annotation states which — *"East region, 8,102 lines"*.

**Accessibility.** A table view beneath giving mean profit per discount decile — the same
argument in ten rows. `aria-label` on the figure stating the break-even point. Dark mode
uses the dark steps, not an inverted filter.

---

## 9. User experience flow

### 9.1 Primary — read the feed

1. User clicks **Insights**. → Route guard passes on `insights.read`; the page mounts with
   card skeletons.
2. `GET /api/insights` returns. → Findings render as a vertical feed, most severe first.
   Header: **"6 findings · East"**, with the same scope chip as the dashboard.
3. Each card shows, top to bottom: a severity pill (icon + word), the title, the finding
   sentence, one large metric, and — set apart in a tinted band — the **action**.
4. → The action band is visually distinct from the finding text. A user skimming only the
   bands gets a to-do list, which is the intended reading mode.

### 9.2 Drill into evidence

1. User clicks **Show evidence** on the discount finding. → The card expands inline (not a
   modal — comparison against the next finding matters).
2. → The evidence table appears: discount buckets, line counts, average profit. For rule 1
   the D3 scatter renders here as well.
3. **View matching orders** → navigates to `/app/orders` pre-filtered. **Decision:** this
   is the one cross-page drill-down in the app, and it is worth it here because the
   question *"which orders?"* is the immediate next thought and the answer is a filter the
   Orders page already supports.

### 9.3 Export for a model

1. Analyst clicks **Export** in the page header → a small menu: Orders · Order lines ·
   Products · Customers · Insights.
2. Picks **Order lines**. → `GET /api/export?dataset=order_items` in a new tab; the browser
   renders or downloads the JSON.
3. → An `audit_log` row records who exported what, when, and how many rows.
4. Alongside the menu sits a copyable snippet:
   ```python
   import pandas as pd, requests
   r = requests.get(URL, headers={"Authorization": f"Bearer {JWT}"})
   df = pd.DataFrame(r.json()["rows"])
   ```
   **Decision:** showing the three lines that consume the endpoint is what turns "we have
   an export" into "this integrates with your model."

### 9.4 Tuning a threshold

1. Admin goes to `/app/settings` → Organisation → `insight_discount_threshold`.
2. Changes 0.20 → 0.15. → The live preview states how many lines that would flag
   ([04](04-settings.md) § 7.2).
3. Saves, returns to `/app/insights`. → Rule 1's numbers have moved, and the finding text
   states the threshold in use. The engine is visibly a rule engine, not an oracle.

### 9.5 States

| State | What the user sees |
|---|---|
| **First load** | Three card skeletons at typical height |
| **Loading** | Skeletons on first load; translucent overlay on refetch |
| **Empty (no findings)** | A `good`-severity card: *"No issues detected in your data."* — a success state, not a blank page |
| **Empty (scope)** | *"Not enough data in your assigned region to generate findings."* |
| **Permission denied** | No `insights.read` → nav item absent; direct URL shows the denial card. Missing export permission → the Export menu omits that dataset |
| **Error** | "Could not generate insights" + Retry. A single failed rule must not blank the page — the feed renders what succeeded and notes the rule that failed |

---

## 10. Edge cases

- **Scope on aggregates.** Same headline risk as [07](07-dashboard-metrics.md) § 9, with
  the added twist that a wrongly-scoped *recommendation* is worse than a wrongly-scoped
  number, because someone may act on it.
- **A scoped user with too little data.** A Warehouse user scoped to one region and two
  categories may have too few rows for rule 4's top-5% to be meaningful. **Decision:**
  each rule carries a minimum row count (500 lines) and suppresses itself below it rather
  than emitting statistical noise dressed as advice.
- **Break-even never crosses zero.** Within a narrow scope, average profit may stay
  positive at every discount level. Rule 1 emits nothing. Correct behaviour — do not
  fabricate a threshold to fill the card.
- **Division by zero** in share and percentage calculations when a scoped total is zero.
  Guard every denominator; a `NaN%` in a finding destroys confidence in every other
  number on the page.
- **Export is heavy.** ~10k rows of JSON is a few MB. It shares the standard rate limit,
  but **Decision:** it gets a tighter one — 5 exports per minute — because it is the
  cheapest way to hammer the database, and the legitimate use is one-off.
- **Export and JWT.** Opening the export in a new tab means the browser sends no
  `Authorization` header. **Decision:** the client fetches with the header and creates a
  blob URL rather than linking directly. Do not solve this with a token in the query
  string — it lands in server logs and browser history.
- **Findings are recomputed, never cached.** Two users, or the same user twice, may see
  different numbers if data changed between requests. `generated_at` on the response makes
  that explicit.
- **Rule text with pluralisation.** "1 lines" undermines everything else on the page.
  Handle singular/plural, and format currency and percent through one shared helper.
- **The scatter with fewer than ~50 points.** For a narrowly scoped user it looks sparse
  and the smoothed curve becomes unstable. Below 200 points, fall back to the decile
  table alone.
- **D3 and theme switching.** Same trap as Chart.js ([07](07-dashboard-metrics.md) § 9) —
  a canvas does not re-read CSS custom properties. Redraw on theme change.

---

## 11. Acceptance checks

- [ ] `GET /api/insights` returns **≥ 4 findings** for an unscoped Admin.
- [ ] Cross-check the discount break-even figure against a hand-written SQL query in the
      Supabase editor — the numbers match exactly.
- [ ] Cross-check the Tables margin-leak figure against
      `SELECT sum(sales), sum(profit) FROM order_items JOIN products USING (product_id)
      WHERE sub_category='Tables'`.
- [ ] As East Manager, findings differ from Admin's and every figure matches a
      region-filtered query.
- [ ] Every finding has a non-empty `action` string. Assert it, do not eyeball it.
- [ ] `GET /api/export?dataset=orders` returns valid JSON and `jq .rows[0]` parses it.
- [ ] `GET /api/export?dataset=order_items` as East Manager → `row_count` equals
      `SELECT count(*) FROM order_items WHERE region='East'`.
- [ ] `GET /api/export` as Viewer (no export permission) → `403`.
- [ ] Every successful export writes one `audit_log` row with the dataset and row count.
- [ ] `GET /api/export?dataset=nope` → `400`.
- [ ] The D3 scatter renders 9,994 points without visible jank, and the break-even
      annotation is present and correct.
- [ ] Change `insight_discount_threshold` in settings → rule 1's output changes on the
      next load.
- [ ] Toggle theme → the scatter redraws in dark steps; no light-mode axis text on a dark
      surface.
- [ ] Run the palette validator on the severity colors against both surfaces → no FAIL.

---

## 12. Depends on / blocks

**Depends on:** [01-auth.md](01-auth.md), [02-permissions-rbac.md](02-permissions-rbac.md)
(scope on every view), [04-settings.md](04-settings.md) (thresholds), the Superstore
import, and `03_insights.sql`.

**Blocks:** nothing. P1 for the feed, P3 for the D3 scatter and `/api/export`.

**Related:** [07-dashboard-metrics.md](07-dashboard-metrics.md) (the *what*, to this
doc's *so what*), [09-audit-log.md](09-audit-log.md) (records exports),
[UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/app/insights`.
