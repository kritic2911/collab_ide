import { useCallback, useEffect, useRef, useState } from 'react';
import { getWsBaseUrl } from '../lib/wsUrl';
import { getToken } from './useAuth';

export interface UseWebSocketOptions {
  enabled: boolean;
  onMessage?: (msg: Record<string, unknown>) => void;
}

/**
 * Native WebSocket to the CollabIDE server with JWT in the query string.
 * Auto-reconnect with backoff when disconnected unexpectedly.
 */
export function useWebSocket({ enabled, onMessage }: UseWebSocketOptions) {
  const [ready, setReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const send = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }

    const token = getToken();
    if (!token) {
      setReady(false);
      return;
    }

    let closedByCleanup = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (closedByCleanup) return;
      const url = `${getWsBaseUrl()}?token=${encodeURIComponent(token)}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setReady(true);
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as Record<string, unknown>;
          onMessageRef.current?.(data);
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        /* onclose will handle reconnect */
      };

      ws.onclose = () => {
        setReady(false);
        wsRef.current = null;
        if (closedByCleanup) return;
        const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
        attempt += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      wsRef.current = null;
      setReady(false);
    };
  }, [enabled]);

  return { ready, send };
}
