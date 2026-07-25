/**
 * GET /api/metrics
 * Dashboard aggregates (KPIs, trends, category profit, region sales)
 */
import guard from './_lib/guard.js';

export default guard({
  module: 'insights',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    // Fetch aggregated metrics. RLS ensures scoping.
    const { data: kpis, error: e1 } = await supa.rpc('get_dashboard_kpis');
    if (e1) throw e1;

    const { data: trend, error: e2 } = await supa.rpc('get_sales_trend');
    if (e2) throw e2;

    const { data: categoryProfit, error: e3 } = await supa.rpc('get_category_profit');
    if (e3) throw e3;

    const { data: regionSales, error: e4 } = await supa.rpc('get_region_sales');
    if (e4) throw e4;

    return {
      metrics: {
        kpis: kpis || [],
        trend: trend || [],
        categoryProfit: categoryProfit || [],
        regionSales: regionSales || [],
      }
    };
  }
});
