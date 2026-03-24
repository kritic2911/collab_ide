import { useAuthCallback } from '../hooks/useAuth.js';

export default function AuthCallback() {
  useAuthCallback();

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0d1117',
        color: '#8b949e',
        fontFamily: "'Inter', sans-serif",
        fontSize: '16px',
      }}
    >
      Authenticating...
    </div>
  );
}
