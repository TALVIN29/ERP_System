/**
 * GET /api/scope-preview?region=East&category=Furniture
 * Preview how many records are scoped to the given region/category combination.
 *
 * Uses the SERVICE client deliberately: this previews a scope assignment for
 * ANOTHER user (an admin editing someone else's region/category grant), so
 * counting through the caller's own RLS-scoped client would silently shrink
 * the numbers to the admin's own scope — wrong exactly when the admin is
 * previewing a scope wider or different from their own. It is a count, not
 * a data read, and `users.read` (checked centrally in guard.js) is still the
 * gate that gets you here at all.
 */
import guard from './_lib/guard.js';
import { serviceClient } from './_lib/supa.js';

export default guard({
  module: 'users',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    const regions = url.searchParams.getAll('region');
    const categories = url.searchParams.getAll('category');

    let query = serviceClient.from('order_items').select('id', { count: 'exact', head: true });
    if (regions.length > 0) query = query.in('region', regions);
    if (categories.length > 0) query = query.in('category', categories);

    const { count: matched, error } = await query;
    if (error) throw error;

    const { count: total, error: e2 } = await serviceClient
      .from('order_items')
      .select('id', { count: 'exact', head: true });
    if (e2) throw e2;

    return { matched: matched || 0, total: total || 0 };
  }
});
