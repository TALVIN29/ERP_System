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
 * @param {string} userId - user.id
 * @param {string} type - 'read', 'write', or 'export'
 * @returns {Promise<number>} - remaining quota
 * @throws {Object} { status: 429, error: ..., retryAfter: ... }
 */
export async function checkRateLimit(userId, type) {
  const limit = LIMITS[type];
  const now = new Date();

  // ponytail: global window per type; move to per-user rate limit jitter if needed
  const windowStart = new Date(now.getTime() - WINDOW_SECS * 1000);

  const { data, error } = await serviceClient
    .from('rate_limits')
    .select('count')
    .eq('user_id', userId)
    .eq('type', type)
    .gte('window_start', windowStart.toISOString())
    .single();

  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows

  const current = data?.count || 0;
  if (current >= limit) {
    const retryAfter = Math.ceil((WINDOW_SECS * 1000 - (now.getTime() - new Date(data.window_start).getTime())) / 1000);
    const err = new Error(`Rate limit exceeded. Try again in ${retryAfter}s.`);
    err.status = 429;
    err.retryAfter = retryAfter;
    throw err;
  }

  // Increment the bucket. On first write to this window, upsert creates it.
  if (!data) {
    await serviceClient.from('rate_limits').insert({
      user_id: userId,
      type,
      window_start: now.toISOString(),
      count: 1,
    });
  } else {
    await serviceClient
      .from('rate_limits')
      .update({ count: current + 1 })
      .eq('user_id', userId)
      .eq('type', type)
      .gte('window_start', windowStart.toISOString());
  }

  return limit - current - 1;
}
