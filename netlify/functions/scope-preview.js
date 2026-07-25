/**
 * GET /api/scope-preview?region=East&category=Furniture
 * Preview how many records are scoped to the given region/category combination.
 */
import guard from './_lib/guard.js';

export default guard({
  module: 'users',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    const regions = url.searchParams.getAll('region');
    const categories = url.searchParams.getAll('category');

    let query = supa.from('order_items').select('id', { count: 'exact' });

    if (regions.length > 0) {
      query = query.in('region', regions);
    }
    if (categories.length > 0) {
      query = query.in('category', categories);
    }

    const { count, error } = await query;
    if (error) throw error;

    const { data: totalCount, error: e2 } = await supa
      .from('order_items')
      .select('id', { count: 'exact' });
    if (e2) throw e2;

    return {
      matched: count || 0,
      total: totalCount || 0,
    };
  }
});
