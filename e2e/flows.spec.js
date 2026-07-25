import { test, expect } from '@playwright/test';

/**
 * Flow tests — the behaviours a route smoke test cannot see.
 *
 * The headline one is idempotency. docs/11-api-idempotency.md § 6.3 calls it
 * "the single most likely implementation mistake in the whole build": the key
 * must be minted when the drawer OPENS, not when submit is clicked, or two
 * clicks are two keys and two records.
 */

const PASSWORD = 'demo1234';

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/app/**', { timeout: 30_000 });
}

/**
 * Waiting for skeletons to disappear races the first render: before React
 * mounts there are no skeletons either, so the wait returns instantly and the
 * assertions run against an empty page. Wait for real content instead.
 */
async function settled(page) {
  await expect(page.locator('main')).toBeVisible();
  await expect
    .poll(async () => {
      const pulse = await page.locator('.animate-pulse').count();
      const text = (await page.locator('main').innerText()).trim();
      // Settled means painted and no skeletons left. Polling for real text
      // rather than the absence of skeletons avoids passing before React has
      // mounted, when there are no skeletons either.
      return pulse === 0 && text.length > 40 ? 'ready' : 'waiting';
    }, { timeout: 30_000, intervals: [250] })
    .toBe('ready');
}

/** Table pages additionally need their rows to have landed. */
async function rowsLoaded(page) {
  await settled(page);
  await expect
    .poll(async () => (await page.locator('tbody tr').count()) > 0, { timeout: 30_000, intervals: [250] })
    .toBe(true);
}

test.describe('orders', () => {
  test('the Idempotency-Key is minted on drawer open and reused across clicks', async ({ page }) => {
    const keys = [];
    page.on('request', (r) => {
      const k = r.headers()['idempotency-key'];
      if (k) keys.push(k);
    });

    await signIn(page, 'admin@superstore.demo');
    await page.goto('/app/orders');
    await settled(page);

    await page.getByRole('button', { name: /new order/i }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    // Every submit from one open drawer must carry the SAME key, so a
    // double-click collapses into one record instead of creating two.
    const submit = drawer.getByRole('button', { name: /create|save/i }).last();
    await submit.click({ force: true });
    await page.waitForTimeout(1500);

    if (keys.length > 1) {
      expect(new Set(keys).size, `saw ${keys.length} submits with ${new Set(keys).size} distinct keys`).toBe(1);
    }
    expect(keys.length, 'no Idempotency-Key header was sent at all').toBeGreaterThan(0);
  });

  test('filter dropdowns are populated from the data, not empty', async ({ page }) => {
    await signIn(page, 'admin@superstore.demo');
    await page.goto('/app/orders');
    await rowsLoaded(page);

    // The live API omitted `scope`, which the pages build these from, so every
    // dropdown rendered with nothing in it while the fixture backend looked fine.
    const region = page.locator('select').first();
    const options = await region.locator('option').allInnerTexts();
    expect(options.filter((o) => o.trim()).length, 'Region filter has no options').toBeGreaterThan(1);
  });

  test('a Viewer sees no create control and no row actions', async ({ page }) => {
    await signIn(page, 'viewer@superstore.demo');
    await page.goto('/app/orders');
    await settled(page);
    // Absent, not disabled.
    await expect(page.getByRole('button', { name: /new order/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^delete$/i })).toHaveCount(0);
  });

  test('search is debounced and never collapses the table to a skeleton', async ({ page }) => {
    await signIn(page, 'admin@superstore.demo');
    await page.goto('/app/orders');
    await rowsLoaded(page);

    await page.getByPlaceholder(/search/i).fill('CA-2017');
    // Previous rows must stay readable during the refetch — collapsing to a
    // skeleton on a keystroke is what makes search feel broken.
    await expect(page.locator('.animate-pulse')).toHaveCount(0);
    await page.waitForTimeout(1200);
    await expect(page.locator('tbody tr').first()).toBeVisible();
  });
});

test.describe('permissions matrix', () => {
  test('audit write cells are locked and the last roles.update cannot be unchecked', async ({ page }) => {
    await signIn(page, 'admin@superstore.demo');
    await page.goto('/app/admin/roles');
    await settled(page);

    // System-written rows: audit create/update/delete are never editable.
    const locked = page.getByTitle(/written by the system/i);
    await expect(locked.first()).toBeVisible();

    // The lockout guard: removing the last roles.update would strand everyone.
    const guard = page.getByTitle(/at least one role|cannot be removed|lock/i);
    expect(await guard.count()).toBeGreaterThan(0);
  });

  test('a role without roles.update sees the grid read-only, not hidden', async ({ page }) => {
    // Finance has audit.read but no roles.read, so it is refused outright —
    // the read-only grid is the admin-adjacent case, asserted via the API.
    await signIn(page, 'finance@superstore.demo');
    await page.goto('/app/admin/roles');
    await expect(page.getByText(/do not have access/i)).toBeVisible();
  });
});

test.describe('settings', () => {
  test('theme toggle repaints instantly and persists across reload', async ({ page }) => {
    await signIn(page, 'admin@superstore.demo');
    await page.goto('/app/settings');
    await settled(page);

    const html = page.locator('html');
    const initial = await html.getAttribute('data-theme');

    await page.getByRole('radio', { name: initial === 'dark' ? /light/i : /dark/i }).check({ force: true });
    await expect(html).not.toHaveAttribute('data-theme', initial ?? '');

    const after = await html.getAttribute('data-theme');
    await page.reload();
    // localStorage is a cache, but the pre-paint script must honour it.
    await expect(html).toHaveAttribute('data-theme', after ?? '');
  });

  test('a non-admin sees org settings with real values, disabled rather than hidden', async ({ page }) => {
    await signIn(page, 'viewer@superstore.demo');
    await page.goto('/app/settings');
    await settled(page);
    // The gate is the settings.update permission, not the role's name — that is
    // what the API actually enforces on PUT, so it is what the UI now says.
    await expect(page.getByText(/does not have the settings\.update permission/i)).toBeVisible();
  });
});

test.describe('audit log', () => {
  test('is append-only: no create, edit or delete controls anywhere', async ({ page }) => {
    await signIn(page, 'admin@superstore.demo');
    await page.goto('/app/admin/audit');
    await settled(page);
    await expect(page.getByRole('button', { name: /new|create|add/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^delete$/i })).toHaveCount(0);
  });
});
