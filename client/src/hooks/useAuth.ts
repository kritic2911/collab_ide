import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

const TOKEN_KEY = 'collabide_jwt';

export interface JwtPayload {
  userId: number;
  username: string;
  role: 'admin' | 'user';
  color: string;
  avatarUrl: string;
}

/**
 * Hook to handle OAuth callback — captures token from URL and stores it.
 * Use on the /auth/callback page.
 */
export function useAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
      // Remove token from URL
      window.history.replaceState({}, '', '/auth/callback');
      navigate('/dashboard', { replace: true });
    } else {
      navigate('/login', { replace: true });
    }
  }, [navigate, searchParams]);
}

/** Get the stored JWT token */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Check if user is logged in */
export function isLoggedIn(): boolean {
  return getToken() !== null;
}

/**
 * Decode JWT payload (client-side only, no verification).
 * Returns null if no token or decoding fails.
 */
export function getUser(): JwtPayload | null {
  const token = getToken();
  if (!token) return null;

  try {
    const base64Payload = token.split('.')[1]
      .replace(/-/g, '+')   // add this
      .replace(/_/g, '/');  // add this
    const payload = JSON.parse(atob(base64Payload));
    return {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
      color: payload.color,
      avatarUrl: payload.avatarUrl,
    };
  } catch {
    return null;
  }
}
/**
 * Logout — remove token from localStorage, call server logout, redirect to login.
 */
export async function logout(): Promise<void> {
  const token = getToken();

  localStorage.removeItem(TOKEN_KEY);

  if (token) {
    try {
      const apiUrl = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000';
      await fetch(`${apiUrl}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Server might be down — that's fine, token is already removed
    }
  }

  window.location.href = '/login';
}