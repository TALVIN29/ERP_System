/**
 * Postgres token bucket rate limiting, per user.
 * Separate budgets: 60 read/min, 20 write/min, 5/min for export.
 */
import { serviceClient } from './supa.js';

export const LIMITS = {
  read: 60,
  write: 20,
  export: 5,
};

export const WINDOW_SECS = 60;

/**
 * One atomic round trip.
 *
 * This used to be a compare-and-swap retry loop over SELECT then UPDATE,
 * because the correct fix — an atomic increment in SQL — needed a migration
 * the earlier change was not allowed to make. It exists now as
 * `bump_rate_limit()` in supabase/08_perf2.sql, so the loop is gone.
 *
 * That matters for more than tidiness: rate limiting sits on the hot path of
 * every single request, and two sequential round trips from a Netlify function
 * to the database were a measurable part of ~2s of guard-chain overhead.
 *
 * The upsert both increments and resets an expired window in one statement, so
 * the race the retry loop existed to survive can no longer occur.
 *
 * @param {string} userId
 * @param {'read'|'write'|'export'} type
 * @returns {Promise<number>} remaining quota
 * @throws {Error & {status:429, retryAfter:number}}
 */
export async function checkRateLimit(userId, type) {
  const limit = LIMITS[type] ?? LIMITS.read;

  const { data, error } = await serviceClient.rpc('bump_rate_limit', {
    p_user: userId,
    p_type: type,
    p_limit: limit,
    p_window_seconds: WINDOW_SECS,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // Fail closed: an unreadable budget must not be treated as an empty one.
    const err = new Error('Too many requests right now. Try again shortly.');
    err.status = 429;
    err.retryAfter = 1;
    throw err;
  }

  if (!row.allowed) {
    const err = new Error(`Rate limit exceeded. Try again in ${row.retry_after}s.`);
    err.status = 429;
    err.retryAfter = Math.max(row.retry_after || 1, 1);
    throw err;
  }

  return row.remaining;
}
