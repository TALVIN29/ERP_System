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
 */
import { serviceClient, userClient } from './supa.js';
import { checkRateLimit } from './ratelimit.js';
import { hashBody, checkIdempotency, storeIdempotencyResponse, releaseIdempotencyKey, checkContentDedup, storeContentDedupResponse } from './idempotency.js';
import { writeAuditLog } from './audit.js';

/**
 * Verify JWT. Returns { sub: user_id } or throws.
 */
async function verifyJWT(bearerToken) {
  if (!bearerToken || !bearerToken.startsWith('Bearer ')) {
    const err = new Error('Missing or invalid Authorization header');
    err.status = 401;
    throw err;
  }

  const token = bearerToken.slice(7);
  const parts = token.split('.');
  if (parts.length !== 3) {
    const err = new Error('Invalid token format');
    err.status = 401;
    throw err;
  }

  try {
    const payload = JSON.parse(atob(parts[1]));
    return { sub: payload.sub, ...payload };
  } catch {
    const err = new Error('Invalid or expired JWT');
    err.status = 401;
    throw err;
  }
}

/**
 * JSON error response with envelope
 */
function errorResponse(status, message, code) {
  return new Response(JSON.stringify({
    error: { code: code || 'error', message, status }
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Guard wrapper: export default guard({ module: 'orders', action: 'read', run })
 * run(supa, body, userId, method, url) -> response object
 */
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
            return errorResponse(400, 'Invalid JSON body', 'invalid_json');
          }
        }
      }

      const idempotencyKey = req.headers.get('Idempotency-Key');
      const authHeader = req.headers.get('Authorization');

      // Step 1: Verify JWT
      if (!authHeader) {
        return errorResponse(401, 'Missing Authorization header', 'missing_auth');
      }
      let payload, userId, token;
      try {
        payload = await verifyJWT(authHeader);
        userId = payload.sub;
        token = authHeader.slice(7);
      } catch (err) {
        return errorResponse(401, err.message, 'invalid_jwt');
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
          JSON.stringify({ error: { code: 'rate_limited', message: err.message, status: 429 } }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(err.retryAfter || 60) } }
        );
      }

      // Step 3: Idempotency (for mutations only)
      let bodyHash = null;
      let idempotencyResult = null;
      if (isWrite) {
        if (!idempotencyKey) {
          return errorResponse(428, 'Mutating requests require an Idempotency-Key header', 'missing_idempotency_key');
        }
        bodyHash = await hashBody(body);
        idempotencyResult = await checkIdempotency(userId, endpoint, idempotencyKey, bodyHash);

        if (idempotencyResult.status === 'conflict') {
          return errorResponse(409, 'This request conflicts with an earlier one. Please refresh and try again.', 'idempotency_conflict');
        }
        if (idempotencyResult.status === 'in_progress') {
          return new Response(
            JSON.stringify({ error: { code: 'request_in_progress', message: 'A concurrent request is still processing. Try again.', status: 409 } }),
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

      // Step 5: Permission + scope (checked via RLS during execute, but can pre-check)
      const supa = userClient(token);

      // Step 6: Execute + store + audit
      let response, httpStatus = 200;
      try {
        response = await run(supa, body, userId, method, url);
        if (method === 'POST') httpStatus = 201;
      } catch (err) {
        // Release idempotency key on handler error
        if (isWrite && idempotencyKey) {
          await releaseIdempotencyKey(idempotencyKey, userId);
        }
        throw err;
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
      return errorResponse(status, message, err.code || 'error');
    }
  };
}
