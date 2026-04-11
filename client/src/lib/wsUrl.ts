/** Same host as REST API; path `/ws`. */
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL || 'http://localhost:3000';
}

export function getWsBaseUrl(): string {
  const u = new URL(getApiBaseUrl());
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws';
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}
