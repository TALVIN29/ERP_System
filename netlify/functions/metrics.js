/**
 * GET /api/metrics
 * Dashboard aggregates (KPIs, trends, category profit, region sales).
 * Shape must match src/lib/mock.js's buildMetrics(): { metrics: { kpis, trend,
 * categoryProfit, regionSales } }, where each kpi carries {key,label,value,format,delta}.
 */
import guard from './_lib/guard.js';

// The SQL side (03_insights.sql) is free to name/shape columns however is natural
// in Postgres; this is the one seam that asserts the RPC output actually matches
// the contract the React pages render against, and fills in any gap defensively
// rather than shipping a KPI silently missing its delta.
function normalizeKpi(row) {
  return {
    key: row.key ?? row.kpi_key ?? '',
    label: row.label ?? row.kpi_label ?? '',
    value: Number(row.value ?? 0),
    format: row.format ?? 'number',
    delta: Number(row.delta ?? 0),
  };
}

function normalizeTrend(row) {
  return { month: row.month, sales: Number(row.sales ?? 0) };
}

function normalizeCategoryProfit(row) {
  return { category: row.category, profit: Number(row.profit ?? 0) };
}

function normalizeRegionSales(row) {
  return { region: row.region, sales: Number(row.sales ?? 0) };
}

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
        kpis: (kpis || []).map(normalizeKpi),
        trend: (trend || []).map(normalizeTrend),
        categoryProfit: (categoryProfit || []).map(normalizeCategoryProfit),
        regionSales: (regionSales || []).map(normalizeRegionSales),
      }
    };
  }
});
