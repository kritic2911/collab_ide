import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const DEFAULT_API_URL = 'http://localhost:3001';

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
    position: 'relative',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: '600px',
    height: '600px',
    background: 'radial-gradient(circle, rgba(88,166,255,0.08) 0%, transparent 70%)',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    zIndex: 1,
    background: 'rgba(22, 27, 34, 0.8)',
    border: '1px solid rgba(240, 246, 252, 0.1)',
    borderRadius: '16px',
    padding: '48px 40px',
    textAlign: 'center' as const,
    backdropFilter: 'blur(20px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    maxWidth: '420px',
    width: '90%',
  },
  logo: {
    fontSize: '40px',
    fontWeight: 700,
    marginBottom: '8px',
    background: 'linear-gradient(135deg, #58a6ff, #3fb950)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    color: '#8b949e',
    fontSize: '15px',
    marginBottom: '36px',
    lineHeight: '1.5',
  },
  inputGroup: {
    marginBottom: '20px',
    textAlign: 'left' as const,
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#8b949e',
    marginBottom: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    fontSize: '15px',
    color: '#e6edf3',
    background: 'rgba(13, 17, 23, 0.8)',
    border: '1px solid rgba(240, 246, 252, 0.15)',
    borderRadius: '10px',
    outline: 'none',
    fontFamily: "'Inter', sans-serif",
    transition: 'border-color 0.2s ease',
    boxSizing: 'border-box' as const,
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 32px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#ffffff',
    background: 'linear-gradient(135deg, #238636, #2ea043)',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontFamily: "'Inter', sans-serif",
    boxShadow: '0 4px 14px rgba(35, 134, 54, 0.4)',
    width: '100%',
    justifyContent: 'center',
  },
  buttonDisabled: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 32px',
    fontSize: '16px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.4)',
    background: 'rgba(35, 134, 54, 0.3)',
    border: 'none',
    borderRadius: '12px',
    cursor: 'not-allowed',
    fontFamily: "'Inter', sans-serif",
    width: '100%',
    justifyContent: 'center',
  },
  error: {
    background: 'rgba(248, 81, 73, 0.1)',
    border: '1px solid rgba(248, 81, 73, 0.4)',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '24px',
    color: '#f85149',
    fontSize: '14px',
  },
  success: {
    background: 'rgba(63, 185, 80, 0.1)',
    border: '1px solid rgba(63, 185, 80, 0.4)',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px',
    color: '#3fb950',
    fontSize: '14px',
  },
  githubIcon: {
    width: '24px',
    height: '24px',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '24px 0',
    color: '#484f58',
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(240, 246, 252, 0.1)',
  },
};

export default function Login() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  const apiUrl = useMemo(() => {
    // Prefer Vite env if present (keeps client/server in sync)
    // Fallback to localhost for new dev setups.
    return (import.meta as any).env?.VITE_API_URL || DEFAULT_API_URL;
  }, []);

  const [orgCode, setOrgCode] = useState('');
  const [codeVerified, setCodeVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState('');

  const handleVerifyCode = async () => {
    if (!orgCode.trim()) return;
    setVerifying(true);
    setCodeError('');
    try {
      const res = await fetch(`${apiUrl}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgCode: orgCode.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        setCodeVerified(true);
      } else {
        setCodeError('Invalid organization code. Please try again.');
      }
    } catch {
      setCodeError('Unable to verify code. Is the server running?');
    } finally {
      setVerifying(false);
    }
  };

  const handleLogin = () => {
    window.location.href = `${apiUrl}/auth/github?orgCode=${encodeURIComponent(orgCode.trim())}`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !codeVerified) {
      handleVerifyCode();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.glow} />
      <div style={styles.card}>
        <div style={styles.logo}>Collaborative IDE</div>
        <p style={styles.subtitle}>
          Real-time collaborative code editor.<br />
          Enter your organization code to get started.
        </p>

        {error === 'auth_failed' && (
          <div style={styles.error}>
            Authentication failed. Please try again.
          </div>
        )}

        {/* Organization code input */}
        <div style={styles.inputGroup}>
          <label style={styles.label} htmlFor="org-code-input">
            Organization Code
          </label>
          {/* Hidden dummy fields to prevent browser autofill */}
          <input type="text" name="prevent_autofill" id="prevent_autofill" style={{ display: 'none' }} tabIndex={-1} />
          <input type="password" name="prevent_autofill_pw" id="prevent_autofill_pw" style={{ display: 'none' }} tabIndex={-1} />
          <input
            id="org-code-input"
            type="text"
            autoComplete="off"
            data-lpignore="true"
            data-1p-ignore="true"
            placeholder="Enter your organization code"
            value={orgCode}
            onChange={(e) => {
              setOrgCode(e.target.value);
              if (codeVerified) setCodeVerified(false);
              setCodeError('');
            }}
            onKeyDown={handleKeyDown}
            style={{
              ...styles.input,
              WebkitTextSecurity: 'disc',
              borderColor: codeError
                ? 'rgba(248, 81, 73, 0.6)'
                : codeVerified
                  ? 'rgba(63, 185, 80, 0.6)'
                  : 'rgba(240, 246, 252, 0.15)',
            } as React.CSSProperties}
            disabled={verifying}
          />
        </div>

        {codeError && <div style={styles.error}>{codeError}</div>}
        {codeVerified && <div style={styles.success}>✓ Organization code verified!</div>}

        {!codeVerified ? (
          <button
            id="verify-code-button"
            style={orgCode.trim() && !verifying ? styles.button : styles.buttonDisabled}
            onClick={handleVerifyCode}
            disabled={!orgCode.trim() || verifying}
          >
            {verifying ? 'Verifying...' : 'Verify Code'}
          </button>
        ) : (
          <>
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span>continue with</span>
              <div style={styles.dividerLine} />
            </div>
            <button
              id="login-button"
              style={styles.button}
              onClick={handleLogin}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(35, 134, 54, 0.5)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(35, 134, 54, 0.4)';
              }}
            >
              <svg style={styles.githubIcon} viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Login with GitHub
            </button>
          </>
        )}
      </div>
    </div>
  );
}
