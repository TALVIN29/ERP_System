import { useRef } from 'react';
import { useChart, cssVar } from './useChart';
import { Card, TableView, fmtCurrency } from '../components/ui';

const tableColumns = [
  { key: 'month', label: 'Month' },
  { key: 'sales', label: 'Sales', numeric: true, render: (r) => fmtCurrency(r.sales) },
];

export function SalesTrendLine({ data = [] }) {
  const canvasRef = useRef(null);

  const buildConfig = () => ({
    type: 'line',
    data: {
      labels: data.map((d) => d.month),
      datasets: [
        {
          label: 'Sales',
          data: data.map((d) => d.sales),
          borderColor: cssVar('--series-1'),
          backgroundColor: 'rgba(42, 120, 214, 0.05)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: cssVar('--series-1'),
          pointBorderColor: 'white',
          pointBorderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${Number(ctx.raw).toLocaleString('en', { maximumFractionDigits: 0 })}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { color: cssVar('--text-muted') },
          grid: { color: cssVar('--gridline') },
        },
        x: {
          ticks: { color: cssVar('--text-muted') },
          grid: { display: false },
        },
      },
    },
  });

  useChart(canvasRef, buildConfig);

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4">
          Sales over time
        </h2>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Line chart of monthly sales over time"
          style={{ maxHeight: '250px' }}
        />
        <TableView columns={tableColumns} rows={data} label="View as table" />
      </div>
    </Card>
  );
}
