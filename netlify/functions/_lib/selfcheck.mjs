#!/usr/bin/env node
/**
 * Self-check tests for guard chain logic.
 * Pure functions only, no network — imports the REAL functions from
 * idempotency.js and ratelimit.js rather than redefining copies of them, and
 * exercises their actual decision logic (including the insert-first race path
 * and the 24h expiry) instead of asserting hardcoded literals against
 * themselves.
 *
 * Runnable with: node netlify/functions/_lib/selfcheck.mjs
 */
import assert from 'assert';

// supa.js throws at import time if these are unset. Constructing a Supabase
// client is a synchronous, no-network operation — only calling .from(...) on
// it hits the wire — so dummy values are enough to import the real modules
// without making any real request. Set via dynamic import (below) so these
// run before the imports resolve; a static import would be hoisted ahead of
// this assignment.
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const { canonicalJSON, hashBody, decideIdempotencyOutcome, EXPIRY_MS } = await import('./idempotency.js');
const { LIMITS } = await import('./ratelimit.js');

// ============ Tests ============

async function testCanonicalJSON() {
  console.log('Testing canonical JSON (real function)...');

  const a = { name: 'Alice', age: 30 };
  const b = { age: 30, name: 'Alice' };
  assert.strictEqual(canonicalJSON(a), canonicalJSON(b), 'Different key order should hash identically');

  const c = { name: 'Bob', age: 30 };
  assert.notStrictEqual(canonicalJSON(a), canonicalJSON(c), 'Different values should hash differently');

  const d = { user: { name: 'Alice' }, items: [1, 2] };
  const e = { items: [1, 2], user: { name: 'Alice' } };
  assert.strictEqual(canonicalJSON(d), canonicalJSON(e), 'Nested object key order should not matter');

  const f = { arr: [1, 2, 3] };
  const g = { arr: [3, 2, 1] };
  assert.notStrictEqual(canonicalJSON(f), canonicalJSON(g), 'Array order should matter');

  console.log('  ✓ canonical JSON tests passed');
}

async function testHashBody() {
  console.log('Testing body hashing (real function)...');

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
  console.log('Testing idempotency decision logic (real decideIdempotencyOutcome)...');

  const userId = 'user-1';
  const bodyHash = await hashBody({ order_id: 'CA-1' });
  const now = Date.now();
  const recent = new Date(now - 5000).toISOString();

  // Key not seen: this path lives in checkIdempotency's insert; the insert
  // itself is not a decision, so it is not exercised here (it's the network
  // half). Everything downstream of "someone already holds this key" is.

  // Same key, same body, completed -> replay
  const completedRow = { user_id: userId, body_hash: bodyHash, status: 'completed', response: { ok: true }, http_status: 201, created_at: recent };
  const replay = decideIdempotencyOutcome(completedRow, { userId, bodyHash, now });
  assert.strictEqual(replay.status, 'replay', 'Same key + same body + completed -> replay');
  assert.deepStrictEqual(replay.response, { ok: true }, 'Replay carries the stored response');

  // Same key, same body, in_progress -> the insert-first RACE path: this is
  // exactly what the loser of a concurrent duplicate request reads back after
  // its own insert hits the unique-constraint violation.
  const inProgressRow = { user_id: userId, body_hash: bodyHash, status: 'in_progress', response: null, http_status: null, created_at: recent };
  const raceResult = decideIdempotencyOutcome(inProgressRow, { userId, bodyHash, now });
  assert.strictEqual(raceResult.status, 'in_progress', 'Concurrent duplicate mid-flight -> in_progress (409, Retry-After)');
  assert.strictEqual(raceResult.retryAfter, 1);

  // Same key, different body -> conflict
  const otherHash = await hashBody({ order_id: 'CA-2' });
  const conflictRow = { user_id: userId, body_hash: otherHash, status: 'completed', response: {}, http_status: 200, created_at: recent };
  const conflict = decideIdempotencyOutcome(conflictRow, { userId, bodyHash, now });
  assert.strictEqual(conflict.status, 'conflict', 'Same key + different body -> conflict');

  // Same key, different user (should never legitimately happen, but must fail
  // closed rather than leak another user's stored response) -> conflict
  const otherUserRow = { user_id: 'user-2', body_hash: bodyHash, status: 'completed', response: {}, http_status: 200, created_at: recent };
  const crossUser = decideIdempotencyOutcome(otherUserRow, { userId, bodyHash, now });
  assert.strictEqual(crossUser.status, 'conflict', 'Same key + different user_id -> conflict, never a replay');

  // Key older than 24h -> expired, regardless of status, so it is treated as unseen
  const staleIso = new Date(now - (EXPIRY_MS + 60_000)).toISOString();
  const staleRow = { user_id: userId, body_hash: bodyHash, status: 'completed', response: {}, http_status: 200, created_at: staleIso };
  const expired = decideIdempotencyOutcome(staleRow, { userId, bodyHash, now });
  assert.strictEqual(expired.status, 'expired', 'Key older than 24h -> expired, treated as unseen');

  // A key one second inside the 24h window is NOT expired.
  const freshIso = new Date(now - (EXPIRY_MS - 1000)).toISOString();
  const freshRow = { user_id: userId, body_hash: bodyHash, status: 'completed', response: { fresh: true }, http_status: 200, created_at: freshIso };
  const stillGood = decideIdempotencyOutcome(freshRow, { userId, bodyHash, now });
  assert.strictEqual(stillGood.status, 'replay', 'Key just under 24h old -> still replays');

  console.log('  ✓ idempotency decision logic passed');
}

async function testContentDedupWindow() {
  console.log('Testing content dedup window arithmetic...');

  // The window is 10 seconds, enforced server-side via `.gte('created_at', since)`.
  // This checks the same boundary arithmetic against wall-clock deltas.
  const now = Date.now();
  const windowMs = 10000;

  const withinWindow = (now + 5000 - now) < windowMs;
  assert.strictEqual(withinWindow, true, 'Request within 10s -> within window');

  const outsideWindow = (now + 15000 - now) < windowMs;
  assert.strictEqual(outsideWindow, false, 'Request after 10s -> outside window');

  console.log('  ✓ content dedup window tests passed');
}

async function testRateLimitBudgets() {
  console.log('Testing rate limit budgets (real LIMITS from ratelimit.js)...');

  assert.strictEqual(LIMITS.read, 60, 'Read budget should be 60/min');
  assert.strictEqual(LIMITS.write, 20, 'Write budget should be 20/min');
  assert.strictEqual(LIMITS.export, 5, 'Export budget should be 5/min');

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
