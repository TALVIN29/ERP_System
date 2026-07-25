/**
 * GET/POST/PATCH/DELETE /api/products
 * Response shape must match src/lib/mock.js route()'s '/products' branch:
 * {rows, total, page, pageSize} with order_lines/total_sales computed per row.
 */
import guard from './_lib/guard.js';
import { scopeOptions } from './_lib/scope.js';
import { applyFilters, sortRows, paginate } from './_lib/listutil.js';

const money = (n) => Math.round(n * 100) / 100;

export default guard({
  module: 'products',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    if (method === 'GET') {
      const params = url.searchParams;

      const [{ data: products, error: e1 }, { data: items, error: e2 }, scope] = await Promise.all([
        supa.from('products').select('*'),
        // order_items carries scope columns directly, so RLS scoping applies here too.
        supa.from('order_items').select('product_id, sales'),
        // Independent of both, so it rides along instead of following them.
        scopeOptions(supa, userId),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const byProduct = new Map();
      for (const it of items || []) {
        const acc = byProduct.get(it.product_id) || { lines: 0, sales: 0 };
        acc.lines++;
        acc.sales += Number(it.sales) || 0;
        byProduct.set(it.product_id, acc);
      }

      let rows = (products || []).map((p) => {
        const agg = byProduct.get(p.product_id) || { lines: 0, sales: 0 };
        return { ...p, order_lines: agg.lines, total_sales: money(agg.sales) };
      });

      rows = applyFilters(rows, params, ['product_id', 'name']);
      return { ...paginate(sortRows(rows, params), params), scope };
    }

    if (method === 'POST') {
      const { data, error } = await supa.from('products').insert([body]).select().single();
      if (error) throw error;
      return { row: data, __audit: { action: 'create', entity: 'products', entityId: data.product_id, before: null, after: data } };
    }

    if (method === 'PATCH') {
      const { data: before, error: e1 } = await supa.from('products').select('*').eq('product_id', body.product_id).single();
      if (e1) throw e1;
      const { data, error } = await supa.from('products').update(body).eq('product_id', body.product_id).select().single();
      if (error) throw error;
      return { row: data, __audit: { action: 'update', entity: 'products', entityId: body.product_id, before, after: data } };
    }

    if (method === 'DELETE') {
      const { data: before, error: e1 } = await supa.from('products').select('*').eq('product_id', body.product_id).single();
      if (e1) throw e1;

      // Same referential-integrity guard mock.js's mutateCollection() applies:
      // a product still on order lines cannot be deleted outright.
      const { count, error: eCount } = await supa
        .from('order_items').select('id', { count: 'exact', head: true }).eq('product_id', body.product_id);
      if (eCount) throw eCount;
      if (count) {
        const err = new Error(`This product appears on ${count} order lines and cannot be deleted.`);
        err.status = 409;
        throw err;
      }

      const { error } = await supa.from('products').delete().eq('product_id', body.product_id);
      if (error) throw error;
      return { deleted: body.product_id, __audit: { action: 'delete', entity: 'products', entityId: body.product_id, before, after: null } };
    }

    const err = new Error('Method not allowed');
    err.status = 405;
    throw err;
  }
});
