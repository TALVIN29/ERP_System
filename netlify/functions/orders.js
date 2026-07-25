/**
 * GET/POST/PATCH/DELETE /api/orders
 * Scoped list + CRUD for orders. Response shapes here must match
 * src/lib/mock.js route()'s '/orders' branch exactly — that file is the contract.
 */
import guard from './_lib/guard.js';

const FILTER_FIELDS = ['region', 'category', 'sub_category', 'segment', 'state'];

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

      let query = supa.from('orders').select('*', { count: 'exact' });

      const q = (params.get('q') || '').trim();
      if (q) query = query.or(`order_id.ilike.%${q}%,customer_name.ilike.%${q}%`);

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
      const { data, count, error } = await query.range(from, to);
      if (error) throw error;

      return { rows: data || [], total: count || 0, page, pageSize };
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
