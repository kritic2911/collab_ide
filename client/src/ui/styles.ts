export const colors = {
  bg0: '#0d1117',
  bg1: '#161b22',
  bg2: '#1f242c',
  border: 'rgba(240, 246, 252, 0.12)',
  text: '#e6edf3',
  muted: '#8b949e',
  danger: '#f85149',
  success: '#3fb950',
  brandA: '#58a6ff',
  brandB: '#2ea043',
};

export const font = {
  family: "'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
};

export const cardStyle: React.CSSProperties = {
  background: 'rgba(22, 27, 34, 0.8)',
  border: `1px solid ${colors.border}`,
  borderRadius: 14,
  padding: 16,
  backdropFilter: 'blur(14px)',
};

export const buttonBase: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  background: colors.bg2,
  color: colors.text,
  borderRadius: 10,
  padding: '10px 12px',
  cursor: 'pointer',
  fontWeight: 600,
};

export const buttonPrimary: React.CSSProperties = {
  ...buttonBase,
  border: 'none',
  background: `linear-gradient(135deg, ${colors.brandA}, ${colors.brandB})`,
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: `1px solid ${colors.border}`,
  background: 'rgba(13, 17, 23, 0.8)',
  color: colors.text,
  outline: 'none',
  boxSizing: 'border-box',
};

