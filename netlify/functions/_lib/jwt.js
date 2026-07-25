/**
 * Verify a Supabase access token locally, using the project's published JWKS.
 *
 * The guard used to call `auth.getUser(token)`, which is an HTTPS round trip to
 * the Auth server before ANY other work can start — and because every later
 * step needs the user id, it sat in front of the whole chain. It was the single
 * largest fixed cost on every request: /api/settings, whose handler is one tiny
 * select, still took 1.69s.
 *
 * Supabase signs with ES256 and publishes the public key at
 * /auth/v1/.well-known/jwks.json, so the signature can be checked here with
 * node:crypto and no dependency. This is not a weaker check than asking the
 * server: it verifies the same signature against the same key, plus expiry,
 * issuer and role. What it does NOT do is notice a session revoked in the
 * seconds before the token's own expiry — access tokens are short-lived, and
 * the permission grants that decide what the caller may actually do are still
 * read fresh from the database on every request.
 *
 * A project still using the legacy shared-secret (HS256) scheme has no usable
 * JWKS entry; those tokens fall back to the remote check rather than being
 * accepted unverified.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const JWKS_TTL_MS = 10 * 60 * 1000;

let jwksCache = { keys: new Map(), fetchedAt: 0 };

function b64urlToBuf(s) {
  return Buffer.from(s, 'base64url');
}

async function loadKeys(supabaseUrl, anonKey) {
  const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
    headers: { apikey: anonKey },
  });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys = [] } = await res.json();

  const map = new Map();
  for (const jwk of keys) {
    // Only asymmetric signing keys can be verified from a public JWK. An
    // 'oct' entry would be the shared secret and must never be trusted here.
    if (jwk.kty !== 'EC' && jwk.kty !== 'RSA') continue;
    if (jwk.use && jwk.use !== 'sig') continue;
    map.set(jwk.kid, { key: createPublicKey({ key: jwk, format: 'jwk' }), alg: jwk.alg });
  }
  jwksCache = { keys: map, fetchedAt: Date.now() };
  return map;
}

async function keyFor(kid, supabaseUrl, anonKey) {
  const fresh = Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid);
  // Unknown kid means the project rotated its signing key: refetch immediately
  // rather than rejecting every request until the TTL lapses.
  const keys = await loadKeys(supabaseUrl, anonKey);
  return keys.get(kid) || null;
}

const NODE_ALG = {
  ES256: { hash: 'sha256', opts: { dsaEncoding: 'ieee-p1363' } },
  ES512: { hash: 'sha512', opts: { dsaEncoding: 'ieee-p1363' } },
  RS256: { hash: 'sha256', opts: {} },
};

/**
 * @returns {Promise<{sub:string, email?:string}|null>} claims, or null when the
 *   token cannot be verified locally (caller should fall back, then reject).
 * @throws {Error} when the token IS locally verifiable and is invalid.
 */
export async function verifyLocally(token, { supabaseUrl, anonKey }) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  try {
    header = JSON.parse(b64urlToBuf(parts[0]).toString('utf8'));
  } catch {
    return null;
  }

  const spec = NODE_ALG[header.alg];
  // 'none', HS256, or anything unrecognised: not verifiable from a public key.
  if (!spec || !header.kid) return null;

  const entry = await keyFor(header.kid, supabaseUrl, anonKey);
  if (!entry) return null;
  // The key's own algorithm wins over the token's header, so a token cannot
  // nominate a weaker algorithm for a key that was published for a stronger one.
  if (entry.alg && entry.alg !== header.alg) throw invalid();

  const ok = cryptoVerify(
    spec.hash,
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: entry.key, ...spec.opts },
    b64urlToBuf(parts[2])
  );
  if (!ok) throw invalid();

  let claims;
  try {
    claims = JSON.parse(b64urlToBuf(parts[1]).toString('utf8'));
  } catch {
    throw invalid();
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) throw invalid('Session expired. Please sign in again.');
  if (typeof claims.nbf === 'number' && claims.nbf > now + 5) throw invalid();
  if (claims.iss !== `${supabaseUrl}/auth/v1`) throw invalid();
  // Supabase issues 'authenticated' for a signed-in user; anon/service keys are
  // JWTs too and must not be usable as a session.
  if (claims.role !== 'authenticated') throw invalid();
  if (!claims.sub) throw invalid();

  return claims;
}

function invalid(message) {
  const err = new Error(message || 'Invalid or expired session. Please sign in again.');
  err.status = 401;
  err.code = 'invalid_jwt';
  return err;
}
