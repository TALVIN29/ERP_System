/**
 * GET/PUT /api/admin-roles
 * Read and save the permission matrix. PUT takes the full desired state.
 * Lockout guard: someone must always be able to edit permissions.
 */
import guard from './_lib/guard.js';
import { writeAuditLog } from './_lib/audit.js';

export default guard({
  module: 'roles',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const { data: roles, error: e1 } = await supa.from('roles').select('id, key, name');
      if (e1) throw e1;

      const { data: perms, error: e2 } = await supa.from('permissions').select('id, module, action');
      if (e2) throw e2;

      const { data: grants, error: e3 } = await supa.from('role_permissions').select('role_id, permission_id');
      if (e3) throw e3;

      const rolesMap = {};
      for (const r of roles) rolesMap[r.id] = { key: r.key, name: r.name, permissions: [] };
      for (const g of grants) {
        rolesMap[g.role_id]?.permissions.push(g.permission_id);
      }

      return { roles, permissions: perms, grants: rolesMap };
    }

    if (method === 'PUT') {
      // Full-state replace: body.grants = { roleId: [permissionIds], ... }
      // Lockout guard: ensure at least one role can update roles
      const mustHaveUpdatePerm = Object.values(body.grants || {}).some(perms =>
        perms.includes('roles.update')
      );
      if (!mustHaveUpdatePerm) {
        const err = new Error('At least one role must keep permission to edit permissions.');
        err.status = 409;
        throw err;
      }

      // Fetch current state for audit
      const { data: currentGrants, error: e1 } = await supa.from('role_permissions').select('role_id, permission_id');
      if (e1) throw e1;

      const before = {};
      for (const g of currentGrants) {
        before[g.role_id] = before[g.role_id] || [];
        before[g.role_id].push(g.permission_id);
      }

      // Delete and re-insert all role_permissions
      await supa.from('role_permissions').delete().neq('role_id', -1); // Delete all

      const toInsert = [];
      for (const [roleId, permIds] of Object.entries(body.grants)) {
        for (const permId of permIds) {
          toInsert.push({ role_id: roleId, permission_id: permId });
        }
      }
      if (toInsert.length > 0) {
        const { error } = await supa.from('role_permissions').insert(toInsert);
        if (error) throw error;
      }

      // Audit: one row per role that changed
      for (const [roleId, after] of Object.entries(body.grants)) {
        const before_perms = before[roleId] || [];
        if (JSON.stringify(before_perms.sort()) !== JSON.stringify((after || []).sort())) {
          await writeAuditLog(userId, 'update', 'roles', roleId, { permissions: before_perms }, { permissions: after });
        }
      }

      return { success: true, grants: body.grants };
    }
  }
});
