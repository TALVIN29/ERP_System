export const MODULES = [
  'orders', 'products', 'customers', 'insights',
  'users', 'roles', 'audit', 'settings',
];

export const ACTIONS = ['read', 'create', 'update', 'delete', 'export'];

export const ACTION_LABEL = {
  read: 'R', create: 'C', update: 'U', delete: 'D', export: 'E',
};

/** Audit rows are written by the system; these cells render locked. */
export const LOCKED_CELLS = [
  ['audit', 'create'], ['audit', 'update'], ['audit', 'delete'],
];

export function isLocked(module, action) {
  return LOCKED_CELLS.some(([m, a]) => m === module && a === action);
}

/**
 * Wraps a flat permission list (["orders.read", ...]) in a lookup.
 * `perms.can(module, action)` is the only shape the UI should use.
 */
export function makePerms(list = []) {
  const set = new Set(list);
  return {
    list,
    can: (module, action = 'read') => set.has(`${module}.${action}`),
    canAny: (module) => ACTIONS.some((a) => set.has(`${module}.${a}`)),
  };
}

/**
 * Empty scope array means "all" — so Admin and Analyst need no special-casing.
 * Stated once here because it inverts the intuitive reading.
 */
export function scopeLabel(values, allLabel) {
  if (!values || values.length === 0) return allLabel;
  return values.join(', ');
}
