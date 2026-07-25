/**
 * The 6-step middleware chain every endpoint runs through.
 * 1. Verify JWT -> 401
 * 2. Rate limit -> 429 + Retry-After
 * 3. Idempotency -> replay 200 | 409
 * 4. Content dedup -> collapse to first result
 * 5. Permission + scope -> 403
 * 6. Execute + store + audit
 *
 * Each endpoint passes { module, action, run } to guard(), which wraps the handler.
 * `action` is what step 5 checks for GET; mutating verbs map to create/update/delete
 * below so a CRUD endpoint only has to declare its read-side pair once.
 */
import { serviceClient, anonClient, userClient } from './supa.js';
import { checkRateLimit } from './ratelimit.js';
import { hashBody, checkIdempotency, storeIdempotencyResponse, releaseIdempotencyKey, checkContentDedup, storeContentDedupResponse } from './idempotency.js';
import { writeAuditLog } from './audit.js';

/**
 * Verify the bearer token against Supabase Auth itself — never trust a locally
 * decoded payload. auth.getUser(token) round-trips to the Auth server and
 * confirms the signature and expiry; only its returned user is trustworthy.
 * Returns the verified user ({id, email, ...}) or throws a 401.
 */
async function verifyJWT(bearerToken) {
  if (!bearerToken || !bearerToken.startsWith('Bearer ')) {
    const err = new Error('Missing or invalid Authorization header');
    err.status = 401;
    err.code = 'missing_auth';
    throw err;
  }

  const token = bearerToken.slice(7);
  const { data, error } = await anonClient().auth.getUser(token);

  if (error || !data?.user) {
    const err = new Error('Invalid or expired session. Please sign in again.');
    err.status = 401;
    err.code = 'invalid_jwt';
    throw err;
  }

  return data.user;
}

/**
 * Read the caller's role + grants FROM THE DATABASE. Never from the request body
 * or a JWT claim — that is exactly the trust boundary that was missing. Cached
 * only for the lifetime of this one request (the closure below), never across
 * requests.
 */
async function getUserGrants(userId) {
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role_id')
    .eq('user_id', userId)
    .single();

  if (profileError || !profile) {
    const err = new Error('No profile is set up for this account yet.');
    err.status = 403;
    err.code = 'no_profile';
    throw err;
  }

  const { data: rows, error: grantError } = await serviceClient
    .from('role_permissions')
    .select('permissions(module, action)')
    .eq('role_id', profile.role_id);

  if (grantError) {
    const err = new Error('Could not load permissions.');
    err.status = 500;
    throw err;
  }

  return new Set((rows || []).map((r) => `${r.permissions.module}.${r.permissions.action}`));
}

/** GET keeps the endpoint's declared action (usually 'read', sometimes 'export'). */
function actionForMethod(method, declaredAction) {
  if (method === 'GET') return declaredAction;
  if (method === 'POST') return 'create';
  if (method === 'PATCH' || method === 'PUT') return 'update';
  if (method === 'DELETE') return 'delete';
  return declaredAction;
}

/**
 * Flat error envelope: { error: "human sentence", code: "SNAKE_CASE" }.
 * THE CLIENT reads payload.error as a string and payload.code at top level
 * (src/lib/api.js) — the server must match that, not the other way round.
 */
