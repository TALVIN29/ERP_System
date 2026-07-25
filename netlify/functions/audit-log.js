/**
 * GET /api/audit-log
 * Paginated, filtered audit log. Read-only.
 */
import guard from './_lib/guard.js';

export default guard({
  module: 'audit',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    const page = parseInt(url.searchParams.get('page') || '1');
    // Everything else in the app uses `pageSize` (camelCase) — this used to read
    // `page_size` and emit it back the same way, which the client never looked for.
    const pageSize = Math.min(parseInt(url.searchParams.get('pageSize') || '50'), 200);
    const offset = (page - 1) * pageSize;

    let query = supa.from('audit_log').select('*', { count: 'exact' });

    const action = url.searchParams.get('action');
    if (action) query = query.eq('action', action);

    const entity = url.searchParams.get('entity');
    if (entity) query = query.eq('entity', entity);

    const userIdFilter = url.searchParams.get('user_id');
    if (userIdFilter) query = query.eq('user_id', userIdFilter);

    const dateFrom = url.searchParams.get('date_from');
    if (dateFrom) query = query.gte('at', dateFrom);

    const dateTo = url.searchParams.get('date_to');
    if (dateTo) query = query.lte('at', dateTo);

    const q = url.searchParams.get('q');
    if (q) query = query.ilike('entity_id', `%${q}%`);

    const { data, count, error } = await query
      .order('at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;

    return {
      rows: data || [],
      page,
      pageSize,
      total: count || 0,
    };
  }
});
