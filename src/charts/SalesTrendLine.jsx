import { useRef, useState } from 'react';
import { useChart } from './useChart';
import { Card, TableView } from '../components/ui';

export function SalesTrendLine({ data = [] }) {
  const canvasRef = useRef(null);
  const [showTable, setShowTable] = useState(false);

  const config = {
    type: 'line',
    data: {
      labels: data.map((d) => d.month),
      datasets: [
        {
          label: 'Sales',
          data: data.map((d) => d.sales),
          borderColor: 'var(--series-1)',
          backgroundColor: 'rgba(42, 120, 214, 0.05)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointBackgroundColor: 'var(--series-1)',
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
          ticks: { color: 'var(--text-muted)' },
          grid: { color: 'var(--gridline)' },
        },
        x: {
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
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4" aria-label="Sales over time">
          Sales over time
        </h2>
        <canvas ref={canvasRef} style={{ maxHeight: '250px' }} />
        <button
          onClick={() => setShowTable(!showTable)}
          className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] mt-4"
        >
          {showTable ? 'Hide' : 'View'} as table
        </button>
        {showTable && (
          <TableView data={data} columns={['month', 'sales']} />
        )}
      </div>
    </Card>
  );
}
