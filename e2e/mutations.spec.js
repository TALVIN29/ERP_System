import { test, expect } from '@playwright/test';

/**
 * Mutating tests.
 *
 * These run against a real database, so they follow two rules:
 *  1. Only ever delete a row this file created. Pre-existing Superstore data is
 *     read-only here.
 *  2. Round-trip saves (matrix, settings) write back the state they just read,
 *     so a test run never changes what the demo shows.
 *
 * The headline test is the double-submit one. docs/11-api-idempotency.md § 6.3
 * makes "two clicks produce one record" the acceptance criterion, and it is the
 * one the assignment actually grades.
 */

const PASSWORD = 'demo1234';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';

/**
 * These tests write. Running them against the production project once deleted
 * all 73 role_permissions rows and locked every user out of every endpoint, so
 * they now refuse to run unless the target is explicitly declared disposable.
 *
 *   ALLOW_MUTATION_TESTS=1 BASE_URL=http://localhost:8888 npx playwright test mutations
 */
const ALLOWED = process.env.ALLOW_MUTATION_TESTS === '1';
const target = process.env.BASE_URL || '';
const looksLikeProd = /netlify\.app|https:\/\//.test(target) && !/localhost|127\.0\.0\.1/.test(target);

test.skip(
  !ALLOWED || looksLikeProd,
  `mutation tests are disabled for this target (${target || 'default'}). ` +
  'Point BASE_URL at a disposable environment and set ALLOW_MUTATION_TESTS=1.'
);

async function token(request, email) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY || '', 'Content-Type': 'application/json' },
    data: { email, password: PASSWORD },
  });
  const body = await res.json();
  expect(body.access_token, 'login failed').toBeTruthy();
  return body.access_token;
}

test.describe('idempotency', () => {
  test('the same key sent twice creates exactly ONE order', async ({ request }) => {
    const jwt = await token(request, 'admin@superstore.demo');
    const orderId = `E2E-${Date.now()}`;
    const key = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const payload = {
      order_id: orderId,
      customer_id: 'CG-12520',
      order_date: '2018-01-01',
      ship_date: '2018-01-05',
      ship_mode: 'Standard Class',
      region: 'East',
    };

    const send = () =>
      request.post('/api/orders', {
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Idempotency-Key': key,
          'Content-Type': 'application/json',
        },
        data: payload,
      });

    // Fire both at once — the concurrent case is the one a select-then-insert
    // implementation gets wrong.
    const [a, b] = await Promise.all([send(), send()]);
    const statuses = [a.status(), b.status()].sort();

    try {
      // Both must succeed (one executes, one replays). Neither may 5xx.
      expect(statuses.every((s) => s < 500), `got ${statuses}`).toBe(true);

      // Exactly one row must exist, whatever the responses said.
      const list = await request.get(`/api/orders?q=${orderId}&pageSize=50`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const { rows } = await list.json();
      const mine = (rows || []).filter((r) => r.order_id === orderId);
      expect(mine.length, 'double-submit created more than one row').toBe(1);
    } finally {
      // Only ever removes the row this test made.
      await request.delete('/api/orders', {
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Idempotency-Key': `cleanup-${key}`,
          'Content-Type': 'application/json',
        },
        data: { order_id: orderId },
      });
    }
  });

  test('the same key with a DIFFERENT body is refused with 409', async ({ request }) => {
    const jwt = await token(request, 'admin@superstore.demo');
    const key = `e2e-conflict-${Date.now()}`;
    const orderId = `E2E-C-${Date.now()}`;

    const base = {
      order_id: orderId, customer_id: 'CG-12520', order_date: '2018-01-01',
      ship_date: '2018-01-05', ship_mode: 'Standard Class', region: 'East',
    };

    const first = await request.post('/api/orders', {
      headers: { Authorization: `Bearer ${jwt}`, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
      data: base,
    });

    try {
      expect(first.status(), await first.text()).toBeLessThan(400);

      const second = await request.post('/api/orders', {
        headers: { Authorization: `Bearer ${jwt}`, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
        data: { ...base, region: 'West' },
      });
      expect(second.status(), 'reusing a key with a different body must 409').toBe(409);
    } finally {
      await request.delete('/api/orders', {
        headers: { Authorization: `Bearer ${jwt}`, 'Idempotency-Key': `cleanup-${key}`, 'Content-Type': 'application/json' },
        data: { order_id: orderId },
      });
    }
  });

  test('a mutation without an Idempotency-Key is rejected', async ({ request }) => {
    const jwt = await token(request, 'admin@superstore.demo');
    const res = await request.post('/api/orders', {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      data: { order_id: `E2E-NOKEY-${Date.now()}`, customer_id: 'CG-12520', region: 'East' },
    });
    expect(res.status(), 'a write with no key should not be accepted').toBeGreaterThanOrEqual(400);
  });
});

test.describe('round-trip saves', () => {
  test('the permission matrix saves and returns server state', async ({ request }) => {
    const jwt = await token(request, 'admin@superstore.demo');
    const read = await request.get('/api/admin-roles', { headers: { Authorization: `Bearer ${jwt}` } });
    expect(read.status()).toBe(200);
    const { grants } = await read.json();
    expect(Object.keys(grants || {}).length, 'no roles returned').toBeGreaterThan(0);

    // Writes back exactly what was read, so the demo is unchanged.
    const save = await request.put('/api/admin-roles', {
      headers: { Authorization: `Bearer ${jwt}`, 'Idempotency-Key': `e2e-matrix-${Date.now()}`, 'Content-Type': 'application/json' },
      data: { grants },
    });
    expect(save.status(), await save.text()).toBe(200);
    const after = await save.json();
    expect(after.grants.admin.sort()).toEqual(grants.admin.sort());
  });

  test('the lockout guard refuses to strip the last roles.update', async ({ request }) => {
    const jwt = await token(request, 'admin@superstore.demo');
    const read = await request.get('/api/admin-roles', { headers: { Authorization: `Bearer ${jwt}` } });
    const { grants } = await read.json();

    // Remove roles.update everywhere — the server must refuse regardless of UI.
    const stripped = Object.fromEntries(
      Object.entries(grants).map(([k, v]) => [k, v.filter((p) => p !== 'roles.update')])
    );

    const res = await request.put('/api/admin-roles', {
      headers: { Authorization: `Bearer ${jwt}`, 'Idempotency-Key': `e2e-lockout-${Date.now()}`, 'Content-Type': 'application/json' },
      data: { grants: stripped },
    });
    expect(res.status(), 'stripping the last roles.update must be refused').toBe(409);

    // And it must not have taken effect.
    const verify = await request.get('/api/admin-roles', { headers: { Authorization: `Bearer ${jwt}` } });
    const { grants: still } = await verify.json();
    expect(Object.values(still).some((g) => g.includes('roles.update'))).toBe(true);
  });
});
