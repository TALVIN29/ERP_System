/**
 * Audit log writing. Called inside the guard after a successful mutation,
 * in the same transaction.
 */
import { serviceClient } from './supa.js';

/**
 * Write an audit log row for a mutation.
 * Called after a successful execute, in the same transaction.
 * @param {string} userId - actor's user.id
 * @param {string} action - 'create', 'update', 'delete', 'export'
 * @param {string} entity - module name: 'orders', 'products', etc.
 * @param {string} entityId - the affected row's PK or dataset name
 * @param {object} before - full row JSON before the change, null on create
 * @param {object} after - full row JSON after the change, null on delete
 */
export async function writeAuditLog(userId, action, entity, entityId, before, after) {
  await serviceClient.from('audit_log').insert({
    user_id: userId,
    action,
    entity,
    entity_id: String(entityId),
    before: before ? JSON.parse(JSON.stringify(before)) : null,
    after: after ? JSON.parse(JSON.stringify(after)) : null,
    at: new Date().toISOString(),
  });
}
