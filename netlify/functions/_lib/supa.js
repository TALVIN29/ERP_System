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
 * That call round-trips to Supabase Auth and confirms the signature/expiry.
 *
 * It is now the FALLBACK path: _lib/jwt.js checks the ES256 signature against
 * the project's published JWKS without leaving the function, which is the same
 * cryptographic check without the round trip. This still runs for tokens that
 * cannot be verified from a public key (a legacy HS256 project). Never
 * construct the "authenticated user" from a locally base64-decoded payload —
 * decoding is not verifying.
 */
export function anonClient() {
  return createClient(url, anonKey);
}

/** The values _lib/jwt.js needs to fetch and pin the JWKS. */
export const projectConfig = { supabaseUrl: url, anonKey };
