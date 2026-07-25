import { test, expect } from '@playwright/test';

/**
 * Route smoke test.
 *
 * Every bug that reached production in this project was invisible to the
 * compiler and visible the instant a human opened the page:
 *   - Orders/Products/Customers: "Cannot access 'e' before initialization"
 *   - Dashboard: "linear is not a registered scale"
 *   - Insights: "require is not defined"
 *   - /api/metrics: PGRST202, four RPCs that were never written
 *
 * So this asserts the two things that would have caught all four: the route
 * renders without an uncaught error, and it makes no failing API call.
 */

const PASSWORD = 'demo1234';

// Manager is deliberately included: it has a different permission set, and a
// page that only ever runs as admin hides every scoping and gating bug.
const ROLES = {
  admin: {
    email: 'admin@superstore.demo',
    routes: [
      '/app/dashboard', '/app/insights', '/app/orders', '/app/products',
      '/app/customers', '/app/admin/roles', '/app/admin/users',
      '/app/admin/audit', '/app/settings',
    ],
    nav: ['Dashboard', 'Insights', 'Orders', 'Products', 'Customers', 'Roles', 'Users', 'Audit', 'Settings'],
  },
  manager: {
    email: 'manager@superstore.demo',
    routes: ['/app/dashboard', '/app/insights', '/app/orders', '/app/products', '/app/customers', '/app/settings'],
    nav: ['Dashboard', 'Insights', 'Orders', 'Products', 'Customers', 'Settings'],
  },
};

/** Collects everything that would make a page broken-but-silent. */
function watch(page) {
  const errors = [];
  const failedApi = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400) failedApi.push(`${r.status()} ${r.url()}`);
  });
  return { errors, failedApi };
}

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/app/**', { timeout: 30_000 });
}

test.describe('public pages', () => {
  for (const path of ['/', '/login', '/signup']) {
    test(`${path} renders without errors`, async ({ page }) => {
      const { errors } = watch(page);
      await page.goto(path);
      await expect(page.locator('#root')).not.toBeEmpty();
      await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
      expect(errors, `console/page errors on ${path}`).toEqual([]);
    });
  }

  test('landing stat band counts to the real figures, never past them', async ({ page }) => {
    await page.goto('/');
    const band = page.locator('[data-number]');
    await band.first().scrollIntoViewIfNeeded();
    // The overshoot bug rendered 177,827 order lines and a 445% break-even.
    await expect(band.nth(0)).toHaveText('9,994', { timeout: 15_000 });
    await expect(band.nth(1)).toHaveText('$2.30M');
    await expect(band.nth(2)).toHaveText('3');
    await expect(band.nth(3)).toHaveText('30%');
  });
});

for (const [role, cfg] of Object.entries(ROLES)) {
  test.describe(`as ${role}`, () => {
    test(`nav shows exactly the permitted items`, async ({ page }) => {
      await signIn(page, cfg.email);
      const items = await page.locator('nav a').allInnerTexts();
      expect(items.map((s) => s.trim())).toEqual(cfg.nav);
    });

    for (const route of cfg.routes) {
      test(`${route} renders without errors`, async ({ page }) => {
        const { errors, failedApi } = watch(page);
        await signIn(page, cfg.email);
        await page.goto(route);

        // The error boundary catches a crash; assert it never shows.
        await expect(page.getByText('Unexpected Application Error')).toHaveCount(0);
        await expect(page.locator('main')).toBeVisible();

        // Wait out the skeletons so a failing fetch cannot pass as "loading".
        await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 25_000 });

        expect(failedApi, `failing API calls on ${route}`).toEqual([]);
        expect(errors, `console/page errors on ${route}`).toEqual([]);
      });
    }
  });
}

test('manager cannot reach an admin route by URL', async ({ page }) => {
  await signIn(page, ROLES.manager.email);
  await page.goto('/app/admin/roles');
  // Absent from nav is not enough; the direct URL must be refused too.
  await expect(page.getByText(/do not have access/i)).toBeVisible();
});

test('dashboard shows scoped figures, not global ones', async ({ page }) => {
  await signIn(page, ROLES.manager.email);
  await page.goto('/app/dashboard');
  await expect(page.locator('.animate-pulse')).toHaveCount(0, { timeout: 25_000 });
  // East only — the global figure is $2.3M, so this also proves RLS scoping.
  await expect(page.locator('main')).toContainText('$678,781');
});
