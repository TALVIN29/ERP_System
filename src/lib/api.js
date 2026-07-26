import { supabase, MOCK_MODE } from './supabase.js';
import { mockRequest } from './mock.js';

export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/**
 * Generated when a form *opens*, not when submit is clicked. A key generated at
 * submit time is a new key per click, and two clicks produce two records.
 * See docs/11-api-idempotency.md § 6.3.
 */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

async function authHeader() {
  if (MOCK_MODE) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * The single API entry point. Reads and writes both route through Netlify
 * Functions; the browser never talks to Postgres directly.
 */
export async function api(path, { method = 'GET', body, idempotencyKey, params, signal } = {}) {
  const qs = params ? '?' + buildQueryString(clean(params)) : '';

  if (MOCK_MODE) {
    if (method !== 'GET' && !idempotencyKey) {
      throw new ApiError(0, 'Every mutating request must carry an Idempotency-Key');
    }
    try {
      return await mockRequest(path + qs, {
        method,
        body: body === undefined ? undefined : { ...body, __key: idempotencyKey },
      });
    } catch (err) {
      throw new ApiError(err.status || 500, err.message);
    }
  }

  const headers = { ...(await authHeader()) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    if (!idempotencyKey) {
      throw new ApiError(0, 'Every mutating request must carry an Idempotency-Key');
    }
    headers['Idempotency-Key'] = idempotencyKey;
  }

  const res = await fetch(`/api${path}${qs}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  const payload = text ? safeParse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, payload?.error || res.statusText, {
      code: payload?.code,
      retryAfter: res.headers.get('Retry-After'),
      details: payload?.details,
    });
  }

  return {
    ...payload,
    _replayed: res.headers.get('Idempotency-Replayed') === 'true',
  };
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return { error: text }; }
}

// URLSearchParams(obj) coerces array values with String(), comma-joining them
// into one value instead of repeating the key — the server reads with
// getAll(), which then sees a single 'East,West' value, not ['East','West'].
function buildQueryString(params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      if (v.length) v.forEach((x) => qs.append(k, x));
    } else {
      qs.append(k, v);
    }
  }
  return qs.toString();
}

function clean(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}
