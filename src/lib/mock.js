/**
 * Local fixture backend. Active only while no Supabase project is wired up
 * (see supabase.js MOCK_MODE), so the whole UI is demoable before any
 * infrastructure exists. Every response shape here is the contract the Netlify
 * Functions must also honour — if one changes, both change.
 */
import { MODULES, ACTIONS } from './perms.js';

/* ---------------------------------------------------------------- seeded rng */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ taxonomy */

const REGIONS = ['East', 'West', 'Central', 'South'];
const SEGMENTS = ['Consumer', 'Corporate', 'Home Office'];
const SHIP_MODES = ['Standard Class', 'Second Class', 'First Class', 'Same Day'];
const SUBS = {
  Furniture: ['Bookcases', 'Chairs', 'Tables', 'Furnishings'],
  'Office Supplies': ['Binders', 'Paper', 'Storage', 'Art', 'Appliances', 'Labels'],
  Technology: ['Phones', 'Machines', 'Accessories', 'Copiers'],
};
const CATEGORIES = Object.keys(SUBS);
const FIRST = ['Claire', 'Darrin', 'Sean', 'Brosina', 'Andrew', 'Irene', 'Harold', 'Pete', 'Alejandro', 'Zuschuss', 'Ken', 'Sandra', 'Emily', 'Eric', 'Tracy', 'Matt'];
const LAST = ['Gute', 'Van Huff', "O'Donnell", 'Hoffman', 'Allen', 'Maddox', 'Pauli', 'Kriz', 'Grady', 'Donatelli', 'Black', 'Flores', 'Phan', 'Hoffmann', 'Blumstein', 'Abelman'];
const STATES = [['Kentucky', 'Henderson', 'South'], ['California', 'Los Angeles', 'West'], ['Florida', 'Fort Lauderdale', 'South'], ['New York', 'New York City', 'East'], ['Washington', 'Seattle', 'West'], ['Texas', 'Houston', 'Central'], ['Illinois', 'Chicago', 'Central'], ['Pennsylvania', 'Philadelphia', 'East'], ['Ohio', 'Columbus', 'East'], ['Michigan', 'Detroit', 'Central']];
const PRODUCT_WORDS = ['Bush Somerset', 'Hon Deluxe', 'Global Leather', 'Eldon Fold', 'Xerox 1967', 'Fellowes PB200', 'Newell 322', 'GBC Premium', 'Canon PC1080F', 'Konftel 250', 'Sauder Camden', 'Rogers Wire', 'Belkin Surge', 'Acme Kleencut'];

/* --------------------------------------------------------------- data build  */

const rand = rng(20240314);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const money = (n) => Math.round(n * 100) / 100;

