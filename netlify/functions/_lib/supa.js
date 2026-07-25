/**
 * Two Supabase clients: one as the user (RLS applies), one as service role
 * (for idempotency/rate-limit/audit bookkeeping).
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error('Missing Supabase env vars');
}

/**
 * Create a Supabase client authenticated as the user. RLS policies apply.
 * @param {string} accessToken - the user's JWT from Supabase auth
 * @returns {SupabaseClient}
 */
export function userClient(accessToken) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Service-role client for platform bookkeeping. Used only for:
 * - idempotency key storage/lookup
 * - rate limit token bucket
 * - audit log writes
 * Never returned in any response. Redacted before JSON serialization.
 */
export const serviceClient = createClient(url, serviceKey);
