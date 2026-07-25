/**
 * GET/POST/PATCH/DELETE /api/customers
 * Response shape must match src/lib/mock.js route()'s '/customers' branch:
 * {rows, total, page, pageSize} with orders/total_sales computed per row.
 */
import guard from './_lib/guard.js';
import { scopeOptions } from './_lib/scope.js';
import { applyFilters, sortRows, paginate } from './_lib/listutil.js';

const money = (n) => Math.round(n * 100) / 100;

export default guard({
  module: 'customers',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const params = url.searchParams;

      const [{ data: customers, error: e1 }, { data: orders, error: e2 }, scope] = await Promise.all([
        supa.from('customers').select('*'),
        // order_items denormalizes sales at line level; use orders for a per-order sales
        // figure by summing its lines, since orders has no `sales` column of its own.
        supa.from('order_items').select('order_id, sales, orders!inner(customer_id)'),
        // Independent of both, so it rides along instead of following them.
        scopeOptions(supa, userId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const byCustomer = new Map();
      const seenOrders = new Map(); // customer_id -> Set(order_id), to count distinct orders
      for (const it of orders || []) {
        const custId = it.orders?.customer_id;
        if (!custId) continue;
        const acc = byCustomer.get(custId) || { sales: 0 };
        acc.sales += Number(it.sales) || 0;
        byCustomer.set(custId, acc);
        const set = seenOrders.get(custId) || new Set();
        set.add(it.order_id);
        seenOrders.set(custId, set);
      }

      let rows = (customers || []).map((c) => {
        const agg = byCustomer.get(c.customer_id) || { sales: 0 };
        const orderCount = seenOrders.get(c.customer_id)?.size || 0;
        return { ...c, orders: orderCount, total_sales: money(agg.sales) };
      });

      rows = applyFilters(rows, params, ['customer_id', 'name']);
      return { ...paginate(sortRows(rows, params), params), scope };
    }

    if (method === 'POST') {
      const { data, error } = await supa.from('customers').insert([body]).select().single();
      if (error) throw error;
      return { row: data, __audit: { action: 'create', entity: 'customers', entityId: data.customer_id, before: null, after: data } };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa.from('customers').select('*').eq('customer_id', body.customer_id).single();
      if (e1) throw e1;
      const { data, error } = await supa.from('customers').update(body).eq('customer_id', body.customer_id).select().single();
      if (error) throw error;
      return { row: data, __audit: { action: 'update', entity: 'customers', entityId: body.customer_id, before, after: data } };
    }

    if (method === 'DELETE') {
      const { data: before, error: e1 } = await supa.from('customers').select('*').eq('customer_id', body.customer_id).single();
      if (e1) throw e1;
      const { error } = await supa.from('customers').delete().eq('customer_id', body.customer_id);
      if (error) throw error;
      return { deleted: body.customer_id, __audit: { action: 'delete', entity: 'customers', entityId: body.customer_id, before, after: null } };
    }

    const err = new Error('Method not allowed');
    err.status = 405;
    throw err;
  }
});
