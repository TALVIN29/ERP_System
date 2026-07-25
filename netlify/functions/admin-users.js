/**
 * GET/PATCH /api/admin-users
 * List users and assign role, region/category scopes
 */
import guard from './_lib/guard.js';

export default guard({
  module: 'users',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const { data: users, error } = await supa.from('profiles').select('user_id, email, full_name, role_id, scope_regions, scope_categories');
      if (error) throw error;
      return { users: users || [] };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa
        .from('profiles')
        .select('*')
        .eq('user_id', body.user_id)
        .single();
      if (e1) throw e1;

      const { data, error } = await supa
        .from('profiles')
        .update({
          role_id: body.role_id || before.role_id,
          scope_regions: body.scope_regions !== undefined ? body.scope_regions : before.scope_regions,
          scope_categories: body.scope_categories !== undefined ? body.scope_categories : before.scope_categories,
        })
        .eq('user_id', body.user_id)
        .select()
        .single();
      if (error) throw error;

      return { user: data, __audit: { action: 'update', entity: 'users', entityId: body.user_id, before, after: data } };
    }
  }
});
