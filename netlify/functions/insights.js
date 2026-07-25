/**
 * GET /api/insights
 * Rule-based insight engine output. Shape must match src/lib/mock.js's
 * computeInsights(): [{id, severity, title, finding, metrics: [...], action, evidence}].
 * Note `metrics` is a plural ARRAY per insight, not a single `metric` string.
 */
import guard from './_lib/guard.js';

// Normalizes whatever 03_insights.sql's get_insights() returns into the exact
// contract shape — the SQL side may reasonably emit a singular `metric`/`delta`
// pair (as PLAN.md's rule-engine sketch describes) where the UI contract wants
// a `metrics` array of {label, value, tone}.
function normalizeInsight(row) {
  let metrics = row.metrics;
  if (!Array.isArray(metrics)) {
    metrics = [];
    if (row.metric !== undefined) {
      metrics.push({ label: row.metric_label ?? 'Metric', value: row.metric, tone: row.tone });
    }
    if (row.delta !== undefined) {
      metrics.push({ label: 'Delta', value: row.delta, tone: row.delta < 0 ? 'down' : undefined });
    }
  }

  return {
    id: row.id,
    severity: row.severity,
    title: row.title,
    finding: row.finding,
    metrics,
    action: row.action,
    evidence: row.evidence ?? { type: 'table', rows: [] },
  };
}

export default guard({
  module: 'insights',
  action: 'read',
  run: async (supa, body, userId, method, url) => {
    const { data, error } = await supa.rpc('get_insights');
    if (error) throw error;

    return { insights: (data || []).map(normalizeInsight) };
  }
});
