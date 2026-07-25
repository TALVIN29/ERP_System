import { useRef, useState } from 'react';
import { useChart } from './useChart';
import { Card, TableView } from '../components/ui';

export function RegionDonut({ data = [] }) {
  const canvasRef = useRef(null);
  const [showTable, setShowTable] = useState(false);

  // Fixed series slot order by region name: Central (1), East (2), South (3), West (4)
  const regionSlot = { 'Central': 0, 'East': 1, 'South': 2, 'West': 3 };
  const seriesColors = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

  const sortedData = [...data].sort((a, b) => a.region.localeCompare(b.region));
  const total = sortedData.reduce((sum, d) => sum + d.sales, 0);

  const config = {
    type: 'doughnut',
    data: {
      labels: sortedData.map((d) => d.region),
      datasets: [
        {
          data: sortedData.map((d) => d.sales),
          backgroundColor: sortedData.map((d) => seriesColors[regionSlot[d.region] ?? 0]),
          borderColor: 'var(--surface-card)',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: 'var(--text-primary)',
            font: { size: 12 },
            padding: 12,
            generateLabels: (chart) => {
              const data = chart.data.datasets[0].data;
              return chart.data.labels.map((label, i) => ({
                text: `${label}: $${Number(data[i]).toLocaleString('en', { maximumFractionDigits: 0 })}`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                hidden: false,
                index: i,
              }));
            },
          },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `$${Number(ctx.raw).toLocaleString('en', { maximumFractionDigits: 0 })}`,
          },
        },
      },
    },
  };

  useChart(canvasRef, config);

  return (
    <Card>
      <div className="p-6">
        <h2 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4" aria-label="Sales by region">
          Sales by region
        </h2>
        <div className="flex items-center justify-center mb-4">
          <canvas ref={canvasRef} style={{ maxHeight: '250px', maxWidth: '100%' }} />
        </div>
        <div className="text-center text-[12px] text-[var(--text-secondary)] mb-4">
          Total: ${Number(total).toLocaleString('en', { maximumFractionDigits: 0 })}
        </div>
        <button
          onClick={() => setShowTable(!showTable)}
          className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {showTable ? 'Hide' : 'View'} as table
        </button>
        {showTable && (
          <TableView data={sortedData} columns={['region', 'sales']} />
        )}
      </div>
    </Card>
  );
}
