import { useRef, useState } from 'react';
import { useChart } from './useChart';
import { Card, TableView } from '../components/ui';

export function CategoryProfitBar({ data = [] }) {
  const canvasRef = useRef(null);
  const [showTable, setShowTable] = useState(false);

  // Fixed series slot order: Furniture (1), Office Supplies (2), Technology (3)
  const categorySlot = { 'Furniture': 0, 'Office Supplies': 1, 'Technology': 2 };
  const seriesColors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];

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
            return d.profit < 0 ? 'var(--status-critical)' : seriesColors[slot];
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
          ticks: { color: 'var(--text-muted)' },
          grid: { color: 'var(--gridline)' },
        },
        y: {
          ticks: { color: 'var(--text-muted)' },
          grid: { display: false },
        },
      },
    },
  };

  useChart(canvasRef, config);

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4" aria-label="Profit by category">
          Profit by category
        </h2>
        <canvas ref={canvasRef} style={{ maxHeight: '200px' }} />
        <button
          onClick={() => setShowTable(!showTable)}
          className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] mt-4"
        >
          {showTable ? 'Hide' : 'View'} as table
        </button>
        {showTable && (
          <TableView data={data} columns={['category', 'profit']} />
        )}
      </div>
    </Card>
  );
}
