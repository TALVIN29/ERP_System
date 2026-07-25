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
 */
function canonicalJSON(obj) {
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

/**
 * Check idempotency key. Returns one of:
 * - { status: 'execute' } - proceed
 * - { status: 'replay', response, httpStatus } - return this response
 * - { status: 'conflict' } - 409
 * - { status: 'in_progress', retryAfter } - 409 with Retry-After
 */
export async function checkIdempotency(userId, endpoint, key, bodyHash) {
  const { data, error } = await serviceClient
    .from('idempotency_keys')
    .select('body_hash, status, response, http_status')
    .eq('key', key)
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows

  // Key not seen before
  if (!data) {
    await serviceClient.from('idempotency_keys').insert({
      key,
      user_id: userId,
      endpoint,
      body_hash: bodyHash,
      status: 'in_progress',
      created_at: new Date().toISOString(),
    });
    return { status: 'execute' };
  }

  // Key seen, different body
  if (data.body_hash !== bodyHash) {
    return { status: 'conflict' };
  }

  // Same key, same body, still in progress
  if (data.status === 'in_progress') {
    return { status: 'in_progress', retryAfter: 1 };
  }

  // Replay the stored response
  return { status: 'replay', response: data.response, httpStatus: data.http_status };
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
