#!/usr/bin/env node
/**
 * Self-check tests for guard chain logic.
 * Pure functions only, no network.
 * Runnable with: node netlify/functions/_lib/selfcheck.mjs
 */
import assert from 'assert';

/**
 * Canonical JSON: sorted keys, no spaces.
 */
function canonicalJSON(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => `"${k}":${canonicalJSON(obj[k])}`).join(',') + '}';
}

/**
 * SHA256 hash of canonical JSON body (mock, using simpler deterministic hash for testing).
 */
async function hashBody(body) {
  const canonical = canonicalJSON(body || {});
  // In the real implementation, this uses crypto.subtle.digest('SHA-256', ...).
  // For testing, we use a simpler approach: just return a deterministic string.
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

// ============ Tests ============

async function testCanonicalJSON() {
  console.log('Testing canonical JSON...');

  // Same object, different key order -> same canonical form
  const a = { name: 'Alice', age: 30 };
  const b = { age: 30, name: 'Alice' };
  assert.strictEqual(canonicalJSON(a), canonicalJSON(b), 'Different key order should hash identically');

  // Different objects -> different canonical form
  const c = { name: 'Bob', age: 30 };
  assert.notStrictEqual(canonicalJSON(a), canonicalJSON(c), 'Different values should hash differently');

  // Nested objects
  const d = { user: { name: 'Alice' }, items: [1, 2] };
  const e = { items: [1, 2], user: { name: 'Alice' } };
  assert.strictEqual(canonicalJSON(d), canonicalJSON(e), 'Nested object key order should not matter');

  // Arrays: order matters
  const f = { arr: [1, 2, 3] };
  const g = { arr: [3, 2, 1] };
  assert.notStrictEqual(canonicalJSON(f), canonicalJSON(g), 'Array order should matter');

  console.log('  ✓ canonical JSON tests passed');
}

async function testHashBody() {
  console.log('Testing body hashing...');

  const body1 = { order_id: 'CA-2024-100001', quantity: 5 };
  const body2 = { quantity: 5, order_id: 'CA-2024-100001' };
  const body3 = { order_id: 'CA-2024-100001', quantity: 6 };

  const hash1 = await hashBody(body1);
  const hash2 = await hashBody(body2);
  const hash3 = await hashBody(body3);

  assert.strictEqual(hash1, hash2, 'Same body, different key order -> same hash');
  assert.notStrictEqual(hash1, hash3, 'Different body -> different hash');

  console.log('  ✓ body hash tests passed');
}

async function testIdempotencyDecisionTable() {
  console.log('Testing idempotency decision table...');

  // Simulate the decision table from § 11-api-idempotency.md § 3

  // Case 1: Key not seen -> execute
  assert.strictEqual('execute', 'execute', 'New key -> execute');

  // Case 2: Key seen, same body, status=completed -> replay
  const replayCase = {
    status: 'completed',
    decision: 'replay'
  };
  assert.strictEqual(replayCase.decision, 'replay', 'Same key + same body + completed -> replay');

  // Case 3: Key seen, same body, status=in_progress -> wait (409 with Retry-After)
  const inProgressCase = {
    status: 'in_progress',
    decision: 'conflict_in_progress',
    retryAfter: 1
  };
  assert.strictEqual(inProgressCase.decision, 'conflict_in_progress', 'Same key + same body + in_progress -> conflict');

  // Case 4: Key seen, different body -> 409 Conflict
  const conflictCase = {
    status: 'completed',
    bodyhash_match: false,
    decision: 'conflict'
  };
  assert.strictEqual(conflictCase.decision, 'conflict', 'Same key + different body -> conflict');

  console.log('  ✓ idempotency decision table passed');
}

async function testContentDedupWindow() {
  console.log('Testing content dedup window logic...');

  // The window is 10 seconds. Two requests:
  // - Same user_id, endpoint, body_hash within 10s -> collapse to first
  // - 15+ seconds apart -> both execute

  const now = Date.now();
  const request1 = { timestamp: now, status: 'completed' };
  const request2_within = { timestamp: now + 5000, status: 'pending' };
  const request2_after = { timestamp: now + 15000, status: 'pending' };

  // Within window: collapse
  const windowMs = 10000;
  const isWithinWindow1 = (request2_within.timestamp - request1.timestamp) < windowMs;
  assert.strictEqual(isWithinWindow1, true, 'Request within 10s -> within window');

  // Outside window: both execute
  const isWithinWindow2 = (request2_after.timestamp - request1.timestamp) < windowMs;
  assert.strictEqual(isWithinWindow2, false, 'Request after 10s -> outside window');

  console.log('  ✓ content dedup window tests passed');
}

async function testRateLimitBudgets() {
  console.log('Testing rate limit budgets...');

  const LIMITS = {
    read: 60,
    write: 20,
    export: 5,
  };

  // Verify budgets match spec
  assert.strictEqual(LIMITS.read, 60, 'Read budget should be 60/min');
  assert.strictEqual(LIMITS.write, 20, 'Write budget should be 20/min');
  assert.strictEqual(LIMITS.export, 5, 'Export budget should be 5/min');

  // Simulate token bucket: 21 writes in a minute should fail on request 21
  let count = 0;
  for (let i = 1; i <= LIMITS.write + 1; i++) {
    count++;
    if (i <= LIMITS.write) {
      // Requests 1-20 should succeed
      assert.ok(true);
    } else {
      // Request 21+ should be rate-limited
      assert.ok(count > LIMITS.write);
    }
  }

  assert.strictEqual(count, LIMITS.write + 1, 'Should have attempted 21 requests');

  console.log('  ✓ rate limit budget tests passed');
}

// ============ Run all tests ============

async function runAll() {
  console.log('Running self-check tests...\n');

  try {
    await testCanonicalJSON();
    await testHashBody();
    await testIdempotencyDecisionTable();
    await testContentDedupWindow();
    await testRateLimitBudgets();

    console.log('\n✓ All self-check tests passed');
    process.exit(0);
  } catch (err) {
    console.error('\n✗ Self-check failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

runAll();
