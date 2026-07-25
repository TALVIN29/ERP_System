import { useAuth } from '../lib/auth.jsx';
import { DeniedCard } from '../components/ui.jsx';

const LABEL = {
  orders: 'Orders', products: 'Products', customers: 'Customers',
  insights: 'Insights', users: 'Users', roles: 'Roles',
  audit: 'Audit', settings: 'Settings',
};

/**
 * The nav already hides what a user cannot reach; this covers the direct-URL
 * case with a denial card rather than a redirect, so the URL stays honest.
 */
export default function RouteGuard({ module, children }) {
  const { perms, loading } = useAuth();
  if (loading) return null;
  if (!perms.can(module, 'read')) return <DeniedCard module={LABEL[module] || module} />;
  return children;
}
