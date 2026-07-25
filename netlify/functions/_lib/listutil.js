/**
 * Filter/sort/paginate helpers shared by products.js and customers.js, mirroring
 * src/lib/mock.js's applyFilters/sortRows/paginate exactly — that file is the
 * response-shape contract both backends must honour.
 */

const FILTER_FIELDS = ['region', 'category', 'sub_category', 'segment', 'state'];

export function applyFilters(rows, params, searchFields) {
  const q = (params.get('q') || '').toLowerCase();
  let out = rows;
  if (q) out = out.filter((r) => searchFields.some((f) => String(r[f] || '').toLowerCase().includes(q)));
  for (const field of FILTER_FIELDS) {
    const v = params.get(field);
    if (v) out = out.filter((r) => r[field] === v);
  }
  const from = params.get('from');
  const to = params.get('to');
  if (from) out = out.filter((r) => !r.order_date || r.order_date >= from);
  if (to) out = out.filter((r) => !r.order_date || r.order_date <= to);
  return out;
}

export function sortRows(rows, params) {
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

export function paginate(rows, params) {
  const page = Number(params.get('page') || 1);
  const size = Number(params.get('pageSize') || 25);
  return { rows: rows.slice((page - 1) * size, page * size), total: rows.length, page, pageSize: size };
}
