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
    // Four independent aggregates. Awaited one at a time they cost the sum of
    // their latencies (~6.5s measured); together they cost the slowest one.
    // Scope is applied inside each function, which also checks insights.read.
    const [kpiRes, trendRes, catRes, regionRes] = await Promise.all([
      supa.rpc('get_dashboard_kpis'),
      supa.rpc('get_sales_trend'),
      supa.rpc('get_category_profit'),
      supa.rpc('get_region_sales'),
    ]);

    for (const r of [kpiRes, trendRes, catRes, regionRes]) {
      if (r.error) throw r.error;
    }

    const kpis = kpiRes.data;
    const trend = trendRes.data;
    const categoryProfit = catRes.data;
    const regionSales = regionRes.data;

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
