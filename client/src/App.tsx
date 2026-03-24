import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.js';
import AuthCallback from './pages/AuthCallback.js';
import InvalidCode from './pages/InvalidCode.js';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/invalid-code" element={<InvalidCode />} />
      {/* Dashboard and IDE routes will be added by Person B/C */}
      <Route path="/dashboard" element={<div>Dashboard (coming soon)</div>} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
