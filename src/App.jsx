import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth.jsx';
import AppShell from './layout/AppShell.jsx';
import RouteGuard from './layout/RouteGuard.jsx';

import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Insights from './pages/Insights.jsx';
import Orders from './pages/Orders.jsx';
import Products from './pages/Products.jsx';
import Customers from './pages/Customers.jsx';
import Roles from './pages/admin/Roles.jsx';
import Users from './pages/admin/Users.jsx';
import Audit from './pages/admin/Audit.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        <Route path="/app" element={<AppShell />}>
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<RouteGuard module="insights"><Dashboard /></RouteGuard>} />
          <Route path="insights" element={<RouteGuard module="insights"><Insights /></RouteGuard>} />
          <Route path="orders" element={<RouteGuard module="orders"><Orders /></RouteGuard>} />
          <Route path="products" element={<RouteGuard module="products"><Products /></RouteGuard>} />
          <Route path="customers" element={<RouteGuard module="customers"><Customers /></RouteGuard>} />
          <Route path="admin/roles" element={<RouteGuard module="roles"><Roles /></RouteGuard>} />
          <Route path="admin/users" element={<RouteGuard module="users"><Users /></RouteGuard>} />
          <Route path="admin/audit" element={<RouteGuard module="audit"><Audit /></RouteGuard>} />
          <Route path="settings" element={<RouteGuard module="settings"><Settings /></RouteGuard>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
