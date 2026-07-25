/**
 * GET/PUT /api/settings
 * Org and per-user settings.
 */
import guard from './_lib/guard.js';
import { writeAuditLog } from './_lib/audit.js';

export default guard({
  module: 'settings',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const { data: org, error: e1 } = await supa
        .from('settings')
        .select('key, value')
        .eq('scope', 'org');
      if (e1) throw e1;

      const { data: user, error: e2 } = await supa
        .from('settings')
        .select('key, value')
        .eq('scope', userId);
      if (e2) throw e2;

      const orgMap = {};
      for (const s of org) orgMap[s.key] = s.value;

      const userMap = {};
      for (const s of user) userMap[s.key] = s.value;

      return { org: orgMap, user: userMap };
    }

    if (method === 'PUT') {
      const before = { org: {}, user: {} };

      if (body.org) {
        const { data: current } = await supa.from('settings').select('key, value').eq('scope', 'org');
        for (const s of current) before.org[s.key] = s.value;

        for (const [key, value] of Object.entries(body.org)) {
          const { error } = await supa
            .from('settings')
            .upsert({ scope: 'org', key, value })
            .eq('scope', 'org')
            .eq('key', key);
          if (error) throw error;
        }
      }

      if (body.user) {
        const { data: current } = await supa.from('settings').select('key, value').eq('scope', userId);
        for (const s of current) before.user[s.key] = s.value;

        for (const [key, value] of Object.entries(body.user)) {
          const { error } = await supa
            .from('settings')
            .upsert({ scope: userId, key, value })
            .eq('scope', userId)
            .eq('key', key);
          if (error) throw error;
        }
      }

      const after = body;
      const entity = body.org ? 'org' : 'user';
      await writeAuditLog(userId, 'update', 'settings', entity, before, after);

      return body;
    }
  }
});
