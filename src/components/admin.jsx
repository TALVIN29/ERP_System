import { useEffect, useId, useRef, useState } from 'react';
import anime from 'animejs';
import { MODULES, ACTIONS, ACTION_LABEL, isLocked, scopeLabel } from '../lib/perms.js';
import { reducedMotion } from './ui.jsx';
import { Button, Card, Field, Select, Spinner, cx } from './ui.jsx';

const ACTION_NAMES = {
  read: 'Read', create: 'Create', update: 'Update',
  delete: 'Delete', export: 'Export',
};

const ROLE_ORDER = ['admin', 'manager', 'analyst', 'viewer', 'finance', 'warehouse'];

export function PermissionMatrix({ roles, grants, original, loading, denied, onChange }) {
  const [mobile, setMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {MODULES.map((m) => (
          <div key={m} className="h-10 bg-[var(--surface-sunken)] rounded-[var(--radius-md)] animate-pulse" />
        ))}
      </div>
    );
  }

  const sortedRoles = [...roles].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.key);
    const bi = ROLE_ORDER.indexOf(b.key);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const isDirty = (roleKey, perm) => {
    return original && JSON.stringify(grants[roleKey]) !== JSON.stringify(original[roleKey]);
  };

  if (mobile) {
    return (
      <MobileMatrix roles={sortedRoles} grants={grants} original={original} denied={denied} onChange={onChange} />
    );
  }

  return (
    <div className="overflow-x-auto border border-[var(--border-hairline)] rounded-[var(--radius-lg)] bg-[var(--surface-card)]">
      <table className="border-collapse text-[13px]">
        <thead>
          <tr className="bg-[var(--surface-sunken)]">
            <th scope="col" className="sticky left-0 z-10 bg-[var(--surface-sunken)] px-3 py-2.5 text-left font-medium text-[var(--text-secondary)] min-w-[100px]">Module</th>
            {sortedRoles.map((r) => (
              <th key={r.key} scope="col" className="px-2 py-2.5 text-center">
                <div className="font-medium text-[var(--text-primary)]">{r.name}</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1 space-x-0.5">
                  {ACTIONS.map((a) => (
                    <span key={a} title={ACTION_NAMES[a]}>{ACTION_LABEL[a]}</span>
                  ))}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MODULES.map((m) => (
            <tr key={m} className="border-t border-[var(--border-hairline)]">
              <td className="sticky left-0 z-10 bg-[var(--surface-card)] px-3 py-2.5 font-medium text-[var(--text-primary)] border-r border-[var(--border-hairline)]">{m}</td>
              {sortedRoles.map((r) => (
                <td key={r.key} className="px-2 py-2.5 text-center border-r border-[var(--border-hairline)] hover:bg-[var(--surface-sunken)]/40 transition-colors">
                  <div className="flex justify-center gap-1">
                    {ACTIONS.map((a) => (
                      <MatrixCell
                        key={`${r.key}-${a}`}
                        module={m}
                        action={a}
                        role={r}
                        granted={grants[r.key]?.includes(`${m}.${a}`)}
                        disabled={denied}
                        isDirty={isDirty(r.key, `${m}.${a}`)}
                        onChange={() => onChange(r.key, m, a)}
                      />
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileMatrix({ roles, grants, original, denied, onChange }) {
  const [selected, setSelected] = useState(roles[0]?.key);
  const role = roles.find((r) => r.key === selected);

  const isDirty = (roleKey) => {
    return original && JSON.stringify(grants[roleKey]) !== JSON.stringify(original[roleKey]);
  };

  return (
    <div className="space-y-4">
      <Select
        label="Role"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        options={roles.map((r) => ({ value: r.key, label: r.name }))}
      />
      {role && (
        <div className="space-y-3">
          {MODULES.map((m) => (
            <Card key={m} className="p-4">
              <div className="font-medium text-[var(--text-primary)] mb-3">{m}</div>
              <div className="grid grid-cols-5 gap-2">
                {ACTIONS.map((a) => (
                  <MatrixCell
                    key={`${role.key}-${a}`}
                    module={m}
                    action={a}
                    role={role}
                    granted={grants[role.key]?.includes(`${m}.${a}`)}
                    disabled={denied}
                    isDirty={isDirty(role.key)}
                    onChange={() => onChange(role.key, m, a)}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function MatrixCell({ module, action, role, granted, disabled, isDirty, onChange }) {
  const ref = useRef(null);
  const locked = isLocked(module, action);

  const tooltip = locked
    ? 'Audit records are written by the system and cannot be created or modified.'
    : `${role.name} can ${action} ${module}.`;

  if (locked) {
    return (
      <div
        ref={ref}
        title={tooltip}
        className="relative w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-sunken)] cursor-not-allowed opacity-55"
        aria-label={tooltip}
      >
        🔒
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        ref={ref}
        type="checkbox"
        checked={granted}
        onChange={onChange}
        disabled={disabled}
        title={tooltip}
        aria-label={tooltip}
        className="w-6 h-6 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-hairline)] accent-[var(--series-1)] disabled:opacity-55 disabled:cursor-not-allowed"
      />
      {isDirty && (
        <div
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
          style={{ backgroundColor: 'var(--status-warning)' }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export function RoleSelect({ value, onChange, options, label = 'Role' }) {
  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      options={options.map((r) => ({ value: r.key, label: r.name }))}
    />
  );
}

export function ScopeMultiSelect({ label, values, onChange, options, hint }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Field label={label} hint={hint}>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <div
              key={v}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] text-[12px]"
            >
              {v}
              <button
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            + Add
          </button>
        </div>
        {open && (
          <div className="space-y-1 p-2 border border-[var(--border-hairline)] rounded-[var(--radius-md)] bg-[var(--surface-sunken)]">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-7 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[12px]"
            />
            {filtered.length === 0 ? (
              <div className="text-[12px] text-[var(--text-muted)] p-2">No options</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o}
                  onClick={() => {
                    if (!values.includes(o)) {
                      onChange([...values, o]);
                    }
                    setOpen(false);
                  }}
                  className={cx(
                    'block w-full text-left px-2 py-1 text-[12px] rounded-[var(--radius-sm)]',
                    values.includes(o)
                      ? 'bg-[var(--series-1)] text-white'
                      : 'hover:bg-[var(--surface-card)]'
                  )}
                >
                  {o}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </Field>
  );
}

export function ScopePreview({ regions, categories, total, matched, loading }) {
  return (
    <div aria-live="polite" className="text-[12px] text-[var(--text-secondary)]">
      {loading ? (
        <span className="flex items-center gap-1.5">
          <Spinner size={10} /> Loading...
        </span>
      ) : (
        <span>
          Will see {matched.toLocaleString()} of {total.toLocaleString()} order lines.
        </span>
      )}
    </div>
  );
}

export function JsonDiff({ before, after }) {
  const [expanded, setExpanded] = useState({});

  const unchanged = new Set();
  const changed = new Set();

  if (after) {
    Object.keys(after).forEach((k) => {
      if (JSON.stringify(before?.[k]) === JSON.stringify(after[k])) {
        unchanged.add(k);
      } else {
        changed.add(k);
      }
    });
    if (before) {
      Object.keys(before).forEach((k) => {
        if (!(k in (after || {}))) changed.add(k);
      });
    }
  } else if (before) {
    Object.keys(before).forEach((k) => changed.add(k));
  }

  const allKeys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).sort();

  return (
    <div className="space-y-2 text-[12px]">
      {allKeys.filter((k) => changed.has(k)).map((k) => (
        <div key={k} className="flex gap-2 p-2 bg-[var(--surface-sunken)] rounded-[var(--radius-sm)]">
          <div className="font-medium text-[var(--status-warning)]">{k}</div>
          <div className="flex-1" />
          <code className="text-[var(--text-muted)]">
            {JSON.stringify(before?.[k])} → {JSON.stringify(after?.[k])}
          </code>
        </div>
      ))}
      {unchanged.size > 0 && (
        <button
          onClick={() => setExpanded((e) => ({ ...e, show: !e.show }))}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {expanded.show ? '▼' : '▶'} Show {unchanged.size} unchanged field{unchanged.size === 1 ? '' : 's'}
        </button>
      )}
      {expanded.show && allKeys.filter((k) => unchanged.has(k)).map((k) => (
        <div key={k} className="text-[var(--text-muted)] p-2">
          <span className="font-medium">{k}</span>: <code>{JSON.stringify(after?.[k])}</code>
        </div>
      ))}
    </div>
  );
}

export function ActionPill({ action }) {
  const severity = {
    CREATE: 'good',
    UPDATE: 'warning',
    DELETE: 'critical',
    READ: 'good',
  }[action] || 'warning';

  const colors = {
    good: { bg: 'var(--status-good)', text: '#fff' },
    warning: { bg: 'var(--status-warning)', text: '#000' },
    critical: { bg: 'var(--status-critical)', text: '#fff' },
  };

  const color = colors[severity];

  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[11px] font-semibold"
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {action}
    </span>
  );
}

export function SettingsCard({ title, description, children }) {
  return (
    <Card className="p-6">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h2>
        {description && (
          <p className="text-[12px] text-[var(--text-muted)] mt-1">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export function ThresholdPreview({ value, total, loading }) {
  return (
    <div aria-live="polite" className="text-[12px] text-[var(--text-secondary)] mt-1">
      {loading ? (
        <span className="flex items-center gap-1.5">
          <Spinner size={10} /> Calculating...
        </span>
      ) : (
        <span>
          At {(value * 100).toFixed(0)}%, {total.toLocaleString()} lines would be flagged.
        </span>
      )}
    </div>
  );
}
