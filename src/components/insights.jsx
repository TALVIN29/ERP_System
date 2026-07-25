import { useState } from 'react';
import { Card, SeverityPill, Button } from './ui';
import { DiscountScatter } from '../charts/DiscountScatter';

const severityBg = {
  critical: 'rgba(208, 59, 59, 0.08)',
  serious: 'rgba(236, 131, 90, 0.08)',
  warning: 'rgba(250, 178, 25, 0.08)',
  good: 'rgba(12, 163, 12, 0.08)',
};

export function InsightCard({ insight, onShowEvidence }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden">
      <div className="p-6">
        {/* Header: severity pill + title */}
        <div className="flex items-start gap-3 mb-3">
          <SeverityPill severity={insight.severity} />
          <h2 className="text-[14px] font-semibold text-[var(--text-primary)] flex-1">
            {insight.title}
          </h2>
        </div>

        {/* Finding text */}
        <p className="text-[13px] text-[var(--text-secondary)] mb-4">
          {insight.finding}
        </p>

        {/* Metrics display */}
        {insight.metrics && insight.metrics.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            {insight.metrics.map((m, i) => (
              <div key={i}>
                <p className="text-[11px] text-[var(--text-muted)] mb-1">{m.label}</p>
                <p className={`text-[14px] font-semibold ${
                  m.tone === 'down' ? 'text-[var(--status-critical)]' : 'text-[var(--text-primary)]'
                }`}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Action band — visually distinct */}
        <div
          className="p-3 rounded-[var(--radius-md)] mb-4"
          style={{ backgroundColor: severityBg[insight.severity] }}
        >
          <p className="text-[12px] font-medium text-[var(--text-primary)]">
            {insight.action}
          </p>
        </div>

        {/* Show evidence button */}
        {insight.evidence && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {expanded ? 'Hide' : 'Show'} evidence
          </button>
        )}
      </div>

      {/* Expanded evidence */}
      {expanded && insight.evidence && (
        <div className="border-t border-[var(--border-hairline)] p-6 bg-[var(--surface-sunken)]">
          <EvidenceTable evidence={insight.evidence} />
        </div>
      )}
    </Card>
  );
}

export function EvidenceTable({ evidence }) {
  if (!evidence) return null;

  if (evidence.type === 'discount-scatter') {
    return <DiscountScatter points={evidence.points} ladder={evidence.ladder} />;
  }

  if (evidence.type === 'table' && evidence.rows) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border-hairline)]">
              {Object.keys(evidence.rows[0] || {}).map((k) => (
                <th key={k} className="text-left p-2 text-[var(--text-muted)] font-medium">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evidence.rows.map((row, i) => (
              <tr key={i} className="border-b border-[var(--border-hairline)]">
                {Object.values(row).map((v, j) => (
                  <td key={j} className="p-2 text-[var(--text-secondary)]">
                    {typeof v === 'number' ? (
                      v % 1 === 0
                        ? v.toLocaleString()
                        : `$${Number(v).toLocaleString('en', { maximumFractionDigits: 2 })}`
                    ) : (
                      v
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

export function ExportMenu({ canExport = false }) {
  const [open, setOpen] = useState(false);

  if (!canExport) return null;

  const datasets = ['orders', 'order_items', 'products', 'customers', 'insights'];

  const handleExport = (dataset) => {
    const url = `/api/export?dataset=${dataset}`;
    fetch(url).then((r) => r.json()).then((data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${dataset}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    });
    setOpen(false);
  };

  return (
    <div className="relative inline-block">
      <Button variant="secondary" onClick={() => setOpen(!open)}>
        Export
      </Button>
      {open && (
        <div className="absolute right-0 mt-2 bg-[var(--surface-card)] border border-[var(--border-hairline)] rounded-[var(--radius-md)] shadow-lg z-10">
          {datasets.map((ds) => (
            <button
              key={ds}
              onClick={() => handleExport(ds)}
              className="block w-full text-left px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]"
            >
              {ds}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
