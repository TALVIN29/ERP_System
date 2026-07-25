import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { countUp } from '../lib/countup.js';
import { KPI_ICONS } from '../components/icons.jsx';
import { useApi } from '../lib/useApi';
import {
  Card,
  PageHeader,
  Skeleton,
  ErrorState,
  EmptyState,
  Button,
} from '../components/ui';
import { SalesTrendLine } from '../charts/SalesTrendLine';
import { CategoryProfitBar } from '../charts/CategoryProfitBar';
import { RegionDonut } from '../charts/RegionDonut';

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

function KpiTile({ kpi, scope }) {
  const valueRef = useRef(null);
  const previousValue = useRef(kpi.value);
  const Icon = KPI_ICONS[kpi.key];

  useEffect(() => {
    if (!valueRef.current || reducedMotion()) {
      if (valueRef.current) {
        valueRef.current.textContent = formatValue(kpi.value, kpi.format);
      }
      return;
    }

    // Count from the PREVIOUS value, not from zero — on a refetch the
    // direction of that movement is itself information.
    const cancel = countUp(valueRef.current, {
      from: previousValue.current,
      to: kpi.value,
      duration: 800,
      format: (n) => formatValue(n, kpi.format),
    });

    previousValue.current = kpi.value;
    return cancel;
  }, [kpi.value, kpi.format]);

  const deltaDir = kpi.delta >= 0 ? 'up' : 'down';
  const deltaColor = deltaDir === 'up' ? 'var(--delta-up)' : 'var(--delta-down)';

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <span
              className="grid place-items-center w-7 h-7 rounded-[var(--radius-md)] shrink-0"
              style={{ color: 'var(--series-1)', background: 'color-mix(in srgb, var(--series-1) 12%, transparent)' }}
            >
              <Icon size={16} />
            </span>
          )}
          <p className="text-[11px] text-[var(--text-muted)] font-medium">{kpi.label}</p>
        </div>
        <div
          ref={valueRef}
          className="text-[24px] font-semibold text-[var(--text-primary)]"
          style={{ fontVariantNumeric: 'proportional-nums' }}
        >
          {formatValue(kpi.value, kpi.format)}
        </div>
        {/* Direction is icon + arrow + label, never colour alone. */}
        <div className="flex items-center gap-1 text-[11px]" style={{ color: deltaColor }}>
          <span aria-hidden="true">{deltaDir === 'up' ? '↑' : '↓'}</span>
          <span>
            {Math.abs(Math.round(kpi.delta * 1000) / 10)}%
            <span className="sr-only"> {deltaDir === 'up' ? 'increase' : 'decrease'}</span>
          </span>
        </div>
      </div>
    </Card>
  );
}

function formatValue(value, format) {
  if (value === null || value === undefined) return '—';
  if (format === 'currency') {
    return '$' + Number(value).toLocaleString('en', { maximumFractionDigits: 0 });
  }
  return Number(value).toLocaleString('en');
}

function DateRangeControl({ onRangeChange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [preset, setPreset] = useState('all');

  const handlePreset = (p) => {
    setPreset(p);
    const now = new Date();
    let from, to;

    if (p === 'all') {
      setSearchParams({});
    } else if (p === '30d') {
      to = now;
      from = new Date(now.getTime() - 30 * 86400000);
      setSearchParams({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    } else if (p === '90d') {
      to = now;
      from = new Date(now.getTime() - 90 * 86400000);
      setSearchParams({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
    }
  };

  return (
    <div className="flex gap-2 items-center">
      <select
        value={preset}
        onChange={(e) => handlePreset(e.target.value)}
        className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] text-[var(--text-primary)]"
      >
        <option value="all">All time</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
    </div>
  );
}

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const params = {
    date_from: searchParams.get('from'),
    date_to: searchParams.get('to'),
  };

  const { data, error, loading, refetching, refetch } = useApi('/metrics', params);
  const metrics = data?.metrics;

  if (error) {
    return (
      <div className="p-6">
        <PageHeader title="Dashboard" />
        <ErrorState
          title="Could not load dashboard metrics"
          onRetry={refetch}
        />
      </div>
    );
  }

  const isEmpty = metrics && metrics.kpis.every((k) => k.value === 0 || k.value === '—');

  return (
    <div className="p-6">
      <PageHeader title="Dashboard">
        <DateRangeControl />
      </PageHeader>

      {/* KPI Tiles */}
      <div className="grid grid-cols-4 gap-4 mb-6 md:grid-cols-2 sm:grid-cols-1">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} style={{ height: '120px' }} />
          ))
        ) : metrics && metrics.kpis ? (
          metrics.kpis.map((kpi) => (
            <KpiTile key={kpi.key} kpi={kpi} />
          ))
        ) : null}
      </div>

      {isEmpty && (
        <EmptyState
          title="No data in this range"
          body="Adjust your date range or reset to see all data."
          action={<Button onClick={() => window.location.href = '/app/dashboard'}>Reset to all time</Button>}
        />
      )}

      {!isEmpty && metrics && (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 gap-6 mb-6">
            <SalesTrendLine data={metrics.trend} />
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-1">
              <CategoryProfitBar data={metrics.categoryProfit} />
              <RegionDonut data={metrics.regionSales} />
            </div>
          </div>
        </>
      )}

      {refetching && (
        <div className="fixed inset-0 bg-white/50 dark:bg-black/50 pointer-events-none" />
      )}
    </div>
  );
}
