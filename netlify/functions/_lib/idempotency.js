/**
 * Idempotency key handling: replay, conflict detection, content dedup.
 * Same key + same body -> replay stored response (status 200 + Idempotency-Replayed: true).
 * Same key + different body -> 409 Conflict.
 * New key -> execute & store response.
 * Content dedup: 10-second window on hash(user_id, endpoint, body).
 */
import { serviceClient } from './supa.js';

/**
 * Canonical JSON: sorted keys, no spaces. Ensures {"a":1,"b":2} and {"b":2,"a":1} hash identically.
 * Exported so selfcheck.mjs can test the REAL function instead of a copy of it.
 */
export function canonicalJSON(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJSON).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => `"${k}":${canonicalJSON(obj[k])}`).join(',') + '}';
}

/**
 * SHA256 hash of canonical JSON body.
 */
export async function hashBody(body) {
  const canonical = canonicalJSON(body || {});
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('');
}

export const EXPIRY_MS = 24 * 60 * 60 * 1000; // docs/11 § 5: a key older than 24h is treated as unseen

/**
 * Pure decision function: given an existing idempotency_keys row (whatever the
 * insert-first race just read back) and the incoming request's identity, decide
 * what to do. No I/O — this is the part selfcheck.mjs can and does exercise
 * directly, exactly as it runs in production.
 *
 * Returns one of:
 * - { status: 'expired' } - caller should reclaim the row and execute
 * - { status: 'conflict' }
 * - { status: 'in_progress', retryAfter }
 * - { status: 'replay', response, httpStatus }
 */
export function decideIdempotencyOutcome(existingRow, { userId, bodyHash, now = Date.now() }) {
  const age = now - new Date(existingRow.created_at).getTime();
  if (age > EXPIRY_MS) return { status: 'expired' };

  // Keys are scoped to (key, user_id) — a key can never collide across users.
  if (existingRow.user_id !== userId || existingRow.body_hash !== bodyHash) {
    return { status: 'conflict' };
  }

  if (existingRow.status === 'in_progress') {
    return { status: 'in_progress', retryAfter: 1 };
  }

  return { status: 'replay', response: existingRow.response, httpStatus: existingRow.http_status };
}

/**
 * Check idempotency key. Returns one of:
 * - { status: 'execute' } - proceed
 * - { status: 'replay', response, httpStatus } - return this response
 * - { status: 'conflict' } - 409
 * - { status: 'in_progress', retryAfter } - 409 with Retry-After
 *
 * INSERT FIRST, not select-then-insert. Two concurrent requests with the same
 * key both attempt this insert; the unique constraint on `key` lets exactly one
 * of them win and execute. The loser reads back whichever row actually landed
 * and decides replay / conflict / wait from that, instead of both racing into
 * "not seen yet" and both running the handler — the bug this feature exists to
 * prevent.
 */
export async function checkIdempotency(userId, endpoint, key, bodyHash) {
  const nowIso = new Date().toISOString();

  const { error: insertError } = await serviceClient.from('idempotency_keys').insert({
    key,
    user_id: userId,
    endpoint,
    body_hash: bodyHash,
    status: 'in_progress',
    created_at: nowIso,
  });

  if (!insertError) {
    // Won the race (or genuinely the first time this key has been seen).
    return { status: 'execute' };
  }

  // Anything other than a unique-violation is a real error, not a race.
  if (insertError.code !== '23505') throw insertError;

  const { data, error } = await serviceClient
    .from('idempotency_keys')
    .select('body_hash, status, response, http_status, created_at, user_id')
    .eq('key', key)
    .single();
  if (error) throw error;

  const decision = decideIdempotencyOutcome(data, { userId, bodyHash });

  if (decision.status === 'expired') {
    // Reclaim the row in place rather than deleting+inserting, so we don't
    // reopen the same race window a second time.
    const { error: updateError } = await serviceClient
      .from('idempotency_keys')
      .update({
        user_id: userId, endpoint, body_hash: bodyHash,
        status: 'in_progress', response: null, http_status: null,
        created_at: nowIso, completed_at: null,
      })
      .eq('key', key);
    if (updateError) throw updateError;
    return { status: 'execute' };
  }

  return decision;
}

/**
 * Mark an idempotency key as completed and store the response.
 */
export async function storeIdempotencyResponse(key, userId, response, httpStatus) {
  await serviceClient
    .from('idempotency_keys')
    .update({ status: 'completed', response, http_status: httpStatus, completed_at: new Date().toISOString() })
    .eq('key', key)
    .eq('user_id', userId);
}

/**
 * Release a failed idempotency key so a retry can proceed.
 */
export async function releaseIdempotencyKey(key, userId) {
  await serviceClient
    .from('idempotency_keys')
    .delete()
    .eq('key', key)
    .eq('user_id', userId);
}

/**
 * Content dedup: hash(user_id, endpoint, body_hash) inside 10s window.
 * If found and completed, return the first result. Otherwise, continue.
 */
export async function checkContentDedup(userId, endpoint, bodyHash) {
  const now = new Date();
  const since = new Date(now.getTime() - 10 * 1000);

  const { data, error } = await serviceClient
    .from('content_dedup')
    .select('response, http_status')
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .eq('body_hash', bodyHash)
    .gte('created_at', since.toISOString())
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') throw error;

  if (data) {
    return { found: true, response: data.response, httpStatus: data.http_status };
  }

  // Record this attempt
  await serviceClient.from('content_dedup').insert({
    user_id: userId,
    endpoint,
    body_hash: bodyHash,
    status: 'pending',
    created_at: now.toISOString(),
  });

  return { found: false };
}

/**
 * Mark a content_dedup entry as completed and store the response.
 */
export async function storeContentDedupResponse(userId, endpoint, bodyHash, response, httpStatus) {
  await serviceClient
    .from('content_dedup')
    .update({ status: 'completed', response, http_status: httpStatus })
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .eq('body_hash', bodyHash)
    .gte('created_at', new Date(Date.now() - 10 * 1000).toISOString());
}
