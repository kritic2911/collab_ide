const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0d1117 0%, #161b22 50%, #0d1117 100%)',
    fontFamily: "'Inter', sans-serif",
    color: '#e6edf3',
    padding: '20px',
  },
  card: {
    background: 'rgba(22, 27, 34, 0.8)',
    border: '1px solid rgba(240, 246, 252, 0.1)',
    borderRadius: '16px',
    padding: '48px 40px',
    textAlign: 'center' as const,
    backdropFilter: 'blur(20px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    maxWidth: '480px',
    width: '90%',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '12px',
    color: '#f0883e',
  },
  message: {
    color: '#8b949e',
    fontSize: '15px',
    lineHeight: '1.6',
    marginBottom: '32px',
  },
  link: {
    color: '#58a6ff',
    textDecoration: 'none',
    fontSize: '14px',
    fontWeight: 500,
  },
};

export default function InvalidCode() {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.icon}>🔑</div>
        <h1 style={styles.title}>Invalid Organization Code</h1>
        <p style={styles.message}>
          The organization code you entered is incorrect.
          <br /><br />
          Please check with your team admin for the correct code and try again.
        </p>
        <a href="/login" style={styles.link}>
          ← Back to Login
        </a>
      </div>
    </div>
  );
}