const customers = Array.from({ length: 180 }, (_, i) => {
  const [state, city, region] = STATES[Math.floor(rand() * STATES.length)];
  return {
    customer_id: `CU-${String(1000 + i)}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    segment: pick(SEGMENTS),
    country: 'United States',
    city, state, region,
    postal_code: String(10000 + Math.floor(rand() * 80000)),
  };
});

const products = Array.from({ length: 220 }, (_, i) => {
  const category = pick(CATEGORIES);
  const sub_category = pick(SUBS[category]);
  return {
    product_id: `PR-${String(2000 + i)}`,
    category,
    sub_category,
    name: `${pick(PRODUCT_WORDS)} ${sub_category.replace(/s$/, '')}`,
    _price: money(15 + rand() * 900),
  };
});

const orders = [];
const orderItems = [];

for (let i = 0; i < 900; i++) {
  const customer = customers[Math.floor(rand() * customers.length)];
  const month = Math.floor(rand() * 24);
  const day = 1 + Math.floor(rand() * 28);
  const date = new Date(Date.UTC(2023 + Math.floor(month / 12), month % 12, day));
  const ship_mode = pick(SHIP_MODES);
  const baseLag = { 'Standard Class': 5, 'Second Class': 3, 'First Class': 2, 'Same Day': 0 }[ship_mode];
  // Standard Class carries a fat tail so the ship-lag insight has something real to find.
  const lag = baseLag + (ship_mode === 'Standard Class' && rand() > 0.75 ? 3 + Math.floor(rand() * 5) : Math.floor(rand() * 2));
  const ship = new Date(date.getTime() + lag * 86400000);

  const order = {
    order_id: `CA-${date.getUTCFullYear()}-${100000 + i}`,
    customer_id: customer.customer_id,
    customer_name: customer.name,
    order_date: date.toISOString().slice(0, 10),
    ship_date: ship.toISOString().slice(0, 10),
    ship_mode,
    region: customer.region,
    ship_lag_days: lag,
  };

  const lineCount = 1 + Math.floor(rand() * 3);
  let sales = 0;
  for (let l = 0; l < lineCount; l++) {
    const product = products[Math.floor(rand() * products.length)];
    const quantity = 1 + Math.floor(rand() * 8);
    // Discounts cluster at 0/.1/.2/.3/.4/.5 like the real Superstore ladder.
    const discount = [0, 0, 0, 0.1, 0.2, 0.2, 0.3, 0.4, 0.5][Math.floor(rand() * 9)];
    const lineSales = money(product._price * quantity * (1 - discount));
    // Margin ~26% at list, eroding ~1.9pt per discount point: profit crosses
    // zero just above 20%, which is the finding the whole app is built around.
    const marginRate = 0.26 - discount * 1.35;
    const profit = money(lineSales * marginRate);
    sales += lineSales;
    orderItems.push({
      id: `${order.order_id}-${l}`,
      order_id: order.order_id,
      product_id: product.product_id,
      product_name: product.name,
      sales: lineSales,
      quantity,
      discount,
      profit,
      region: order.region,
      category: product.category,
      sub_category: product.sub_category,
      order_date: order.order_date,
      ship_mode,
      ship_lag_days: lag,
    });
  }
  order.lines = lineCount;
  order.sales = money(sales);
  order.profit = money(orderItems.filter((x) => x.order_id === order.order_id).reduce((a, b) => a + b.profit, 0));
  orders.push(order);
}

/* ------------------------------------------------------------ roles & users  */

const ROLE_KEYS = ['admin', 'manager', 'analyst', 'viewer', 'finance', 'warehouse'];
const ROLE_NAMES = { admin: 'Admin', manager: 'Manager', analyst: 'Analyst', viewer: 'Viewer', finance: 'Finance', warehouse: 'Warehouse' };

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

export const DEMO_USERS = [
  { email: 'admin@superstore.demo', password: 'demo1234', full_name: 'Talvin Lee', role: 'admin', scope_regions: [], scope_categories: [] },
  { email: 'manager@superstore.demo', password: 'demo1234', full_name: 'Dana Chen', role: 'manager', scope_regions: ['East'], scope_categories: [] },
  { email: 'analyst@superstore.demo', password: 'demo1234', full_name: 'Priya Raman', role: 'analyst', scope_regions: [], scope_categories: [] },
  { email: 'viewer@superstore.demo', password: 'demo1234', full_name: 'Jon Reyes', role: 'viewer', scope_regions: ['West'], scope_categories: [] },
  { email: 'finance@superstore.demo', password: 'demo1234', full_name: 'Mei Tan', role: 'finance', scope_regions: [], scope_categories: [] },
  { email: 'warehouse@superstore.demo', password: 'demo1234', full_name: 'Sam Ortiz', role: 'warehouse', scope_regions: ['Central'], scope_categories: ['Furniture'] },
];

const state = {
  grants: JSON.parse(JSON.stringify(GRANTS)),
  users: DEMO_USERS.map((u, i) => ({
    user_id: `u-${i}`, email: u.email, full_name: u.full_name,
    role: u.role, scope_regions: [...u.scope_regions], scope_categories: [...u.scope_categories],
    last_seen: i === 0 ? new Date().toISOString() : new Date(Date.now() - i * 3600e3 * 7).toISOString(),
  })),
  orders: [...orders],
  products: [...products],
  customers: [...customers],
  audit: [],
  settings: {
    org: { org_name: 'Superstore Trading Co.', currency: 'USD', fiscal_year_start: '01-01', discount_alert: 0.2, min_loss: 1000 },
    user: { theme: 'system', default_page: 'dashboard', rows_per_page: 25 },
  },
  session: null,
  idempotency: new Map(),
};

export function permissionsFor(roleKey) {
  return state.grants[roleKey] || [];
}

/* ------------------------------------------------------------------ scoping  */

function inScope(row, session) {
  if (!session) return false;
  const { scope_regions: r, scope_categories: c } = session.profile;
  if (r.length && row.region && !r.includes(row.region)) return false;
  if (c.length && row.category && !c.includes(row.category)) return false;
  return true;
}

function scopedItems(session) {
  return orderItems.filter((it) => inScope(it, session));
}

function scopedOrders(session) {
  const { scope_regions: r, scope_categories: c } = session.profile;
  let list = state.orders;
  if (r.length) list = list.filter((o) => r.includes(o.region));
  if (c.length) {
    const ids = new Set(orderItems.filter((i) => c.includes(i.category)).map((i) => i.order_id));
    list = list.filter((o) => ids.has(o.order_id));
  }
  return list;
}

/* ---------------------------------------------------------------- auth (mock) */

export function mockSignIn(email, password) {
  const user = DEMO_USERS.find((u) => u.email === email.trim().toLowerCase());
  if (!user || user.password !== password) {
    const err = new Error('Email or password is incorrect');
    err.status = 400;
    throw err;
  }
  const record = state.users.find((u) => u.email === user.email);
  state.session = {
    user: { id: record.user_id, email: record.email },
    profile: {
      full_name: record.full_name,
      role_key: record.role,
      role_name: ROLE_NAMES[record.role],
      scope_regions: record.scope_regions,
      scope_categories: record.scope_categories,
    },
    permissions: permissionsFor(record.role),
  };
  try { localStorage.setItem('mock_session_email', record.email); } catch {}
  return state.session;
}

export function mockRestore() {
  try {
    const email = localStorage.getItem('mock_session_email');
    if (email) return mockSignIn(email, 'demo1234');
  } catch {}
  return null;
}

export function mockSignOut() {
  state.session = null;
  try { localStorage.removeItem('mock_session_email'); } catch {}
}

/* ------------------------------------------------------------------ insights */

export function computeInsights(items, settings = state.settings.org) {
  const out = [];
  const buckets = new Map();
  for (const it of items) {
    const b = Math.round(it.discount * 100);
    const acc = buckets.get(b) || { discount: b, profit: 0, sales: 0, lines: 0 };
    acc.profit += it.profit; acc.sales += it.sales; acc.lines++;
    buckets.set(b, acc);
  }
  const ladder = [...buckets.values()].sort((a, b) => a.discount - b.discount);
  const firstNegative = ladder.find((b) => b.profit < 0);
  if (firstNegative) {
    const above = items.filter((i) => i.discount >= firstNegative.discount / 100);
    const lost = above.reduce((a, b) => a + b.profit, 0);
    out.push({
      id: 'discount-break-even',
      severity: 'critical',
      title: `Discounts above ${firstNegative.discount}% destroy margin`,
      finding: `Every order line discounted above ${firstNegative.discount}% loses money on average. ${above.length.toLocaleString()} lines crossed it, costing ${fmt(Math.abs(lost))} in profit.`,
      metrics: [
        { label: 'Break-even discount', value: `${firstNegative.discount}%` },
        { label: 'Profit lost', value: `−${fmt(Math.abs(lost))}`, tone: 'down' },
        { label: 'Lines affected', value: above.length.toLocaleString() },
      ],
      action: `Cap discretionary discounts at ${firstNegative.discount}%; require approval above it.`,
      evidence: { type: 'discount-scatter', ladder, points: items.map((i) => ({ x: i.discount, y: i.profit })) },
    });
  }

  const bySub = groupBy(items, (i) => i.sub_category);
  for (const [sub, rows] of bySub) {
    const profit = sum(rows, 'profit');
    const sales = sum(rows, 'sales');
    if (profit < -Math.abs(settings.min_loss) && sales > 0) {
      out.push({
        id: `margin-leak-${sub}`,
        severity: 'critical',
        title: `${sub} loses ${fmt(Math.abs(profit))} on ${fmt(sales)} of sales`,
        finding: `${sub} sells well but returns a negative margin across ${rows.length.toLocaleString()} order lines.`,
        metrics: [
          { label: 'Sales', value: fmt(sales) },
          { label: 'Profit', value: `−${fmt(Math.abs(profit))}`, tone: 'down' },
        ],
        action: `Reprice ${sub} or withdraw its lowest-margin SKUs.`,
        evidence: { type: 'table', rows: topBy(rows, 'profit', 5, true) },
      });
    }
  }

  const byCustomer = groupBy(items, (i) => i.order_id.slice(0, 20));
  const revenues = [...byCustomer.values()].map((r) => sum(r, 'sales')).sort((a, b) => b - a);
  const total = revenues.reduce((a, b) => a + b, 0);
  const topCount = Math.max(1, Math.round(revenues.length * 0.05));
  const topShare = revenues.slice(0, topCount).reduce((a, b) => a + b, 0) / (total || 1);
  if (topShare > 0.15) {
    out.push({
      id: 'revenue-concentration',
      severity: 'serious',
      title: `Top 5% of customers generate ${Math.round(topShare * 100)}% of revenue`,
      finding: `Revenue leans on a small group. Losing any of them moves the whole number.`,
      metrics: [
        { label: 'Share of revenue', value: `${Math.round(topShare * 100)}%` },
        { label: 'Accounts', value: String(topCount) },
      ],
      action: 'Assign named ownership to the top 5% before the next quarter.',
      evidence: { type: 'table', rows: [] },
    });
  }

  const byMode = groupBy(items, (i) => i.ship_mode);
  for (const [mode, rows] of byMode) {
    const lags = rows.map((r) => r.ship_lag_days).sort((a, b) => a - b);
    const median = lags[Math.floor(lags.length / 2)] ?? 0;
    const tail = rows.filter((r) => r.ship_lag_days > median + 2);
    if (tail.length > rows.length * 0.1) {
      const avgTail = sum(tail, 'ship_lag_days') / tail.length;
      out.push({
        id: `ship-lag-${mode}`,
        severity: 'warning',
        title: `${mode} ships ${(avgTail - median).toFixed(1)} days later than its own median`,
        finding: `${tail.length.toLocaleString()} of ${rows.length.toLocaleString()} ${mode} lines fall in the slow tail.`,
        metrics: [
          { label: 'Median lag', value: `${median} d` },
          { label: 'Tail average', value: `${avgTail.toFixed(1)} d` },
        ],
        action: `Audit the ${mode} tail — the median is fine, the tail is not.`,
        evidence: { type: 'table', rows: [] },
      });
    }
  }

  const byProduct = groupBy(items, (i) => i.product_name);
  const losers = [...byProduct.entries()]
    .map(([name, rows]) => ({ name, profit: sum(rows, 'profit'), sales: sum(rows, 'sales'), lines: rows.length }))
    .filter((p) => p.profit < 0)
    .sort((a, b) => a.profit - b.profit)
    .slice(0, 10);
  if (losers.length) {
    out.push({
      id: 'loss-making-skus',
      severity: 'serious',
      title: `${losers.length} products sell at a loss`,
      finding: `The worst, ${losers[0].name}, loses ${fmt(Math.abs(losers[0].profit))} across ${losers[0].lines} lines.`,
      metrics: [
        { label: 'Loss-making SKUs', value: String(losers.length) },
        { label: 'Combined loss', value: `−${fmt(Math.abs(sum(losers, 'profit')))}`, tone: 'down' },
      ],
      action: 'Delist or reprice the ten worst SKUs.',
      evidence: { type: 'table', rows: losers },
    });
  }

  const order = { critical: 0, serious: 1, warning: 2, good: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

const fmt = (n) => '$' + Math.round(n).toLocaleString();
const sum = (rows, key) => rows.reduce((a, b) => a + (b[key] || 0), 0);
function groupBy(rows, fn) {
  const m = new Map();
  for (const r of rows) {
    const k = fn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}
function topBy(rows, key, n, asc) {
  return [...rows].sort((a, b) => (asc ? a[key] - b[key] : b[key] - a[key])).slice(0, n);
}

/* ------------------------------------------------------------------ router   */

function requirePerm(module, action) {
  const s = state.session;
  if (!s) throw httpError(401, 'Not signed in');
  if (!permissionsFor(s.profile.role_key).includes(`${module}.${action}`)) {
    throw httpError(403, `You do not have permission to ${action} ${module}`);
  }
  return s;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function audit(action, entity, entity_id, before, after) {
  state.audit.unshift({
    id: `a-${state.audit.length + 1}`,
    at: new Date().toISOString(),
    user_id: state.session?.user.id,
    actor: state.session?.profile.full_name || 'System',
    action, entity, entity_id, before, after,
  });
}

function paginate(rows, params, extra) {
  const page = Number(params.get('page') || 1);
  const size = Number(params.get('pageSize') || 25);
  return { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size, ...extra };
}

/**
 * The values a page may filter by and offer in a form. A scoped user gets only
 * their own; an unscoped one gets everything. List pages read this rather than
 * hardcoding a taxonomy, so swapping the dataset needs no code change.
 */
function selectableScope(session) {
  const { scope_regions: r, scope_categories: c } = session.profile;
  return {
    regions: r.length ? r : REGIONS,
    categories: c.length ? c : CATEGORIES,
    subCategories: CATEGORIES.flatMap((k) => SUBS[k]),
    segments: SEGMENTS,
    shipModes: SHIP_MODES,
  };
}

/** Mirrors the Netlify guard chain closely enough that page code cannot tell
 *  which backend it is talking to. */
export async function mockRequest(fullPath, { method = 'GET', body } = {}) {
  await delay(120);
  const [path, query] = fullPath.split('?');
  const params = new URLSearchParams(query || '');

  // Idempotency replay, keyed the same way the real API keys it.
  if (method !== 'GET') {
    const key = body?.__key;
    if (key && state.idempotency.has(key)) {
      return { ...state.idempotency.get(key), _replayed: true };
    }
  }

  const result = await route(path, params, method, body);

  if (method !== 'GET' && body?.__key) state.idempotency.set(body.__key, result);
  return result;
}

async function route(path, params, method, body) {
  const s = state.session;

  if (path === '/metrics') {
    requirePerm('insights', 'read');
    const allItems = scopedItems(s);
    // The dashboard puts the range in the URL so a filtered view is linkable;
    // it only means anything if the range actually narrows the numbers.
    const items = inRange(allItems, params);
    // Presets ("last 30/90 days") must anchor to the data's own latest order
    // date, not wall-clock time — this dataset doesn't reach the present day.
    const maxDate = allItems.reduce((max, i) => (i.order_date > max ? i.order_date : max), '');
    return { metrics: buildMetrics(items, allItems, maxDate), maxDate };
  }

  if (path === '/insights') {
    requirePerm('insights', 'read');
    return { insights: computeInsights(inRange(scopedItems(s), params), state.settings.org) };
  }

  if (path === '/export') {
    requirePerm('insights', 'export');
    return { dataset: params.get('dataset') || 'orders', rows: scopedItems(s).slice(0, 500) };
  }

  if (path === '/orders') {
    if (method === 'GET') {
      requirePerm('orders', 'read');
      let rows = scopedOrders(s);
      rows = applyFilters(rows, params, ['order_id', 'customer_name']);
      return paginate(sortRows(rows, params), params, { scope: selectableScope(s) });
    }
    if (method === 'POST') {
      requirePerm('orders', 'create');
      // Totals are derived from the line items, never taken on trust from the
      // client — the same rule the real API has to follow.
      const items = Array.isArray(body.items) ? body.items : [];
      const row = {
        ...body,
        order_id: body.order_id || `CA-${new Date().getFullYear()}-${900000 + state.orders.length}`,
        lines: items.length || body.lines || 1,
        sales: items.length
          ? money(items.reduce((a, i) => a + Number(i.sales || 0), 0))
          : Number(body.sales) || 0,
      };
      delete row.__key;
      state.orders.unshift(row);
      audit('CREATE', 'orders', row.order_id, null, row);
      return { row };
    }
    if (method === 'PATCH') {
      requirePerm('orders', 'update');
      const i = state.orders.findIndex((o) => o.order_id === body.order_id);
      if (i < 0) throw httpError(404, 'Order not found');
      const before = { ...state.orders[i] };
      state.orders[i] = { ...before, ...body };
      delete state.orders[i].__key;
      audit('UPDATE', 'orders', body.order_id, before, state.orders[i]);
      return { row: state.orders[i] };
    }
    if (method === 'DELETE') {
      requirePerm('orders', 'delete');
      const i = state.orders.findIndex((o) => o.order_id === body.order_id);
      if (i < 0) throw httpError(404, 'Order not found');
      const [gone] = state.orders.splice(i, 1);
      audit('DELETE', 'orders', gone.order_id, gone, null);
      return { deleted: gone.order_id };
    }
  }

  if (path === '/products') {
    if (method === 'GET') {
      requirePerm('products', 'read');
      const cats = s.profile.scope_categories;
      let rows = state.products.map((p) => {
        const lines = orderItems.filter((i) => i.product_id === p.product_id);
        return { ...p, order_lines: lines.length, total_sales: money(sum(lines, 'sales')) };
      });
      if (cats.length) rows = rows.filter((p) => cats.includes(p.category));
      rows = applyFilters(rows, params, ['product_id', 'name']);
      return paginate(sortRows(rows, params), params, { scope: selectableScope(s) });
    }
    return mutateCollection('products', 'product_id', method, body);
  }

  if (path === '/customers') {
    if (method === 'GET') {
      requirePerm('customers', 'read');
      const regions = s.profile.scope_regions;
      let rows = state.customers.map((c) => {
        const os = state.orders.filter((o) => o.customer_id === c.customer_id);
        return { ...c, orders: os.length, total_sales: money(sum(os, 'sales')) };
      });
      if (regions.length) rows = rows.filter((c) => regions.includes(c.region));
      rows = applyFilters(rows, params, ['customer_id', 'name']);
      return paginate(sortRows(rows, params), params, { scope: selectableScope(s) });
    }
    return mutateCollection('customers', 'customer_id', method, body);
  }

  if (path === '/admin-roles') {
    if (method === 'GET') {
      requirePerm('roles', 'read');
      return { roles: ROLE_KEYS.map((k) => ({ key: k, name: ROLE_NAMES[k] })), grants: state.grants };
    }
    if (method === 'PUT') {
      requirePerm('roles', 'update');
      const next = body.grants;
      // Lockout guard: someone must always be able to edit permissions.
      const stillAdmin = Object.values(next).some((g) => g.includes('roles.update'));
      if (!stillAdmin) throw httpError(409, 'At least one role must keep permission to edit permissions');
      const before = JSON.parse(JSON.stringify(state.grants));
      state.grants = next;
      audit('UPDATE', 'roles', 'matrix', before, next);
      if (s) s.permissions = permissionsFor(s.profile.role_key);
      return { grants: state.grants };
    }
  }

  if (path === '/admin-users') {
    if (method === 'GET') {
      requirePerm('users', 'read');
      return {
        users: state.users,
        regions: REGIONS,
        categories: CATEGORIES,
      };
    }
    if (method === 'PATCH') {
      requirePerm('users', 'update');
      const i = state.users.findIndex((u) => u.user_id === body.user_id);
      if (i < 0) throw httpError(404, 'User not found');
      const before = { ...state.users[i] };
      state.users[i] = { ...before, ...body };
      delete state.users[i].__key;
      audit('UPDATE', 'users', body.user_id, before, state.users[i]);
      return { user: state.users[i] };
    }
  }

  if (path === '/scope-preview') {
    requirePerm('users', 'read');
    const regions = params.getAll('region');
    const categories = params.getAll('category');
    const matched = orderItems.filter((it) =>
      (!regions.length || regions.includes(it.region)) &&
      (!categories.length || categories.includes(it.category))
    );
    return { matched: matched.length, total: orderItems.length };
  }

  if (path === '/audit-log') {
    requirePerm('audit', 'read');
    let rows = state.audit;
    const action = params.get('action');
    const entity = params.get('entity');
    if (action) rows = rows.filter((r) => r.action === action);
    if (entity) rows = rows.filter((r) => r.entity === entity);
    return paginate(rows, params);
  }

  if (path === '/settings') {
    if (method === 'GET') {
      requirePerm('settings', 'read');
      // Matches netlify/functions/settings.js: the permission decides, not the
      // role name. The extra role_key === 'admin' that used to be here
      // contradicted the real PUT gate, which checks settings.update alone.
      return { org: state.settings.org, user: state.settings.user, canEditOrg: permissionsFor(s.profile.role_key).includes('settings.update') };
    }
    if (method === 'PUT') {
      requirePerm('settings', 'update');
      const before = JSON.parse(JSON.stringify(state.settings));
      if (body.org) state.settings.org = { ...state.settings.org, ...body.org };
      if (body.user) state.settings.user = { ...state.settings.user, ...body.user };
      audit('UPDATE', 'settings', body.org ? 'org' : 'user', before, state.settings);
      return { org: state.settings.org, user: state.settings.user };
    }
  }

  if (path === '/threshold-preview') {
    requirePerm('settings', 'read');
    const at = Number(params.get('discount_alert') || 0.2);
    return { flagged: orderItems.filter((i) => i.discount >= at).length };
  }

  throw httpError(404, `No such endpoint: ${path}`);
}

function mutateCollection(name, idKey, method, body) {
  const module = name;
  if (method === 'POST') {
    requirePerm(module, 'create');
    const row = { ...body };
    delete row.__key;
    state[name].unshift(row);
    audit('CREATE', name, row[idKey], null, row);
    return { row };
  }
  if (method === 'PATCH') {
    requirePerm(module, 'update');
    const i = state[name].findIndex((r) => r[idKey] === body[idKey]);
    if (i < 0) throw httpError(404, 'Not found');
    const before = { ...state[name][i] };
    state[name][i] = { ...before, ...body };
    delete state[name][i].__key;
    audit('UPDATE', name, body[idKey], before, state[name][i]);
    return { row: state[name][i] };
  }
  if (method === 'DELETE') {
    requirePerm(module, 'delete');
    const i = state[name].findIndex((r) => r[idKey] === body[idKey]);
    if (i < 0) throw httpError(404, 'Not found');
    if (name === 'products') {
      const used = orderItems.filter((it) => it.product_id === body[idKey]);
      if (used.length) {
        throw httpError(409, `This product appears on ${used.length} order lines totalling ${fmt(sum(used, 'sales'))}.`);
      }
      // The client uses a dry run to preview whether a delete would be
      // blocked, before the user has confirmed anything — must not delete.
      if (body.dryRun) return { dryRun: true };
    }
    const [gone] = state[name].splice(i, 1);
    audit('DELETE', name, gone[idKey], gone, null);
    return { deleted: gone[idKey] };
  }
  throw httpError(405, 'Method not allowed');
}

function applyFilters(rows, params, searchFields) {
  const q = (params.get('q') || '').toLowerCase();
  let out = rows;
  if (q) out = out.filter((r) => searchFields.some((f) => String(r[f] || '').toLowerCase().includes(q)));
  for (const field of ['region', 'category', 'sub_category', 'segment', 'state']) {
    const v = params.get(field);
    if (v) out = out.filter((r) => r[field] === v);
  }
  const from = params.get('from');
  const to = params.get('to');
  if (from) out = out.filter((r) => !r.order_date || r.order_date >= from);
  if (to) out = out.filter((r) => !r.order_date || r.order_date <= to);
  return out;
}

/** Accepts either `from`/`to` or `date_from`/`date_to`; the dashboard has used both. */
function inRange(items, params) {
  const from = params.get('from') || params.get('date_from');
  const to = params.get('to') || params.get('date_to');
  if (!from && !to) return items;
  return items.filter((i) => (!from || i.order_date >= from) && (!to || i.order_date <= to));
}

function sortRows(rows, params) {
  const sort = params.get('sort');
  if (!sort) return rows;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return desc ? -c : c;
  });
}

// Delta is "vs the preceding period", a fixed 90-day window off the data's own
// latest date — independent of whatever range the user has filtered to.
// Mirrors get_dashboard_kpis()'s cur/prev windows in supabase/05_metrics.sql.
function kpiDelta(allItems, maxDate, key) {
  if (!maxDate) return 0;
  const curStart = new Date(new Date(maxDate).getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const prevStart = new Date(new Date(maxDate).getTime() - 180 * 86400000).toISOString().slice(0, 10);
  const cur = allItems.filter((i) => i.order_date > curStart && i.order_date <= maxDate);
  const prev = allItems.filter((i) => i.order_date > prevStart && i.order_date <= curStart);

  const curVal = (rows) => {
    if (key === 'sales') return sum(rows, 'sales');
    if (key === 'profit') return sum(rows, 'profit');
    const orderIds = new Set(rows.map((i) => i.order_id));
    if (key === 'orders') return orderIds.size;
    if (key === 'aov') return orderIds.size ? sum(rows, 'sales') / orderIds.size : 0;
  };

  const c = curVal(cur);
  const p = curVal(prev);
  if (!p) return 0;
  return Math.round(((c - p) / Math.abs(p)) * 10000) / 10000;
}

function buildMetrics(items, allItems = items, maxDate = '') {
  const sales = sum(items, 'sales');
  const profit = sum(items, 'profit');
  const orderIds = new Set(items.map((i) => i.order_id));
  const byMonth = groupBy(items, (i) => i.order_date.slice(0, 7));
  const trend = [...byMonth.entries()].sort().map(([month, rows]) => ({ month, sales: money(sum(rows, 'sales')) }));
  const byCategory = groupBy(items, (i) => i.category);
  const byRegion = groupBy(items, (i) => i.region);

  return {
    kpis: [
      { key: 'sales', label: 'Sales', value: sales, format: 'currency', delta: kpiDelta(allItems, maxDate, 'sales') },
      { key: 'profit', label: 'Profit', value: profit, format: 'currency', delta: kpiDelta(allItems, maxDate, 'profit') },
      { key: 'orders', label: 'Orders', value: orderIds.size, format: 'number', delta: kpiDelta(allItems, maxDate, 'orders') },
      { key: 'aov', label: 'Avg order', value: orderIds.size ? sales / orderIds.size : 0, format: 'currency', delta: kpiDelta(allItems, maxDate, 'aov') },
    ],
    trend,
    categoryProfit: [...byCategory.entries()].map(([category, rows]) => ({ category, profit: money(sum(rows, 'profit')) })),
    regionSales: [...byRegion.entries()].map(([region, rows]) => ({ region, sales: money(sum(rows, 'sales')) })),
  };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export const MOCK_META = { regions: REGIONS, categories: CATEGORIES, subCategories: SUBS, segments: SEGMENTS, shipModes: SHIP_MODES, roleNames: ROLE_NAMES, roleKeys: ROLE_KEYS };
