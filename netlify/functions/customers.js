import guard from './_lib/guard.js';
import { writeAuditLog } from './_lib/audit.js';

export default guard({
  module: 'customers',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      let query = supa.from('customers').select('*');
      const q = url.searchParams.get('q')?.toLowerCase();
      if (q) query = query.or(`customer_id.ilike.%${q}%,name.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return { rows: data || [] };
    }

    if (method === 'POST') {
      const { data, error } = await supa.from('customers').insert([body]).select().single();
      if (error) throw error;
      await writeAuditLog(userId, 'create', 'customers', data.customer_id, null, data);
      return { row: data };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa.from('customers').select('*').eq('customer_id', body.customer_id).single();
      if (e1) throw e1;
      const { data, error } = await supa.from('customers').update(body).eq('customer_id', body.customer_id).select().single();
      if (error) throw error;
      await writeAuditLog(userId, 'update', 'customers', body.customer_id, before, data);
      return { row: data };
    }

    if (method === 'DELETE') {
      const { data: before, error: e1 } = await supa.from('customers').select('*').eq('customer_id', body.customer_id).single();
      if (e1) throw e1;
      const { error } = await supa.from('customers').delete().eq('customer_id', body.customer_id);
      if (error) throw error;
      await writeAuditLog(userId, 'delete', 'customers', body.customer_id, before, null);
      return { deleted: body.customer_id };
    }
  }
});
