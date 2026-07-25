# 10 — Landing Page

## 1. Purpose

`/` — the public marketing page. No authentication, no data, no permissions. Its one job
is to convert a visitor into a signup, using real photography, GSAP scroll motion, and a
FOMO call-to-action.

It is also the first thing a reviewer sees, so it carries a second job: establishing that
the app behind it is a serious piece of work before anyone has logged in.

Build priority **P2** in `../PLAN.md`.

---

## 2. Why it exists / ERP limitation answered

Straight from `../Idea.txt`: *"A landing page with FOMO CTA is required that consist of
real photos."* Three requirements packed into one sentence, and each is a decision:

- **Real photos, not illustrations.** Warehouse, logistics and dispatch photography.
  Generic vector illustrations of people pointing at floating charts are the visual
  default of every SaaS template, and they signal "template" instantly.
- **FOMO CTA, not a generic one.** Scarcity and social proof, expressed as live-counting
  stat tiles, a scarcity band, and testimonial-style proof. See § 8 for the honesty
  constraint on this.
- **Dynamic.** The `../Idea.txt` brief asks the site to *"showcase your full stack
  skill"*. GSAP scroll-triggered parallax and reveals are where that shows without
  touching business logic.

The ERP limitation being answered is narrower than elsewhere: enterprise ERP products
are typically sold through a sales call, so their public pages explain nothing and end in
"Request a demo". A visitor cannot tell what the product does or try it. This page shows
the actual dashboard and ends in a working signup.

---

## 3. Scope

**In scope**

- Hero with real photography and a headline
- Live-counting stat tiles (anime.js)
- Feature sections with GSAP scroll-triggered reveals and parallax
- A product screenshot section showing the real dashboard
- FOMO band: scarcity + social proof
- Footer CTA into `/signup`, plus a `/login` link in the header
- Light/dark support, responsive down to 390px
- Reduced-motion support

**Out of scope**

- Pricing page, contact form, blog, docs site, changelog
- Analytics, cookie banner, tracking pixels, A/B testing
- CMS-driven content — copy is in the component
- Video backgrounds — **Decision:** heavy, awkward in dark mode, and a still photo with
  parallax reads better than an autoplaying loop
- i18n (`../PLAN.md` § Deliberate cuts)
- Live data on the landing page — **Decision:** the stat tiles animate to **static
  constants derived from the dataset**, not a live API call. A public endpoint serving
  business aggregates to unauthenticated visitors would undo the entire permission system
  documented in [02](02-permissions-rbac.md), for a decorative counter.

---

## 4. Data touched

**None.** No API calls, no Supabase client, no session. The page must render fully with
the network blocked after asset load.

The numbers shown in the stat tiles are constants derived once from the Superstore
dataset and written into the component:

| Stat | Value | Source |
|---|---|---|
| Order lines analysed | `9,994` | `SELECT count(*) FROM order_items` |
| Revenue tracked | `$2.29M` | `SELECT sum(sales) FROM order_items` |
| Margin leaks found | `17` | loss-making SKU rule, [08](08-insights-bi.md) rule 5 |
| Break-even discount | `20%` | discount rule, [08](08-insights-bi.md) rule 1 |

**Decision:** these are real figures from the real dataset, not invented ones. They are
the same numbers the logged-in app produces, so a reviewer who checks finds them
consistent. That consistency is worth more than the freshness a live endpoint would buy.

---

## 5. API surface

None.

The signup CTA is a client-side route change to `/signup`; the actual account creation is
[01-auth.md](01-auth.md)'s concern. The page issues zero fetches.

This matters for the deploy check: the landing page must load and be fully interactive
before Supabase is reachable, so a Supabase outage or a missing env var degrades the app
but not the front door.

---

## 6. Permission gates

None. Public route, no session required.

Two behaviours worth specifying:

- **Already signed in.** A visitor with a valid session still gets the landing page — it
  is not force-redirected to the app. The header swaps its "Sign in" button for **"Go to
  dashboard"**. **Decision:** force-redirecting an authenticated user away from `/` makes
  the marketing page unreachable for anyone who has ever logged in, including during a
  demo where you want to show it.
- **The header's CTA** reads "Sign in" when signed out and "Go to dashboard" when signed
  in, resolved from the session context without blocking the first paint.

---

## 7. Page structure

Top to bottom:

### 7.1 Header

Sticky, transparent over the hero, gaining a background on scroll. Logo left; "Sign in"
and "Get started" right. Theme toggle included — the landing page respects the same
light/dark tokens as the app ([04](04-settings.md)), and a visitor arriving in OS dark
mode should not be flashbanged.

