/**
 * Rebuild role_permissions from the canonical GRANTS definition.
 *
 * Needed because PUT /api/admin-roles deletes a role's grants and then inserts
 * the new set with no transaction: if the insert fails, the role is left with
 * nothing. Keep this until that endpoint is transactional.
 *
 * Usage: node scripts/restore_grants.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()])
);

const URL_BASE = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const MODULES = ['orders', 'products', 'customers', 'insights', 'users', 'roles', 'audit', 'settings'];
const ACTIONS = ['read', 'create', 'update', 'delete', 'export'];

// Mirrors GRANTS in src/lib/mock.js and 04_seed.sql — 37/12/7/4/8/5 = 73.
const GRANTS = {
  admin: MODULES.flatMap((m) => ACTIONS.map((a) => `${m}.${a}`))
    .filter((p) => !['audit.create', 'audit.update', 'audit.delete'].includes(p)),
  manager: ['orders.read', 'orders.create', 'orders.update', 'orders.delete', 'orders.export',
    'products.read', 'customers.read', 'customers.create', 'customers.update', 'customers.delete',
    'insights.read', 'settings.read'],
  analyst: ['orders.read', 'orders.export', 'products.read', 'customers.read',
    'insights.read', 'insights.export', 'settings.read'],
  viewer: ['orders.read', 'products.read', 'insights.read', 'settings.read'],
  finance: ['orders.read', 'orders.export', 'products.read', 'customers.read',
    'insights.read', 'insights.export', 'audit.read', 'settings.read'],
  warehouse: ['orders.read', 'orders.update', 'products.read', 'products.update', 'settings.read'],
};

const get = async (path) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
};

const roles = await get('roles?select=id,key');
const perms = await get('permissions?select=id,module,action');

const roleId = Object.fromEntries(roles.map((r) => [r.key, r.id]));
const permId = Object.fromEntries(perms.map((p) => [`${p.module}.${p.action}`, p.id]));

const rows = [];
for (const [key, list] of Object.entries(GRANTS)) {
  for (const p of list) {
    if (!roleId[key]) throw new Error(`unknown role ${key}`);
    if (!permId[p]) throw new Error(`unknown permission ${p}`);
    rows.push({ role_id: roleId[key], permission_id: permId[p] });
  }
}

const res = await fetch(`${URL_BASE}/rest/v1/role_permissions`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
  body: JSON.stringify(rows),
});
if (!res.ok) throw new Error(`insert failed: ${res.status} ${await res.text()}`);

const check = await fetch(`${URL_BASE}/rest/v1/roles?select=key,role_permissions(count)`, { headers: H });
console.log(`restored ${rows.length} grants`);
console.log(JSON.stringify(await check.json()));
