/**
 * GET /api/export?dataset=orders
 * Flat, model-ready JSON export. Rate-limited to 5/min.
 * Writes an audit log row.
 */
import guard from './_lib/guard.js';
import { writeAuditLog } from './_lib/audit.js';
import { serviceClient } from './_lib/supa.js';

export default guard({
  module: 'insights',
  action: 'export',
  run: async (supa, body, userId, method, url) => {
    const dataset = url.searchParams.get('dataset') || 'orders';

    // Validate dataset name
    if (!['orders', 'products', 'customers'].includes(dataset)) {
      const err = new Error('Invalid dataset');
      err.status = 400;
      throw err;
    }

    let { data, error } = await supa.from(dataset).select('*');
    if (error) throw error;

    const rows = data || [];

    // Audit the export through the service client
    await serviceClient.from('audit_log').insert({
      user_id: userId,
      action: 'export',
      entity: dataset,
      entity_id: dataset,
      before: null,
      after: { row_count: rows.length },
      at: new Date().toISOString(),
    });

    return {
      dataset,
      rows,
      row_count: rows.length,
      exported_at: new Date().toISOString(),
    };
  }
});
