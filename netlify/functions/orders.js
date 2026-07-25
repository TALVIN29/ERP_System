/**
 * GET/POST/PATCH/DELETE /api/orders
 * Scoped list + CRUD for orders. Response shapes here must match
 * src/lib/mock.js route()'s '/orders' branch exactly — that file is the contract.
 */
import guard from './_lib/guard.js';
import { scopeOptions } from './_lib/scope.js';

const FILTER_FIELDS = ['region', 'category', 'sub_category', 'segment', 'state'];

/**
 * The search term is interpolated into a PostgREST filter expression, where
 * `,` separates terms, `.` separates operands and `()` delimits the logic tree.
 * A raw term containing those does not just break the query — it lets the
 * caller append filters of their own choosing to it.
 *
 * RLS still stands behind this, so it was never a route to another tenant's
 * rows, but a filter the caller controls is not something to hand out. Keep
 * what a real order id or customer name contains and drop the rest.
 */
function sanitizeSearch(raw) {
  return (raw || '').trim().replace(/[^\w\s@.'-]/g, '').replace(/\./g, ' ').slice(0, 80).trim();
}

export default guard({
  module: 'orders',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const params = url.searchParams;
      const page = Math.max(1, Number(params.get('page') || 1));
      const pageSize = Math.max(1, Number(params.get('pageSize') || 25));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      // orders has no customer_name column — the name lives on customers. The
      // fixture backend denormalises it (mock.js line 82), so the Customer
      // column looked populated in development and was empty against the real
      // database, and searching it returned 500 (42703) for every query.
      let query = supa
        .from('orders')
        .select('*, customers(name)', { count: 'exact' });

      const q = sanitizeSearch(params.get('q'));
      if (q) {
        // A top-level `or` cannot reference an embedded table (PostgREST parses
        // `customers.name` inside or() as a malformed logic tree), so resolve
        // the names to ids first and match on those. One extra round trip, and
        // only when the user is actually searching.
        const { data: matches } = await supa
          .from('customers').select('customer_id').ilike('name', `%${q}%`).limit(500);
        const ids = (matches || []).map((c) => c.customer_id);
        query = query.or(
          ids.length
            ? `order_id.ilike.%${q}%,customer_id.in.(${ids.join(',')})`
            : `order_id.ilike.%${q}%`
        );
      }

      for (const field of FILTER_FIELDS) {
        const v = params.get(field);
        if (v) query = query.eq(field, v);
      }

      const dateFrom = params.get('from');
      const dateTo = params.get('to');
      if (dateFrom) query = query.gte('order_date', dateFrom);
      if (dateTo) query = query.lte('order_date', dateTo);

      const sort = params.get('sort');
      const sortField = sort ? (sort.startsWith('-') ? sort.slice(1) : sort) : 'order_date';
      const sortDesc = sort ? sort.startsWith('-') : true;
      query = query.order(sortField, { ascending: !sortDesc });

      // RLS applies the scope wall on top of these filters (region/category scope
      // is per-row, enforced identically to every other module).
      // The scope options do not depend on the page, so they go out at the same
      // time rather than after it.
      const [{ data, count, error }, scope] = await Promise.all([
        query.range(from, to),
        scopeOptions(supa, userId),
      ]);
      if (error) throw error;

      // Flatten the embed to the shape the table renders and mock.js returns.
      const rows = (data || []).map(({ customers, ...o }) => ({
        ...o,
        customer_name: customers?.name ?? '',
      }));

      return { rows, total: count || 0, page, pageSize, scope };
    }

    if (method === 'POST') {
      const { data, error } = await supa.from('orders').insert([body]).select().single();
      if (error) throw error;
      return { row: data, __audit: { action: 'create', entity: 'orders', entityId: data.order_id, before: null, after: data } };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa
        .from('orders').select('*').eq('order_id', body.order_id).single();
      if (e1) throw e1;

      const { data, error } = await supa
        .from('orders').update(body).eq('order_id', body.order_id).select().single();
      if (error) throw error;

      return { row: data, __audit: { action: 'update', entity: 'orders', entityId: body.order_id, before, after: data } };
    }

    if (method === 'DELETE') {
      const { data: before, error: e1 } = await supa
        .from('orders').select('*').eq('order_id', body.order_id).single();
      if (e1) throw e1;

      const { error } = await supa.from('orders').delete().eq('order_id', body.order_id);
      if (error) throw error;

      return { deleted: body.order_id, __audit: { action: 'delete', entity: 'orders', entityId: body.order_id, before, after: null } };
    }

    const err = new Error('Method not allowed');
    err.status = 405;
    throw err;
  }
});
