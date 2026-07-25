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

const WINDOW_SECS = 60;

/**
 * Check rate limit for a user. Returns remaining count or throws 429.
 *
 * Two bugs fixed here:
 * - Check-then-act: reading `count` and later writing `count+1` as separate
 *   steps lets two concurrent requests both read 19, both pass, both write 20.
 *   Every write below is a conditional UPDATE guarded by `.eq(...)` on the
 *   exact value just read (compare-and-swap). If a concurrent writer changed
 *   the row first, the CAS matches zero rows, and we re-read and retry — only
 *   one of the two racers can ever win a given increment.
 * - `window_start` was never advanced, so an expired window got a brand new
 *   row instead of resetting the existing one; rows piled up and `.single()`
 *   threw once two matched, turning a rate-limit decision into an uncaught
 *   500. Below, an expired window is reset on the SAME row.
 *
 * ponytail: a real atomic-increment SQL function (`rate_limits_bump(...)`)
 * would remove the retry loop entirely, but that requires a migration in
 * supabase/, which this fix is not allowed to touch. CAS loop is the fallback
 * that is still correct without one.
 *
 * @param {string} userId - user.id
 * @param {string} type - 'read', 'write', or 'export'
 * @returns {Promise<number>} - remaining quota
 * @throws {Object} { status: 429, error: ..., retryAfter: ... }
 */
export async function checkRateLimit(userId, type) {
  const limit = LIMITS[type];
  const MAX_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const now = new Date();

    const { data, error } = await serviceClient
      .from('rate_limits')
      .select('count, window_start')
      .eq('user_id', userId)
      .eq('type', type)
      .maybeSingle();
    if (error) throw error;

    // No row yet: first request ever for this user/type.
    if (!data) {
      const { error: insertError } = await serviceClient.from('rate_limits').insert({
        user_id: userId, type, window_start: now.toISOString(), count: 1,
      });
      if (!insertError) return limit - 1;
      if (insertError.code !== '23505') throw insertError;
      continue; // someone else inserted first — re-read and fall into the update path
    }

    const windowExpired = now.getTime() - new Date(data.window_start).getTime() >= WINDOW_SECS * 1000;

    if (windowExpired) {
      // Advance the window on the existing row (CAS on the stale window_start),
      // never insert a second row for this user/type.
      const { data: updated, error: updateError } = await serviceClient
        .from('rate_limits')
        .update({ window_start: now.toISOString(), count: 1 })
        .eq('user_id', userId).eq('type', type).eq('window_start', data.window_start)
        .select('count');
      if (updateError) throw updateError;
      if (updated && updated.length) return limit - 1;
      continue; // lost the race to another request resetting the window
    }

    if (data.count >= limit) {
      const retryAfter = Math.ceil((WINDOW_SECS * 1000 - (now.getTime() - new Date(data.window_start).getTime())) / 1000);
      const err = new Error(`Rate limit exceeded. Try again in ${retryAfter}s.`);
      err.status = 429;
      err.retryAfter = Math.max(retryAfter, 1);
      throw err;
    }

    // Atomic increment: CAS on `count` so two racers reading the same value
    // cannot both write the same next value.
    const { data: updated, error: updateError } = await serviceClient
      .from('rate_limits')
      .update({ count: data.count + 1 })
      .eq('user_id', userId).eq('type', type).eq('count', data.count)
      .select('count');
    if (updateError) throw updateError;
    if (updated && updated.length) return limit - (data.count + 1);
    // lost the CAS race — someone else incremented first; re-read fresh count
  }

  // Heavy contention exhausted our retries. Fail closed (throttle) rather than
  // let an unresolved race admit a request past its budget.
  const err = new Error('Too many requests right now. Try again shortly.');
  err.status = 429;
  err.retryAfter = 1;
  throw err;
}
