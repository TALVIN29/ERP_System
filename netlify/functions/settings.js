/**
 * GET/PUT /api/settings
 * Org and per-user settings. Shape must match src/lib/mock.js's '/settings' branch:
 * GET returns { org, user, canEditOrg }; PUT returns the persisted { org, user } —
 * not an echo of whatever the client happened to send.
 */
import guard from './_lib/guard.js';

async function readScope(supa, scope) {
  const { data, error } = await supa.from('settings').select('key, value').eq('scope', scope);
  if (error) throw error;
  const map = {};
  for (const s of data || []) map[s.key] = s.value;
  return map;
}

export default guard({
  module: 'settings',
  action: 'read',
  run: async (supa, body, userId, method, url, grants) => {
    if (method === 'GET') {
      const [org, user] = await Promise.all([readScope(supa, 'org'), readScope(supa, userId)]);
      // canEditOrg is a UI flag, and it now answers with the grants the guard
      // already loaded rather than re-deriving them.
      //
      // It used to walk profiles -> roles -> role_permissions in three
      // SEQUENTIAL round trips, which measured as the whole 876ms this handler
      // was spending.
      //
      // It also required role.key === 'admin' on top of the permission, and
      // that was wrong in a way the delay was hiding: PUT is gated by the guard
      // on settings.update alone, so a non-admin role granted settings.update
      // could already write org settings while this flag told the UI it could
      // not. The permission matrix is what decides — that is the entire point
      // of making it editable — so the flag now matches what the API enforces.
      return { org, user, canEditOrg: grants.has('settings.update') };
    }

    if (method === 'PUT') {
      const before = { org: await readScope(supa, 'org'), user: await readScope(supa, userId) };

      if (body.org) {
        for (const [key, value] of Object.entries(body.org)) {
          const { error } = await supa.from('settings').upsert({ scope: 'org', key, value });
          if (error) throw error;
        }
      }
      if (body.user) {
        for (const [key, value] of Object.entries(body.user)) {
          const { error } = await supa.from('settings').upsert({ scope: userId, key, value });
          if (error) throw error;
        }
      }

      // Re-read after write and always return both — never echo the client's own
      // body back, and never drop whichever of org/user it didn't send.
      const [org, user] = await Promise.all([readScope(supa, 'org'), readScope(supa, userId)]);
      const entity = body.org ? 'org' : 'user';
      return { org, user, __audit: { action: 'update', entity: 'settings', entityId: entity, before, after: { org, user } } };
    }

    const err = new Error('Method not allowed');
    err.status = 405;
    throw err;
  }
});
