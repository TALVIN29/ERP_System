import guard from './_lib/guard.js';
import { writeAuditLog } from './_lib/audit.js';

export default guard({
  module: 'products',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      let query = supa.from('products').select('*');
      const q = url.searchParams.get('q')?.toLowerCase();
      if (q) query = query.or(`product_id.ilike.%${q}%,name.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return { rows: data || [] };
    }

    if (method === 'POST') {
      const { data, error } = await supa.from('products').insert([body]).select().single();
      if (error) throw error;
      await writeAuditLog(userId, 'create', 'products', data.product_id, null, data);
      return { row: data };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa.from('products').select('*').eq('product_id', body.product_id).single();
      if (e1) throw e1;
      const { data, error } = await supa.from('products').update(body).eq('product_id', body.product_id).select().single();
      if (error) throw error;
      await writeAuditLog(userId, 'update', 'products', body.product_id, before, data);
      return { row: data };
    }

    if (method === 'DELETE') {
      const { data: before, error: e1 } = await supa.from('products').select('*').eq('product_id', body.product_id).single();
      if (e1) throw e1;
      const { error } = await supa.from('products').delete().eq('product_id', body.product_id);
      if (error) throw error;
      await writeAuditLog(userId, 'delete', 'products', body.product_id, before, null);
      return { deleted: body.product_id };
    }
  }
});
