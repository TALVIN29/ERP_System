/**
 * GET /api/insights
 * Rule-based insight engine output
 */
import guard from './_lib/guard.js';

export default guard({
  module: 'insights',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    // Fetch insights from the SQL view or RPC
    const { data, error } = await supa.rpc('get_insights');
    if (error) throw error;

    return { insights: data || [] };
  }
});
