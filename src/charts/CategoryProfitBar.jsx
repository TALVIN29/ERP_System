import { useRef } from 'react';
import { useChart, cssVar } from './useChart';
import { Card, TableView, fmtCurrency } from '../components/ui';

const tableColumns = [
  { key: 'category', label: 'Category' },
  { key: 'profit', label: 'Profit', numeric: true, render: (r) => fmtCurrency(r.profit) },
];

export function CategoryProfitBar({ data = [] }) {
  const canvasRef = useRef(null);

  // Fixed series slot order: Furniture (1), Office Supplies (2), Technology (3)
  const categorySlot = { 'Furniture': 0, 'Office Supplies': 1, 'Technology': 2 };
  const seriesColors = [cssVar('--series-1'), cssVar('--series-2'), cssVar('--series-3')];

  const config = {
    type: 'bar',
    data: {
      labels: data.map((d) => d.category),
      datasets: [
        {
          label: 'Profit',
          data: data.map((d) => d.profit),
          backgroundColor: data.map((d) => {
            const slot = categorySlot[d.category] ?? 0;
            return d.profit < 0 ? cssVar('--status-critical') : seriesColors[slot];
          }),
          borderRadius: 4,
          barThickness: 16,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${Number(ctx.raw).toLocaleString('en', { maximumFractionDigits: 0 })}`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: cssVar('--text-muted') },
          grid: { color: cssVar('--gridline') },
        },
        y: {
          ticks: { color: cssVar('--text-muted') },
          grid: { display: false },
        },
      },
    },
  };

  useChart(canvasRef, config);

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4">
          Profit by category
        </h2>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Bar chart of profit by product category"
          style={{ maxHeight: '200px' }}
        />
        <TableView columns={tableColumns} rows={data} label="View as table" />
      </div>
    </Card>
  );
}
