/**
 * GET/PUT /api/settings
 * Org and per-user settings. Shape must match src/lib/mock.js's '/settings' branch:
 * GET returns { org, user, canEditOrg }; PUT returns the persisted { org, user } —
 * not an echo of whatever the client happened to send.
 */
import guard from './_lib/guard.js';
import { serviceClient } from './_lib/supa.js';

async function readScope(supa, scope) {
  const { data, error } = await supa.from('settings').select('key, value').eq('scope', scope);
  if (error) throw error;
  const map = {};
  for (const s of data || []) map[s.key] = s.value;
  return map;
}

async function canEditOrg(userId) {
  // Mirrors mock.js: only an admin holding settings.update may edit org settings.
  // Read via the service client because this is a permission LOOKUP for rendering
  // a flag, the same kind of bookkeeping guard.js itself does — not a data read
  // that should be subject to RLS.
  const { data: profile } = await serviceClient.from('profiles').select('role_id').eq('user_id', userId).single();
  if (!profile) return false;
  const { data: role } = await serviceClient.from('roles').select('key').eq('id', profile.role_id).single();
  const { data: grants } = await serviceClient
    .from('role_permissions').select('permissions(module, action)').eq('role_id', profile.role_id);
  const hasUpdate = (grants || []).some((g) => g.permissions.module === 'settings' && g.permissions.action === 'update');
  return role?.key === 'admin' && hasUpdate;
}

export default guard({
  module: 'settings',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const [org, user] = await Promise.all([readScope(supa, 'org'), readScope(supa, userId)]);
      return { org, user, canEditOrg: await canEditOrg(userId) };
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