### 7.2 Hero

Full-viewport. A real warehouse or dispatch photograph, darkened with a gradient scrim so
the headline holds contrast. GSAP parallax: the photo translates at roughly 0.5× scroll
speed while the text scrolls at 1×.

Headline states the product's actual claim — that the dashboard tells you what to do, not
just what happened. Subhead names the concrete proof (the break-even finding). Primary
CTA **"Start free"** → `/signup`; secondary **"See the dashboard"** scroll-links to the
screenshot section.

### 7.3 Stat band

Four tiles, the numbers from § 4. anime.js counts each up when the band scrolls into view,
staggered ~100 ms. **Once, not on every scroll-back** — a number that re-animates every
time it re-enters the viewport is a fidget toy.

### 7.4 Feature sections

Three alternating photo/text rows, each GSAP-revealed on scroll (fade + 24px rise,
~500 ms):

1. **Insight, not just charts** — the actions-with-findings argument from
   [08](08-insights-bi.md).
2. **Permissions you can see** — a still of the matrix grid from [03](03-admin.md).
3. **No duplicate records, ever** — the idempotency story from [11](11-api-idempotency.md).

Each row's photo is real: a warehouse aisle, a dispatch desk, a stock check.

### 7.5 Product screenshot

The actual `/app/dashboard` in a browser frame, in both themes. **Decision:** a real
screenshot, not a mockup. It is honest, it is free, and it is what a reviewer wants to see
before signing up.

### 7.6 FOMO band

The requirement, handled in § 8.

### 7.7 Footer CTA

Full-width band, one headline, one button → `/signup`. Below it a minimal footer: a line
about the Superstore dataset, a GitHub link, no navigation maze.

---

## 8. The FOMO CTA — and the honesty constraint

`../Idea.txt` asks for a FOMO CTA. FOMO conventionally means scarcity ("3 seats left"),
urgency ("offer ends tonight") and social proof ("2,400 teams joined this month"). On a
portfolio MVP with no customers, all three of those are **fabricated claims about a real
product**, and a reviewer who notices will trust nothing else on the page.

**Decision: build the full FOMO CTA, using true statements.** The pattern is what was
asked for; the content stays factual. Urgency comes from the cost of *not* acting, which
is both a legitimate FOMO mechanism and the only one available honestly here.

| FOMO mechanism | Fabricated version (rejected) | Shipped version (true) |
|---|---|---|
| **Scarcity** | "Only 7 seats left at this price" | *"Free tier · 6 demo roles · no card required"* — real constraints of the actual offer |
| **Urgency** | "Offer ends in 04:59:12" | *"Every day at 20%+ discount costs this dataset $231 in margin."* Live-ticking counter of margin lost since page load, computed from the real per-day figure. Urgent, and true. |
| **Social proof** | Invented testimonials with stock-photo faces | *"Analysed on 9,994 real order lines from the Kaggle Superstore dataset"* + the GitHub repo link. The proof is the work, and it is verifiable. |
| **Loss aversion** | — | The margin-leak number in the band: *"17 products in this dataset lose money on every unit sold."* |

The ticking margin counter is the centrepiece: a number that visibly climbs while the
visitor reads is the FOMO mechanic, and it is derived from a real finding rather than a
countdown clock. Below it, the CTA: **"Find yours — start free"**.

Testimonials, if used at all, are attributed to roles rather than invented people
("What a regional manager sees") and are framed as capability statements, not quotes.
No fake logos, no fake faces, no fake counts.

---

## 9. User experience flow

### 9.1 Primary — visitor to signup

1. Visitor lands on `/`. → Hero photo is already visible (preloaded, `fetchpriority=high`);
   the headline animates in over ~400 ms. **Nothing important is hidden behind a scroll
   animation** — the value proposition is readable at 0 scroll, in the first second.
2. Scrolls. → The hero photo parallaxes; the stat band enters and the four numbers count
   up.
3. Continues. → Feature rows reveal one at a time. Motion is subtle: fade and rise, no
   spinning, no horizontal flying, no elements that arrive from off-screen edges.
4. Reaches the screenshot. → Sees the actual product.
5. Reaches the FOMO band. → The margin counter is ticking. The scarcity line states the
   real offer.
6. Clicks **Start free**. → `/signup` ([01](01-auth.md) § 7.2).

### 9.2 Returning signed-in visitor

1. Lands on `/`. → Same page, header CTA reads **"Go to dashboard"**.
2. Clicks it → `/app/dashboard`, no re-authentication.

