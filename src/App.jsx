import { lazy, Suspense, Component } from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  Navigate,
  useRouteError,
} from 'react-router-dom';
import { AuthProvider } from './lib/auth.jsx';
import AppShell from './layout/AppShell.jsx';
import RouteGuard from './layout/RouteGuard.jsx';

// Landing and the auth pages are the cold-start path, so they stay in the main
// chunk. Everything behind /app is lazy — otherwise a visitor who never signs
// in still downloads d3 and chart.js.
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';

const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Insights = lazy(() => import('./pages/Insights.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const Products = lazy(() => import('./pages/Products.jsx'));
const Customers = lazy(() => import('./pages/Customers.jsx'));
const Roles = lazy(() => import('./pages/admin/Roles.jsx'));
const Users = lazy(() => import('./pages/admin/Users.jsx'));
const Audit = lazy(() => import('./pages/admin/Audit.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

/** Auth wraps every route, so it lives on a pathless root route. */
function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

/** Catches any render-time throw the data router surfaces (from any route,
 *  not just a lazy-chunk failure — ChunkErrorBoundary only ever handles that
 *  one case and rethrows everything else). Without this, one bad page crashes
 *  the whole app to react-router's raw "Unexpected Application Error!" — see
 *  debug/full-review/pages.md and debug/full-review/charts.md for two bugs
 *  this would otherwise have taken the whole SPA down for. */
function RootError() {
  const error = useRouteError();
  console.error(error);
  return (
    <div className="flex h-screen items-center justify-center px-6 text-center">
      <div>
        <h1 className="text-[20px] font-semibold mb-2">Something went wrong</h1>
        <p className="text-[13px] text-[var(--text-secondary)] mb-4">
          Try reloading the page. If it keeps happening, contact an administrator.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="h-9 px-4 rounded-[var(--radius-md)] bg-[var(--series-1)] text-white text-[13px] font-medium"
        >
          Reload
        </button>
      </div>
    </div>
  );
}

const CHUNK_ERROR = /Failed to fetch dynamically imported module|Importing a module script failed/i;
const RELOAD_FLAG = 'chunk-reload-attempted';

/** Stale tab after a new deploy tries to import a chunk hash that no longer
 *  exists on the CDN. One reload picks up the fresh index.html/manifest;
 *  the sessionStorage flag stops a reload loop if the deploy is broken. */
class ChunkErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError(error) {
    if (CHUNK_ERROR.test(error?.message ?? '')) return { failed: true };
    throw error;
  }

  componentDidCatch() {
    if (!sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    }
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Chunk load is fast and the shell is already painted, so this stays blank
 *  rather than flashing a spinner that outlives itself. */
function Lazy({ children }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={null}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}

/**
 * A DATA router, not <BrowserRouter>. The permission matrix guards navigation
 * away from unsaved changes with `useBlocker`, and useBlocker only exists under
 * a data router — under a plain BrowserRouter it throws at render time and,
 * with no error boundary above it, takes the whole app down with it.
 */
export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Root />} errorElement={<RootError />}>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />

      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<RouteGuard module="insights"><Lazy><Dashboard /></Lazy></RouteGuard>} />
        <Route path="insights" element={<RouteGuard module="insights"><Lazy><Insights /></Lazy></RouteGuard>} />
        <Route path="orders" element={<RouteGuard module="orders"><Lazy><Orders /></Lazy></RouteGuard>} />
        <Route path="products" element={<RouteGuard module="products"><Lazy><Products /></Lazy></RouteGuard>} />
        <Route path="customers" element={<RouteGuard module="customers"><Lazy><Customers /></Lazy></RouteGuard>} />
        <Route path="admin/roles" element={<RouteGuard module="roles"><Lazy><Roles /></Lazy></RouteGuard>} />
        <Route path="admin/users" element={<RouteGuard module="users"><Lazy><Users /></Lazy></RouteGuard>} />
        <Route path="admin/audit" element={<RouteGuard module="audit"><Lazy><Audit /></Lazy></RouteGuard>} />
        <Route path="settings" element={<RouteGuard module="settings"><Lazy><Settings /></Lazy></RouteGuard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  )
);
