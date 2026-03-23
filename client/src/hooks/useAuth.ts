import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// This runs on the /auth/callback page
// Server redirects here with ?token=<jwt>
export function useAuthCallback() {
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      localStorage.setItem('jwt', token);
      navigate('/dashboard');
    } else {
      navigate('/login');
    }
  }, []);
}