### 9.3 Reduced motion

1. Visitor with `prefers-reduced-motion: reduce`. → **All** GSAP scroll animations, the
   parallax, the count-ups and the ticking counter are disabled. Content renders in its
   final state immediately.
2. → The page loses nothing but motion. Every number, photo and CTA is present and
   readable. This is not a degraded experience; for some users it is the only usable one.

### 9.4 States

| State | What the visitor sees |
|---|---|
| **First load** | Hero photo and headline within the first paint; below-fold sections in their pre-reveal state |
| **Loading** | No spinners anywhere — there is no data to wait for. Photos use a blurred low-res placeholder that resolves |
| **Empty** | Not applicable — the page has no data-dependent content |
| **Permission denied** | Not applicable — public route |
| **Error** | An image failing to load falls back to a solid token-colored block with the text still legible over it. The page must never be blocked by a failed asset |
| **JS disabled** | **Decision:** accepted degradation. This is a React SPA; the landing page is a route inside it. Content is unreachable without JS, and adding SSR for one page is disproportionate |

---

## 10. Edge cases

- **Image licensing.** Photos come from Unsplash, whose licence permits commercial use
  without attribution. Attribute anyway in the footer — it costs one line and it is the
  right habit. Never scrape stock-site previews.
- **Image weight.** Full-bleed photography is the heaviest thing on the site. Serve WebP,
  cap the hero at ~1920px wide, `loading="lazy"` on everything below the fold,
  `fetchpriority="high"` on the hero only, explicit `width`/`height` on every image to
  prevent layout shift.
- **GSAP ScrollTrigger and route changes.** Leaving `/` for `/signup` without killing the
  ScrollTriggers leaks listeners and, on return, produces animations that fire at the
  wrong offsets. Clean up on unmount — this is the single most common GSAP-in-React bug.
- **Parallax and mobile.** Scroll-linked parallax is janky on touch devices and interacts
  badly with mobile URL-bar resize. **Decision:** disable parallax below 768px; keep the
  reveals.
- **Photos and dark mode.** A photo does not have a dark variant. The scrim gradient and
  the text tokens change with the theme; the photograph stays as it is. Check contrast in
  both modes — a scrim tuned for dark text can leave light-mode headlines unreadable.
- **The ticking counter after a long idle.** A tab left open for hours shows an absurd
  accumulated number. Cap the display and reset on visibility change.
- **Sticky header over the hero.** Transparent over a photo, the logo can vanish against a
  light patch. Give the header a subtle gradient scrim of its own from the top.
- **Layout shift from the count-up.** A tile animating `0` → `9,994` changes width as
  digits are added. Reserve the final width, or use `tabular-nums`, or the whole band
  jitters.
- **Time to interactive.** The landing page loads the full SPA bundle including GSAP, D3
  and Chart.js unless routes are code-split. Split at the route level so `/` pulls GSAP
  and anime.js only — D3 and Chart.js belong to `/app/*`.

---

## 11. Acceptance checks

- [ ] `/` loads with no network requests to Supabase — verify in the Network tab.
- [ ] Every stat-band number matches a SQL query against the imported dataset (§ 4).
- [ ] No fabricated testimonial, customer count, logo or countdown appears anywhere on
      the page (§ 8).
- [ ] Enable `prefers-reduced-motion` in devtools → no parallax, no reveals, no count-up,
      no ticking; all content present and readable.
- [ ] Toggle theme on `/` → text stays legible over every photo in both modes.
- [ ] Resize to 390px → no horizontal page scroll; parallax disabled; every CTA reachable.
- [ ] Navigate `/` → `/signup` → back to `/` → animations fire correctly, no console
      errors, no duplicated ScrollTriggers.
- [ ] Signed in, visit `/` → header reads "Go to dashboard" and the link works.
- [ ] Lighthouse on `/` → no layout-shift warnings; hero image is the LCP element.
- [ ] Block image loading → headlines and CTAs remain readable over the fallback blocks.
- [ ] Live deploy: the Netlify URL loads `/` as the landing page (`../PLAN.md`
      § Verification).

---

## 12. Depends on / blocks

**Depends on:** nothing functional — it is the most independent module in the system,
which is why it can safely sit at P2. Needs the [04-settings.md](04-settings.md) theme
tokens and a screenshot of a working [07-dashboard-metrics.md](07-dashboard-metrics.md).

**Blocks:** nothing.

**Related:** [01-auth.md](01-auth.md) (the signup this page feeds),
[UI-PAGE-GUIDE.md](UI-PAGE-GUIDE.md) § `/`.
