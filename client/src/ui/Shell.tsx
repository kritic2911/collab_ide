import { Link, useLocation } from 'react-router-dom';
import { colors, font, buttonBase } from './styles';
import { getUser, logout } from '../hooks/useAuth';

export default function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const user = getUser();
  const location = useLocation();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(135deg, ${colors.bg0} 0%, ${colors.bg1} 50%, ${colors.bg0} 100%)`,
        color: colors.text,
        fontFamily: font.family,
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(13, 17, 23, 0.75)',
          borderBottom: `1px solid ${colors.border}`,
          backdropFilter: 'blur(14px)',
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontWeight: 800, letterSpacing: '-0.02em' }}>Collaborative IDE</div>
            <div style={{ color: colors.muted, fontSize: 13 }}>{title}</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link
              to="/dashboard"
              style={{
                color: location.pathname.startsWith('/dashboard') ? colors.text : colors.muted,
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              Dashboard
            </Link>
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                style={{
                  color: location.pathname.startsWith('/admin') ? colors.text : colors.muted,
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Admin
              </Link>
            )}
            <button
              onClick={() => logout()}
              style={{
                ...buttonBase,
                padding: '8px 10px',
                fontSize: 13,
              }}
            >
              Logout{user?.username ? ` (${user.username})` : ''}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '18px 16px' }}>{children}</div>
    </div>
  );
}

