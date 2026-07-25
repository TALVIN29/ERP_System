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
 * - reading a user's role/grants for the permission gate (step 5) — this must
 *   never be sourced from the request or the JWT, only from the DB
 * Never returned in any response. Redacted before JSON serialization.
 */
export const serviceClient = createClient(url, serviceKey);

/**
 * Anon-key client used ONLY to verify a bearer token via supabase.auth.getUser(token).
 * That call round-trips to Supabase Auth and confirms the signature/expiry; it is the
 * one legitimate way to trust a JWT's claims. Never construct the "authenticated user"
 * from a locally base64-decoded payload.
 */
export function anonClient() {
  return createClient(url, anonKey);
}
