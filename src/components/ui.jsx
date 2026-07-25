/**
 * Shared primitives. One file on purpose — they are small, they change
 * together, and every page imports from here so the app stays visually one
 * thing. Conventions live in docs/UI-PAGE-GUIDE.md § Cross-page conventions.
 */
import { useEffect, useId, useRef, useState } from 'react';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ surfaces */

export function Card({ children, className = '', ...rest }) {
  return (
    <div
      className={cx('bg-[var(--surface-card)] border border-[var(--border-hairline)] rounded-[var(--radius-lg)]', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function PageHeader({ title, count, scope, children }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{title}</h1>
      {scope && (
        <span className="text-[11px] px-2 py-[3px] rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] text-[var(--text-secondary)]">
          {scope}
        </span>
      )}
      {count !== undefined && (
        <span className="text-[13px] text-[var(--text-muted)] tabular-nums">{count}</span>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- buttons */

export function Button({ variant = 'secondary', loading, children, className = '', ...rest }) {
  const base = 'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-[var(--radius-md)] text-[13px] font-medium transition-colors disabled:opacity-55 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-[var(--series-1)] text-white hover:brightness-110',
    secondary: 'bg-[var(--surface-sunken)] text-[var(--text-primary)] border border-[var(--border-hairline)] hover:bg-[var(--surface-card)]',
    ghost: 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
    danger: 'bg-[var(--status-critical)] text-white hover:brightness-110',
  }[variant];
  return (
    <button className={cx(base, styles, className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-block border-2 border-current border-r-transparent rounded-full animate-spin opacity-70"
    />
  );
}

/* -------------------------------------------------------------------- fields */

export function Field({ label, hint, error, children, className = '' }) {
  const id = useId();
  const child = typeof children === 'function' ? children({ id, describedBy: hint || error ? `${id}-desc` : undefined }) : children;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[12px] font-medium text-[var(--text-secondary)]">{label}</label>
      {child}
      {(hint || error) && (
        <p id={`${id}-desc`} className={cx('text-[11px]', error ? 'text-[var(--status-critical)]' : 'text-[var(--text-muted)]')}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

const inputClass = 'h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-60';

export function TextField({ label, hint, error, className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => (
        <input id={id} aria-describedby={describedBy} aria-invalid={!!error || undefined} className={inputClass} {...rest} />
      )}
    </Field>
  );
}

export function Select({ label, hint, error, options = [], className, ...rest }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {({ id, describedBy }) => (
        <select id={id} aria-describedby={describedBy} className={inputClass} {...rest}>
          {options.map((o) => {
            const value = typeof o === 'string' ? o : o.value;
            const text = typeof o === 'string' ? o : o.label;
            return <option key={value} value={value}>{text}</option>;
          })}
        </select>
      )}
    </Field>
  );
}

/** A real radio group, not styled divs. */
export function SegmentedControl({ label, value, onChange, options, name }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">{label}</legend>
      <div className="inline-flex gap-1 p-1 rounded-[var(--radius-md)] bg-[var(--surface-sunken)] w-fit">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'px-3 py-1.5 rounded-[var(--radius-sm)] text-[12px] cursor-pointer',
              value === o.value
                ? 'bg-[var(--surface-card)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-secondary)]'
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ----------------------------------------------------------- status & states */

const SEVERITY = {
  critical: { color: 'var(--status-critical)', icon: '!', word: 'CRITICAL' },
  serious: { color: 'var(--status-serious)', icon: '!', word: 'SERIOUS' },
  warning: { color: 'var(--status-warning)', icon: '!', word: 'WARNING' },
  good: { color: 'var(--status-good)', icon: '✓', word: 'GOOD' },
};

/** Severity is icon + word + color, never colour alone. */
export function SeverityPill({ severity = 'warning' }) {
  const s = SEVERITY[severity] || SEVERITY.warning;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-[var(--radius-sm)] text-[10px] font-semibold tracking-wide"
      style={{ color: s.color, background: `color-mix(in srgb, ${s.color} 12%, transparent)` }}
    >
      <span aria-hidden="true">{s.icon}</span>{s.word}
    </span>
  );
}

export function Skeleton({ className = '', style }) {
  return (
    <div
      className={cx('bg-[var(--surface-sunken)] rounded-[var(--radius-sm)] animate-pulse', className)}
      style={style}
      aria-hidden="true"
    />
  );
}

/**
 * Empty states always distinguish no data / filtered to nothing / out of scope.
 * Three causes, three fixes, three messages.
 */
export function EmptyState({ title, body, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center">
      <p className="text-[16px] font-semibold text-[var(--text-primary)]">{title}</p>
      {body && <p className="text-[13px] text-[var(--text-secondary)] max-w-md">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, detail, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-6 text-center" role="alert">
      <p className="text-[16px] font-semibold text-[var(--text-primary)]">{title}</p>
      {detail && <p className="text-[13px] text-[var(--text-secondary)] max-w-md">{detail}</p>}
      {onRetry && <Button className="mt-3" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function InlineError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[12px] text-[var(--status-critical)] mt-2">{children}</p>
  );
}

export function DeniedCard({ module }) {
  return (
    <Card className="p-8 text-center">
      <p className="text-[16px] font-semibold text-[var(--text-primary)]">
        You do not have access to {module}
      </p>
      <p className="text-[13px] text-[var(--text-secondary)] mt-1">
        Ask an administrator to grant you <code>{module}.read</code>.
      </p>
    </Card>
  );
}

/** Translucent overlay over previous data — never collapse to a skeleton on a
 *  keystroke, it makes search feel broken. */
export function RefetchOverlay({ active, children }) {
  return (
    <div className="relative">
      {children}
      {active && <div className="absolute inset-0 bg-[var(--surface-page)]/45 pointer-events-none" aria-hidden="true" />}
    </div>
  );
}

/* -------------------------------------------------------------------- drawer */

/** Drawers over modals: context stays visible behind them. Focus-trapped,
 *  Escape closes, focus returns to the trigger. */
export function Drawer({ open, title, subtitle, onClose, footer, children }) {
  const ref = useRef(null);
  const returnTo = useRef(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    const node = ref.current;
    node?.querySelector('input,select,textarea,button')?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !node) return;
      const items = node.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/25" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-[440px] h-full bg-[var(--surface-card)] border-l border-[var(--border-hairline)] flex flex-col shadow-2xl max-sm:max-w-none"
      >
        <header className="flex items-start gap-3 px-5 py-4 border-b border-[var(--border-hairline)]">
          <div className="flex-1 min-w-0">
            <h2 className="text-[17px] font-semibold text-[var(--text-primary)] truncate">{title}</h2>
            {subtitle && <p className="text-[12px] text-[var(--text-muted)] truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-[18px] leading-none px-1">×</button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-hairline)]">{footer}</footer>
        )}
      </div>
    </div>
  );
}

/** Modals are for destructive confirms only, and they name the object and the
 *  consequence — never a bare "Are you sure?". */
export function ConfirmDialog({ open, title, body, confirmLabel = 'Delete', onConfirm, onClose, busy, blocked }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <Card className="relative w-full max-w-[420px] p-5" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">{title}</h2>
        <p className="text-[13px] text-[var(--text-secondary)] mt-2">{body}</p>
        <div className="flex justify-end gap-2 mt-5">
          {blocked ? (
            <Button onClick={onClose}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="danger" loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

/* --------------------------------------------------------------- data tables */

/**
 * Real <table> semantics with <th scope="col">. Sortable headers are buttons
 * with aria-sort. Wide content scrolls inside its own container; the page body
 * never scrolls horizontally.
 */
export function DataTable({ columns, rows, rowKey, sort, onSort, loading, empty, actions }) {
  if (!loading && (!rows || rows.length === 0)) return empty || null;

  return (
    <div className="overflow-x-auto border border-[var(--border-hairline)] rounded-[var(--radius-lg)] bg-[var(--surface-card)]">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--surface-sunken)]">
            {columns.map((c) => {
              const active = sort === c.key || sort === `-${c.key}`;
              const dir = sort === c.key ? 'ascending' : sort === `-${c.key}` ? 'descending' : 'none';
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.sortable ? dir : undefined}
                  className={cx('text-left font-medium text-[var(--text-secondary)] px-3 py-2.5 whitespace-nowrap', c.numeric && 'text-right', c.hideBelow)}
                >
                  {c.sortable && onSort ? (
                    <button
                      onClick={() => onSort(active && sort === c.key ? `-${c.key}` : c.key)}
                      className="inline-flex items-center gap-1 hover:text-[var(--text-primary)]"
                    >
                      {c.label}
                      <span aria-hidden="true" className="opacity-60">{dir === 'ascending' ? '▲' : dir === 'descending' ? '▼' : '↕'}</span>
                    </button>
                  ) : c.label}
                </th>
              );
            })}
            {actions && <th scope="col" className="px-3 py-2.5 w-px" aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 8 }, (_, i) => (
                <tr key={i} className="border-t border-[var(--border-hairline)]">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-2.5"><Skeleton className="h-4 w-full" /></td>
                  ))}
                  {actions && <td className="px-3 py-2.5"><Skeleton className="h-4 w-12" /></td>}
                </tr>
              ))
            : rows.map((row) => (
                <tr key={rowKey(row)} className="border-t border-[var(--border-hairline)] hover:bg-[var(--surface-sunken)]/60">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cx('px-3 py-2.5 text-[var(--text-primary)]', c.numeric && 'text-right tabular-nums', c.hideBelow)}
                    >
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                  {actions && <td className="px-3 py-2.5 whitespace-nowrap">{actions(row)}</td>}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center gap-3 mt-3 text-[12px] text-[var(--text-secondary)]">
      <div className="flex items-center gap-1">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</Button>
        <span className="tabular-nums px-2">Page {page} of {pages}</span>
        <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</Button>
      </div>
      <div className="flex-1" />
      <label className="flex items-center gap-2">
        <span>Rows</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="h-8 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-hairline)]"
        >
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <span className="tabular-nums">{total.toLocaleString()} total</span>
    </div>
  );
}

/* --------------------------------------------------------------- table views */

/** A table view sits under every chart. */
export function TableView({ columns, rows, label = 'View as table' }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline underline-offset-2"
      >
        {open ? 'Hide table' : label}
      </button>
      {open && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cx('text-left px-2 py-1.5 text-[var(--text-secondary)] font-medium', c.numeric && 'text-right')}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-hairline)]">
                  {columns.map((c) => (
                    <td key={c.key} className={cx('px-2 py-1.5 text-[var(--text-primary)]', c.numeric && 'text-right tabular-nums')}>
                      {c.render ? c.render(r) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- dirty bar  */

export function DirtyStateBar({ count, onDiscard, onSave, saving, error }) {
  if (!count && !error) return null;
  return (
    <div
      className="sticky bottom-0 z-20 flex items-center gap-3 px-4 py-3 mt-4 rounded-[var(--radius-lg)] border bg-[var(--surface-card)]"
      style={{ borderColor: error ? 'var(--status-critical)' : 'var(--border-hairline)' }}
    >
      <span aria-live="polite" className="text-[13px] text-[var(--text-primary)]">
        {error ? error : `${count} unsaved change${count === 1 ? '' : 's'}`}
      </span>
      <div className="flex-1" />
      <Button variant="ghost" onClick={onDiscard}>Discard</Button>
      <Button variant="primary" loading={saving} onClick={onSave}>Save changes</Button>
    </div>
  );
}

/* -------------------------------------------------------------- formatting   */

export const fmtCurrency = (n, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n || 0);

export const fmtNumber = (n) => new Intl.NumberFormat('en-US').format(Math.round(n || 0));

export const fmtPercent = (n) => `${(n * 100).toFixed(1)}%`;

export function RelativeTime({ value }) {
  const date = new Date(value);
  const diff = (Date.now() - date.getTime()) / 1000;
  const units = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [Infinity, 'day']];
  let text = 'just now';
  if (diff >= 60) {
    const [, unit] = units.find(([s]) => diff < s) || units[3];
    const div = { second: 1, minute: 60, hour: 3600, day: 86400 }[unit];
    text = `${Math.floor(diff / div)} ${unit}${Math.floor(diff / div) === 1 ? '' : 's'} ago`;
  }
  return <time dateTime={date.toISOString()} title={date.toUTCString()}>{text}</time>;
}

/** All animation is off under prefers-reduced-motion. */
export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
