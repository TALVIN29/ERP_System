/**
 * GET /api/threshold-preview?discount_alert=0.2
 * Preview how many order items exceed the discount threshold.
 */
import guard from './_lib/guard.js';

export default guard({
  module: 'settings',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    const threshold = parseFloat(url.searchParams.get('discount_alert') || '0.2');

    const { count, error } = await supa
      .from('order_items')
      .select('id', { count: 'exact' })
      .gte('discount', threshold);

    if (error) throw error;

    return { flagged: count || 0 };
  }
});
