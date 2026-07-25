import { Fragment, useState } from 'react';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Card, DataTable, ErrorState, Field, PageHeader, RelativeTime, Select, TextField } from '../../components/ui.jsx';
import { ActionPill, JsonDiff } from '../../components/admin.jsx';

const ENTITY_TYPES = ['orders', 'products', 'customers', 'users', 'roles', 'settings', 'audit'];
const ACTIONS = ['CREATE', 'READ', 'UPDATE', 'DELETE'];

export default function Audit() {
  const { perms } = useAuth();
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filters, setFilters] = useState({
    action: '',
    entity: '',
  });

  const { data, error, loading, refetch } = useApi('/audit-log', {
    ...filters,
    page,
    pageSize,
  });

  if (!perms.can('audit', 'read')) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[16px] font-semibold text-[var(--text-primary)]">
          You do not have access to the audit log
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load the audit log"
        detail={error.message}
        onRetry={refetch}
      />
    );
  }

  const rows = data?.rows || [];
  const total = data?.total || 0;

  const handleFilterChange = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters({ action: '', entity: '' });
    setPage(1);
  };

  const columns = [
    {
      key: 'at',
      label: 'When',
      render: (r) => <RelativeTime value={r.at} />,
    },
    {
      key: 'actor',
      label: 'Actor',
      render: (r) => r.actor === 'System' ? 'System' : r.actor,
    },
    {
      key: 'action',
      label: 'Action',
      render: (r) => <ActionPill action={r.action} />,
    },
    { key: 'entity', label: 'Entity' },
    { key: 'entity_id', label: 'ID' },
    {
      key: 'summary',
      label: 'Summary',
      render: (r) => {
        const isExpanded = expanded === r.id;
        return (
          <button
            onClick={() => setExpanded(isExpanded ? null : r.id)}
            aria-expanded={isExpanded}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {isExpanded ? '▼' : '▶'} {r.entity_id}
          </button>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        count={total}
      />

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Select
            label="Action"
            value={filters.action}
            onChange={(e) => handleFilterChange('action', e.target.value)}
            options={[{ value: '', label: 'All' }, ...ACTIONS.map((a) => ({ value: a, label: a }))]}
          />
          <Select
            label="Entity"
            value={filters.entity}
            onChange={(e) => handleFilterChange('entity', e.target.value)}
            options={[{ value: '', label: 'All' }, ...ENTITY_TYPES.map((e) => ({ value: e, label: e }))]}
          />
        </div>
        <Button
          variant="ghost"
          onClick={handleClearFilters}
          className="text-[12px]"
        >
          Clear filters
        </Button>
      </Card>

      <div className="space-y-0">
        {loading && !data ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-[var(--surface-sunken)] rounded-[var(--radius-md)] animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-[14px] text-[var(--text-secondary)]">
              {total === 0 ? 'No changes recorded yet' : 'No records match these filters'}
            </p>
          </Card>
        ) : (
          <div className="border border-[var(--border-hairline)] rounded-[var(--radius-lg)] overflow-hidden bg-[var(--surface-card)]">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="bg-[var(--surface-sunken)]">
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="text-left px-3 py-2.5 font-medium text-[var(--text-secondary)]">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t border-[var(--border-hairline)] hover:bg-[var(--surface-sunken)]/40">
                      {columns.map((c) => (
                        <td key={c.key} className="px-3 py-2.5 text-[var(--text-primary)]">
                          {c.render ? c.render(row) : row[c.key]}
                        </td>
                      ))}
                    </tr>
                    {expanded === row.id && (
                      <tr className="border-t border-[var(--border-hairline)] bg-[var(--surface-sunken)]/50">
                        <td colSpan={columns.length} className="p-4">
                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <h4 className="font-medium text-[var(--text-primary)] mb-2">Before</h4>
                              {row.before === null ? (
                                <p className="text-[12px] text-[var(--text-muted)]">Record did not exist</p>
                              ) : (
                                <div className="space-y-2">
                                  <JsonDiff value={row.before} compareTo={row.after} />
                                  <button
                                    onClick={() => navigator.clipboard.writeText(JSON.stringify(row.before, null, 2))}
                                    className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                  >
                                    Copy JSON
                                  </button>
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="font-medium text-[var(--text-primary)] mb-2">After</h4>
                              {row.after === null ? (
                                <p className="text-[12px] text-[var(--text-muted)]">Record deleted</p>
                              ) : (
                                <div className="space-y-2">
                                  <JsonDiff value={row.after} compareTo={row.before} />
                                  <button
                                    onClick={() => navigator.clipboard.writeText(JSON.stringify(row.after, null, 2))}
                                    className="text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                  >
                                    Copy JSON
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && (
        <div className="flex items-center gap-3 text-[12px] text-[var(--text-secondary)]">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
            >
              ‹
            </Button>
            <span className="tabular-nums px-2">Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
            <Button
              variant="ghost"
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
            >
              ›
            </Button>
          </div>
          <div className="flex-1" />
          <label className="flex items-center gap-2">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-8 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-hairline)]"
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="tabular-nums">{total.toLocaleString()} total</span>
        </div>
      )}
    </div>
  );
}
