/**
 * GET/PATCH /api/admin-users
 * List users and assign role, region/category scopes.
 *
 * Shape must match the /admin-users branch of src/lib/mock.js:
 *   { users: [{user_id, email, full_name, role, scope_regions, scope_categories, last_seen}],
 *     regions, categories }
 * The Users page builds its scope pickers from `regions`/`categories`, so a
 * response without them renders an editor with nothing to choose.
 */
import guard from './_lib/guard.js';
import { serviceClient } from './_lib/supa.js';

export default guard({
  module: 'users',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      // `profiles` has no email column — email lives in auth.users, which is
      // not exposed through PostgREST. Selecting it here returned 42703.
      const { data: profiles, error } = await supa
        .from('profiles')
        .select('user_id, full_name, role_id, scope_regions, scope_categories, roles(key, name)');
      if (error) throw error;

      // Emails and last-sign-in live in the auth schema, which only the service
      // role can read. Nothing beyond these two fields is copied out of it.
      const { data: authList } = await serviceClient.auth.admin.listUsers({ perPage: 200 });
      const byId = new Map((authList?.users || []).map((u) => [u.id, u]));

      const users = (profiles || []).map((p) => {
        const au = byId.get(p.user_id);
        return {
          user_id: p.user_id,
          email: au?.email || '',
          full_name: p.full_name,
          role: p.roles?.key || '',
          role_name: p.roles?.name || '',
          scope_regions: p.scope_regions || [],
          scope_categories: p.scope_categories || [],
          last_seen: au?.last_sign_in_at || null,
        };
      });

      // Scope options come from the data itself, so swapping the dataset needs
      // no code change.
      const { data: opts } = await supa.rpc('get_scope_options');
      const row = Array.isArray(opts) ? opts[0] : opts;

      return {
        users,
        regions: row?.regions || [],
        categories: row?.categories || [],
      };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa
        .from('profiles')
        .select('*')
        .eq('user_id', body.user_id)
        .single();
      if (e1) throw e1;

      // The client may send a role key ("manager"); never trust an id it made up.
      let roleId = before.role_id;
      if (body.role) {
        const { data: role, error: e2 } = await supa
          .from('roles').select('id').eq('key', body.role).single();
        if (e2) throw e2;
        roleId = role.id;
      } else if (body.role_id) {
        roleId = body.role_id;
      }

      const { data, error } = await supa
        .from('profiles')
        .update({
          role_id: roleId,
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
