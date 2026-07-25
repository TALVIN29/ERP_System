/**
 * GET/POST/PATCH/DELETE /api/orders
 * Scoped list + CRUD for orders.
 */
import guard from './_lib/guard.js';
import { writeAuditLog } from './_lib/audit.js';

export default guard({
  module: 'orders',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const params = url.searchParams;
      const q = params.get('q')?.toLowerCase() || '';
      const sort = params.get('sort') || 'order_date';
      const desc = sort.startsWith('-');
      const field = desc ? sort.slice(1) : sort;

      let query = supa.from('orders').select('*');

      // Scoping is applied by RLS automatically
      if (q) {
        query = query.or(`order_id.ilike.%${q}%,customer_name.ilike.%${q}%`);
      }

      const { data, error } = await query.order(field, { ascending: !desc });
      if (error) throw error;

      return { rows: data || [], total: data?.length || 0, page: 1, pageSize: 50 };
    }

    if (method === 'POST') {
      const { data, error } = await supa.from('orders').insert([body]).select().single();
      if (error) throw error;
      await writeAuditLog(userId, 'create', 'orders', data.order_id, null, data);
      return { row: data };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa
        .from('orders').select('*').eq('order_id', body.order_id).single();
      if (e1) throw e1;

      const { data, error } = await supa
        .from('orders').update(body).eq('order_id', body.order_id).select().single();
      if (error) throw error;

      await writeAuditLog(userId, 'update', 'orders', body.order_id, before, data);
      return { row: data };
    }

    if (method === 'DELETE') {
      const { data: before, error: e1 } = await supa
        .from('orders').select('*').eq('order_id', body.order_id).single();
      if (e1) throw e1;

      const { error } = await supa.from('orders').delete().eq('order_id', body.order_id);
      if (error) throw error;

      await writeAuditLog(userId, 'delete', 'orders', body.order_id, before, null);
      return { deleted: body.order_id };
    }

    throw new Error('Method not allowed');
  }
});
