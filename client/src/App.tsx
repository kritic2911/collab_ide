import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';
import InvalidCode from './pages/InvalidCode';
import Dashboard from './pages/Dashboard';
import RepoBrowser from './pages/RepoBrowser';
import AdminDashboard from './pages/AdminDashboard';
import IDE from './pages/IDE';
import { getUser, isLoggedIn } from './hooks/useAuth';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/invalid-code" element={<InvalidCode />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/browse/:repoId"
        element={
          <RequireAuth>
            <RepoBrowser />
          </RequireAuth>
        }
      />
      <Route
        path="/ide/:repoId"
        element={
          <RequireAuth>
            <IDE />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminDashboard />
          </RequireAdmin>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