function errorResponse(status, message, code) {
  return new Response(JSON.stringify({ error: message, code: code || 'ERROR' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default function guard({ module, action, run }) {
  return async (req, context) => {
    try {
      const method = req.method;
      const url = new URL(req.url);
      const endpoint = url.pathname.match(/\/api\/(\S+)/)?.[1] || '';
      const isWrite = method !== 'GET';

      let body = undefined;
      if (isWrite) {
        const text = await req.text();
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            return errorResponse(400, 'Invalid JSON body', 'INVALID_JSON');
          }
        }
      }

      const idempotencyKey = req.headers.get('Idempotency-Key');
      const authHeader = req.headers.get('Authorization');

      // Step 1: Verify JWT
      if (!authHeader) {
        return errorResponse(401, 'Missing Authorization header', 'MISSING_AUTH');
      }
      let user, userId, token;
      try {
        user = await verifyJWT(authHeader);
        userId = user.id;
        token = authHeader.slice(7);
      } catch (err) {
        return errorResponse(err.status || 401, err.message, err.code || 'INVALID_JWT');
      }

      // Determine rate limit type
      const isExport = endpoint.includes('export');
      const rateLimitType = isExport ? 'export' : isWrite ? 'write' : 'read';

      // Step 2: Rate limit
      let remaining = 0;
      try {
        remaining = await checkRateLimit(userId, rateLimitType);
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message, code: 'RATE_LIMITED' }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(err.retryAfter || 60) } }
        );
      }

      // Step 3: Idempotency (for mutations only)
      let bodyHash = null;
      let idempotencyResult = null;
      if (isWrite) {
        if (!idempotencyKey) {
          return errorResponse(428, 'Mutating requests require an Idempotency-Key header', 'MISSING_IDEMPOTENCY_KEY');
        }
        bodyHash = await hashBody(body);
        idempotencyResult = await checkIdempotency(userId, endpoint, idempotencyKey, bodyHash);

        if (idempotencyResult.status === 'conflict') {
          return errorResponse(409, 'This request conflicts with an earlier one. Please refresh and try again.', 'IDEMPOTENCY_CONFLICT');
        }
        if (idempotencyResult.status === 'in_progress') {
          return new Response(
            JSON.stringify({ error: 'A concurrent request is still processing. Try again.', code: 'REQUEST_IN_PROGRESS' }),
            { status: 409, headers: { 'Content-Type': 'application/json', 'Retry-After': '1' } }
          );
        }
        if (idempotencyResult.status === 'replay') {
          return new Response(JSON.stringify(idempotencyResult.response), {
            status: idempotencyResult.httpStatus || 200,
            headers: { 'Content-Type': 'application/json', 'Idempotency-Replayed': 'true', 'X-RateLimit-Remaining': String(remaining) },
          });
        }
      }

      // Step 4: Content dedup (for mutations only)
      let contentDedupResult = null;
      if (isWrite && bodyHash) {
        contentDedupResult = await checkContentDedup(userId, endpoint, bodyHash);
        if (contentDedupResult.found) {
          return new Response(JSON.stringify(contentDedupResult.response), {
            status: contentDedupResult.httpStatus || 200,
            headers: { 'Content-Type': 'application/json', 'Idempotency-Replayed': 'true', 'X-RateLimit-Remaining': String(remaining) },
          });
        }
      }

      // Step 5: Permission + scope. Permission is checked here, against DB-sourced
      // grants only. Scope is the second wall, enforced by RLS through `supa` below
      // (constructed with the user's own JWT, never the service key).
      const requiredAction = actionForMethod(method, action);
      const grants = await getUserGrants(userId);
      if (!grants.has(`${module}.${requiredAction}`)) {
        if (isWrite && idempotencyKey) await releaseIdempotencyKey(idempotencyKey, userId);
        return errorResponse(403, `You do not have permission to ${requiredAction} ${module}.`, 'FORBIDDEN');
      }

      const supa = userClient(token);

      // Step 6: Execute + store + audit
      let response, httpStatus = 200;
      try {
        response = await run(supa, body, userId, method, url);
        if (method === 'POST') httpStatus = 201;
      } catch (err) {
        // Release idempotency key on handler error — a failed request must not be
        // replayable as a success.
        if (isWrite && idempotencyKey) {
          await releaseIdempotencyKey(idempotencyKey, userId);
        }
        throw err;
      }

      // Handlers that mutate (or, like /export, must still be logged) attach
      // `__audit` metadata to their response instead of calling writeAuditLog
      // themselves — this is the ONE place a mutation gets audited, so it can
      // never be skipped by an endpoint "forgetting" to call it.
      let audit = null;
      if (response && typeof response === 'object' && response.__audit) {
        audit = response.__audit;
        delete response.__audit;
      }
      if (audit) {
        // Deliberately not caught: if the mutation committed but the audit write
        // fails, that must surface as a loud 500, not a silent success with an
        // unrecorded row. The client sees an error; the data change already
        // happened and the failure is visible in the Function log.
        await writeAuditLog(userId, audit.action, audit.entity, audit.entityId, audit.before, audit.after);
      }

      // Store idempotency response
      if (isWrite && idempotencyKey) {
        await storeIdempotencyResponse(idempotencyKey, userId, response, httpStatus);
      }
      if (isWrite && bodyHash) {
        await storeContentDedupResponse(userId, endpoint, bodyHash, response, httpStatus);
      }

      return new Response(JSON.stringify(response), {
        status: httpStatus,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': String(remaining),
        },
      });

    } catch (err) {
      const status = err.status || 500;
      const message = status === 500 ? 'Something went wrong on our end.' : (err.message || 'Error');
      return errorResponse(status, message, err.code || 'ERROR');
    }
  };
}
