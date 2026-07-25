import { test, expect } from '@playwright/test';

/**
 * Server-side authorization checks. Safe to run against any environment,
 * including production: every request here is expected to be REFUSED, and the
 * one that names a record targets an id that does not exist, so a regression
 * shows up as a wrong status code rather than as deleted data.
 *
 * These belong outside mutations.spec.js precisely so they still run where the
 * writing tests must not.
 */

const PASSWORD = 'demo1234';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://yzjqapladdukezuadoxw.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || '';

async function token(request, email) {
  const res = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    data: { email, password: PASSWORD },
  });
  const body = await res.json();
  expect(body.access_token, `login failed for ${email}`).toBeTruthy();
  return body.access_token;
}

test.describe('authorization is enforced by the server, not by hiding UI', () => {
  test('an unauthenticated request is refused', async ({ request }) => {
    const res = await request.get('/api/orders');
    expect(res.status()).toBe(401);
  });

  test('a forged JWT is refused', async ({ request }) => {
    // If verification were a base64 decode, this token would be accepted and
    // would impersonate the admin user id outright.
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        sub: '00000000-0000-0000-0000-000000000001',
        role: 'authenticated',
        exp: 4102444800,
      })).toString('base64url'),
      'not-a-real-signature',
    ].join('.');

    const res = await request.get('/api/orders', { headers: { Authorization: `Bearer ${forged}` } });
    expect(res.status(), 'a forged token must not be accepted').toBe(401);
  });

  test('a Manager cannot read the permission matrix', async ({ request }) => {
    const jwt = await token(request, 'manager@superstore.demo');
    const res = await request.get('/api/admin-roles', { headers: { Authorization: `Bearer ${jwt}` } });
    expect(res.status()).toBe(403);
  });

  test('a Viewer cannot delete an order', async ({ request }) => {
    const jwt = await token(request, 'viewer@superstore.demo');
    // Deliberately a non-existent id: a passing test proves the permission gate
    // fired, and a regression cannot destroy a real row.
    const res = await request.delete('/api/orders', {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Idempotency-Key': `e2e-viewer-${Date.now()}`,
        'Content-Type': 'application/json',
      },
      data: { order_id: 'E2E-DOES-NOT-EXIST' },
    });
    expect(res.status(), 'Viewer delete must be refused before the row is even looked up').toBe(403);
  });

  test('a Viewer cannot create an order', async ({ request }) => {
    const jwt = await token(request, 'viewer@superstore.demo');
    const res = await request.post('/api/orders', {
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Idempotency-Key': `e2e-viewer-c-${Date.now()}`,
        'Content-Type': 'application/json',
      },
      data: { order_id: `E2E-VIEWER-${Date.now()}`, customer_id: 'CG-12520', region: 'East' },
    });
    expect(res.status()).toBe(403);
  });

  test('a mutation without an Idempotency-Key is rejected', async ({ request }) => {
    const jwt = await token(request, 'admin@superstore.demo');
    const res = await request.post('/api/orders', {
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      data: { order_id: `E2E-NOKEY-${Date.now()}`, customer_id: 'CG-12520', region: 'East' },
    });
    // Must not reach the insert. Anything 2xx here means a write happened.
    expect(res.status(), 'a write with no idempotency key must not be accepted').toBeGreaterThanOrEqual(400);
  });
});
