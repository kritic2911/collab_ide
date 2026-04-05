import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import { getToken } from './useAuth';

// ─── Connection state store (shared across components) ───
interface WsStore {
  ws: WebSocket | null;
  status: 'connecting' | 'open' | 'closed';
  setWs: (ws: WebSocket | null) => void;
  setStatus: (status: 'connecting' | 'open' | 'closed') => void;
}

export const useWsStore = create<WsStore>((set) => ({
  ws: null,
  status: 'closed',
  setWs: (ws) => set({ ws }),
  setStatus: (status) => set({ status }),
}));

// ─── Message types (mirror server) ───
export type Peer = { username: string; avatarUrl: string | null };

export type ServerMessage =
  | { type: 'room_joined'; roomId: string; peers: Peer[] }
  | { type: 'peer_joined'; roomId: string; username: string; avatarUrl: string | null }
  | { type: 'peer_left'; roomId: string; username: string }
  | { type: 'peer_diff'; roomId: string; username: string; patches: any[]; seq: number }
  | { type: 'remote_push'; roomId: string; pushedBy: string; branch: string; changedFiles: string[]; commitSha: string }
  | { type: 'doc_requested'; roomId: string; requestedBy: string }
  | { type: 'peer_doc_content'; roomId: string; username: string; content: string }
  | { type: 'error'; message: string };

type MessageHandler = (msg: ServerMessage) => void;

// Global handler registry — listeners subscribe here
const handlers = new Set<MessageHandler>();

export function onServerMessage(handler: MessageHandler): () => void {
  handlers.add(handler);
  return () => { handlers.delete(handler); };
}

/**
 * Hook to establish and maintain a WebSocket connection.
 * Should be called once at a high-level component (e.g. RepoBrowser).
 */
export function useWebSocket() {
  const { setWs, setStatus } = useWsStore();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const token = getToken();
    if (!token) return;

    const apiUrl = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';
    const wsUrl = apiUrl.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(token)}`;

    setStatus('connecting');
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      setWs(socket);
      setStatus('open');
      retryRef.current = 0;
    };

    socket.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as ServerMessage;
        for (const handler of handlers) {
          handler(msg);
        }
      } catch {
        // ignore malformed messages
      }
    };

    socket.onclose = () => {
      setWs(null);
      setStatus('closed');
      wsRef.current = null;

      // Reconnect with exponential backoff (max 30s)
      const delay = Math.min(1000 * 2 ** retryRef.current, 30000);
      retryRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };

    socket.onerror = () => {
      // onclose will fire after onerror
    };
  }, [setWs, setStatus]);

  useEffect(() => {
    connect();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
      setWs(null);
      setStatus('closed');
    };
  }, [connect, setWs, setStatus]);

  const send = useCallback((data: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
