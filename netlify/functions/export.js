/**
 * GET /api/export?dataset=orders
 * Flat, model-ready JSON export. Rate-limited to 5/min. Writes an audit row.
 * Shape must match src/lib/mock.js: order-item-shaped rows, capped at 500,
 * regardless of the `dataset` query param — mock always exports scoped order
 * items and only echoes `dataset` back, so this does the same rather than
 * switching tables with no cap.
 */
import guard from './_lib/guard.js';

const CAP = 500;

export default guard({
  module: 'insights',
  action: 'export',
  run: async (supa, body, userId, method, url) => {
    const dataset = url.searchParams.get('dataset') || 'orders';

    const { data, error } = await supa
      .from('order_items')
      .select('*')
      .limit(CAP);
    if (error) throw error;

    const rows = data || [];

    return {
      dataset,
      rows,
      __audit: { action: 'export', entity: dataset, entityId: dataset, before: null, after: { row_count: rows.length } },
    };
  }
});
