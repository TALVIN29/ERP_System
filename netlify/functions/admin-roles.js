/**
 * GET/PUT /api/admin-roles
 * Read and save the permission matrix. PUT takes the full desired state.
 *
 * Response/request shape must match src/lib/mock.js's '/admin-roles' branch:
 * string-keyed and string-valued — { roles: [{key,name}], grants: { roleKey:
 * ["module.action", ...] } } — not the numeric role_id/permission_id shape the
 * DB uses internally. The DB has ids; the wire contract has strings. This file
 * is the translation layer between the two.
 */
import guard from './_lib/guard.js';

export default guard({
  module: 'roles',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const { data: roles, error: e1 } = await supa.from('roles').select('id, key, name');
      if (e1) throw e1;

      const { data: perms, error: e2 } = await supa.from('permissions').select('id, module, action');
      if (e2) throw e2;

      const { data: rolePerms, error: e3 } = await supa.from('role_permissions').select('role_id, permission_id');
      if (e3) throw e3;

      const permKeyById = new Map(perms.map((p) => [p.id, `${p.module}.${p.action}`]));
      const keyById = new Map(roles.map((r) => [r.id, r.key]));

      const grants = {};
      for (const r of roles) grants[r.key] = [];
      for (const g of rolePerms) {
        const roleKey = keyById.get(g.role_id);
        const permKey = permKeyById.get(g.permission_id);
        if (roleKey && permKey) grants[roleKey].push(permKey);
      }

      return {
        roles: roles.map((r) => ({ key: r.key, name: r.name })),
        grants,
      };
    }

    if (method === 'PUT') {
      const nextGrants = body.grants || {};

      // Lockout guard: fixed to check the incoming STRING grants (was comparing
      // "roles.update" against arrays of numeric permission ids, so it could
      // never match and could never fire).
      const stillHasRolesUpdate = Object.values(nextGrants).some((perms) => (perms || []).includes('roles.update'));
      if (!stillHasRolesUpdate) {
        const err = new Error('At least one role must keep permission to edit permissions.');
        err.status = 409;
        throw err;
      }

      const { data: roles, error: e1 } = await supa.from('roles').select('id, key, name');
      if (e1) throw e1;
      const { data: perms, error: e2 } = await supa.from('permissions').select('id, module, action');
      if (e2) throw e2;

      const roleIdByKey = new Map(roles.map((r) => [r.key, r.id]));
      const permIdByKey = new Map(perms.map((p) => [`${p.module}.${p.action}`, p.id]));

      for (const roleKey of Object.keys(nextGrants)) {
        if (!roleIdByKey.has(roleKey)) {
          const err = new Error(`Unknown role: ${roleKey}`);
          err.status = 400;
          throw err;
        }
        for (const permKey of nextGrants[roleKey] || []) {
          if (!permIdByKey.has(permKey)) {
            const err = new Error(`Unknown permission: ${permKey}`);
            err.status = 400;
            throw err;
          }
        }
      }

      // Snapshot current state, string-keyed, for the audit row.
      const { data: currentRolePerms, error: e3 } = await supa.from('role_permissions').select('role_id, permission_id');
      if (e3) throw e3;
      const permKeyById = new Map(perms.map((p) => [p.id, `${p.module}.${p.action}`]));
      const keyById = new Map(roles.map((r) => [r.id, r.key]));
      const before = {};
      for (const r of roles) before[r.key] = [];
      for (const g of currentRolePerms) {
        const roleKey = keyById.get(g.role_id);
        const permKey = permKeyById.get(g.permission_id);
        if (roleKey && permKey) before[roleKey].push(permKey);
      }

      // Full-state replace.
      const { error: delError } = await supa.from('role_permissions').delete().neq('role_id', -1);
      if (delError) throw delError;

      const toInsert = [];
      for (const [roleKey, permKeys] of Object.entries(nextGrants)) {
        const roleId = roleIdByKey.get(roleKey);
        for (const permKey of permKeys || []) {
          toInsert.push({ role_id: roleId, permission_id: permIdByKey.get(permKey) });
        }
      }
      if (toInsert.length) {
        const { error: insError } = await supa.from('role_permissions').insert(toInsert);
        if (insError) throw insError;
      }

      return {
        roles: roles.map((r) => ({ key: r.key, name: r.name })),
        grants: nextGrants,
        __audit: { action: 'update', entity: 'roles', entityId: 'matrix', before, after: nextGrants },
      };
    }

    const err = new Error('Method not allowed');
    err.status = 405;
    throw err;
  }
});
