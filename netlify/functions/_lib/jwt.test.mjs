/**
 * The guard stopped asking the Auth server whether a token is real, so this is
 * now the only thing standing between a forged token and the database. It gets
 * a test.
 *
 * Needs the real project: it signs in for a genuine ES256 token and fetches the
 * genuine JWKS. Run with `node netlify/functions/_lib/jwt.test.mjs` from the
 * repo root, with .env present.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyLocally } from './jwt.js';

const env = Object.fromEntries(
  readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const cfg = {
  supabaseUrl: env.VITE_SUPABASE_URL || env.SUPABASE_URL,
  anonKey: env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY,
};

const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: cfg.anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@superstore.demo', password: 'demo1234' }),
});
const { access_token: real } = await res.json();
assert.ok(real, 'could not sign in to obtain a real token');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function rejects(label, token) {
  const outcome = await verifyLocally(token, cfg).then(
    (claims) => (claims ? 'ACCEPTED' : 'declined-to-verify'),
    (err) => (err.status === 401 ? 'rejected' : `threw ${err.message}`)
  );
  assert.notEqual(outcome, 'ACCEPTED', `${label} was ACCEPTED`);
  console.log(`  ok  ${label}: ${outcome}`);
}

// 1. The real thing verifies, and reports the right subject.
const claims = await verifyLocally(real, cfg);
assert.ok(claims, 'a genuine token must verify locally');
assert.match(claims.sub, /^[0-9a-f-]{36}$/);
assert.equal(claims.email, 'admin@superstore.demo');
console.log(`  ok  genuine token verifies (sub ${claims.sub})`);

const [h, p, s] = real.split('.');

// 2. Payload swapped for another user id, signature untouched. This is the
//    attack the whole file exists to stop.
//    Derive the impostor id from the real one so this can never accidentally
//    equal it — the seeded admin really is ...0001, which made an earlier
//    hardcoded "other" id identical to the genuine claim and the test vacuous.
const realClaims = JSON.parse(Buffer.from(p, 'base64url'));
const otherSub = { ...realClaims, sub: realClaims.sub.replace(/.$/, (c) => (c === '9' ? '8' : '9')) };
assert.notEqual(otherSub.sub, realClaims.sub);
await rejects('tampered payload (different sub)', `${h}.${b64(otherSub)}.${s}`);

// 3. Signature flipped.
const flipped = Buffer.from(s, 'base64url');
flipped[0] ^= 0xff;
await rejects('flipped signature', `${h}.${p}.${flipped.toString('base64url')}`);

// 4. alg: none, the classic.
await rejects('alg none', `${b64({ alg: 'none', typ: 'JWT' })}.${p}.`);

// 5. Unsigned token with the right shape but no key reference.
await rejects('no kid', `${b64({ alg: 'ES256', typ: 'JWT' })}.${p}.${s}`);

// 6. Expired, re-signed? Cannot forge a signature, so assert the expiry check
//    fires by verifying a genuine token whose exp has been moved into the past
//    — it must fail on signature OR expiry, never pass.
const expired = { ...JSON.parse(Buffer.from(p, 'base64url')), exp: 1000 };
await rejects('expired', `${h}.${b64(expired)}.${s}`);

// 7. The anon key is itself a JWT. It must never work as a session.
await rejects('anon key used as a session token', cfg.anonKey);

console.log('\nALL GREEN');
