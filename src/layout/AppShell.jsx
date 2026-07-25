import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { scopeLabel } from '../lib/perms.js';

const NAV = [
  { to: '/app/dashboard', label: 'Dashboard', module: 'insights' },
  { to: '/app/insights', label: 'Insights', module: 'insights' },
  { to: '/app/orders', label: 'Orders', module: 'orders' },
  { to: '/app/products', label: 'Products', module: 'products' },
  { to: '/app/customers', label: 'Customers', module: 'customers' },
];

const ADMIN_NAV = [
  { to: '/app/admin/roles', label: 'Roles', module: 'roles' },
  { to: '/app/admin/users', label: 'Users', module: 'users' },
  { to: '/app/admin/audit', label: 'Audit', module: 'audit' },
];

export default function AppShell() {
  const { session, loading, perms, profile } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  if (loading) return <ShellSkeleton />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // The nav renders only after the permission set has arrived, so nothing
  // flashes and vanishes. Items are absent, never disabled.
  const main = NAV.filter((i) => perms.can(i.module, 'read'));
  const admin = ADMIN_NAV.filter((i) => perms.can(i.module, 'read'));

  return (
    <div className="min-h-screen flex flex-col bg-[var(--surface-page)]">
      <a href="#main" className="skip-link">Skip to content</a>
      <Topbar profile={profile} onMenu={() => setDrawerOpen((v) => !v)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar main={main} admin={admin} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <main id="main" className="flex-1 min-w-0 px-6 py-6 max-sm:px-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Topbar({ profile, onMenu }) {
  return (
    <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-4 bg-[var(--surface-card)] border-b border-[var(--border-hairline)]">
      <button
        onClick={onMenu}
        aria-label="Toggle navigation"
        className="lg:hidden text-[var(--text-secondary)] px-2 text-[18px]"
      >
        ☰
      </button>
      <span className="font-semibold text-[14px] text-[var(--text-primary)] tracking-[-0.01em]">
        Superstore ERP
      </span>
      <div className="flex-1" />
      <ScopeChip profile={profile} />
      <ThemeToggle />
      <UserMenu profile={profile} />
    </header>
  );
}

/**
 * Always present, including "All regions" for unscoped users. A chip that
 * appears only sometimes is one nobody learns to look for — and it is what
 * stops a scoped total reading as a bug.
 */
function ScopeChip({ profile }) {
  const regions = scopeLabel(profile?.scope_regions, 'All regions');
  const categories = profile?.scope_categories?.length ? ` · ${profile.scope_categories.join(', ')}` : '';
  return (
    <span
      title="You only see records inside your assigned scope. Totals on every page are scoped to it."
      className="text-[11px] px-2.5 py-1 rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] text-[var(--text-secondary)] whitespace-nowrap max-sm:hidden"
    >
      {regions}{categories}
    </span>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useAuth();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      className="w-8 h-8 grid place-items-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀'}</span>
    </button>
  );
}

function UserMenu({ profile }) {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const initials = (profile?.full_name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 h-8 pl-1 pr-2 rounded-[var(--radius-md)] hover:bg-[var(--surface-sunken)]"
      >
        <span className="w-6 h-6 grid place-items-center rounded-full bg-[var(--series-1)] text-white text-[10px] font-semibold">
          {initials}
        </span>
        <span className="text-[12px] text-[var(--text-primary)] max-sm:hidden">{profile?.full_name}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 w-56 p-1 rounded-[var(--radius-lg)] bg-[var(--surface-card)] border border-[var(--border-hairline)] shadow-lg">
          <div className="px-3 py-2 border-b border-[var(--border-hairline)]">
            <p className="text-[13px] font-medium text-[var(--text-primary)]">{profile?.full_name}</p>
            <p className="text-[11px] text-[var(--text-muted)]">{profile?.role_name}</p>
          </div>
          <NavLink role="menuitem" to="/app/settings" className="block px-3 py-2 text-[13px] text-[var(--text-primary)] rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]">
            Settings
          </NavLink>
          <button role="menuitem" onClick={signOut} className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-primary)] rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)]">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ main, admin, open, onClose }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <nav
        aria-label="Main"
        className={[
          'w-60 shrink-0 border-r border-[var(--border-hairline)] bg-[var(--surface-card)] px-3 py-4 flex flex-col gap-1',
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:top-14 max-lg:z-30 max-lg:transition-transform',
          open ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        ].join(' ')}
      >
        {main.map((item) => <NavItem key={item.to} {...item} />)}

        {admin.length > 0 && (
          <>
            <p className="px-3 pt-5 pb-1 text-[10px] font-semibold tracking-[0.08em] text-[var(--text-muted)]">ADMIN</p>
            {admin.map((item) => <NavItem key={item.to} {...item} />)}
          </>
        )}

        <div className="flex-1" />
        <NavItem to="/app/settings" label="Settings" />
      </nav>
    </>
  );
}

function NavItem({ to, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => [
        'px-3 py-2 rounded-[var(--radius-md)] text-[13px]',
        isActive
          ? 'bg-[var(--surface-sunken)] text-[var(--text-primary)] font-medium'
          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]',
      ].join(' ')}
      end={to === '/app/settings'}
    >
      {({ isActive }) => <span aria-current={isActive ? 'page' : undefined}>{label}</span>}
    </NavLink>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <div className="h-14 border-b border-[var(--border-hairline)] bg-[var(--surface-card)]" />
      <div className="flex">
        <div className="w-60 h-[calc(100vh-56px)] border-r border-[var(--border-hairline)] bg-[var(--surface-card)]" />
        <div className="flex-1 p-6" />
      </div>
    </div>
  );
}
