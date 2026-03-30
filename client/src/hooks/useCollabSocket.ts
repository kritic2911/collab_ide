import { useEffect, useRef, useState, useCallback } from 'react';
import { useCollabStore } from '../store/collabStore';
import { getToken } from './useAuth';
import { getWsBaseUrl } from '../lib/wsUrl';

interface CollabSocketResult {
  sendMessage: (msg: any) => void;
  isConnected: boolean;
}

export function useCollabSocket(
  enabled: boolean,
  onRoomJoined?: (roomId: string) => void
): CollabSocketResult {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeout = useRef<number>();
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Destructure store actions
  const { setPeers, peerJoined, peerLeft, peerDiff } = useCollabStore();

  const connect = useCallback(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return;
    if (ws.current?.readyState === WebSocket.OPEN) return;

    const url = `${getWsBaseUrl()}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    
    socket.onopen = () => {
      console.log('Connected to collaboration server');
      setIsConnected(true);
      reconnectAttempts.current = 0;
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Forward directly into Zustand store
        switch (msg.type) {
          case 'room_joined':
            setPeers(msg.peers || []);
            if (onRoomJoined && msg.roomId) {
              onRoomJoined(msg.roomId);
            }
            break;
          case 'peer_joined':
            if (msg.username) peerJoined({ username: msg.username, avatarUrl: msg.avatarUrl || null });
            break;
          case 'peer_left':
            if (msg.username) peerLeft(msg.username);
            break;
          case 'peer_diff':
            if (msg.username && msg.patches) {
              peerDiff(msg.username, msg.patches, Date.now());
            }
            break;
          case 'remote_push':
            // Trigger a global custom event so IDE.tsx or others can show the banner.
            // (Store could hold this, but a window event is clean for transient banners)
            window.dispatchEvent(new CustomEvent('collab:remote_push', { detail: msg }));
            break;
          case 'error':
            console.error('Collab socket error from server:', msg.message);
            break;
        }
      } catch (e) {
        console.error('Failed to parse collab websocket message', e);
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
      ws.current = null;
      
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const timeout = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        console.log(`WebSocket reconnecting in ${timeout}ms`);
        reconnectTimeout.current = window.setTimeout(connect, timeout);
        reconnectAttempts.current++;
      }
    };

    socket.onerror = (err) => {
      console.error('Collab WebSocket error:', err);
      // Let onclose handle the reconnect
    };

    ws.current = socket;
  }, [enabled, onRoomJoined, setPeers, peerJoined, peerLeft, peerDiff]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback((msg: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    } else {
      console.warn('Cannot send message, WebSocket is not open', msg);
    }
  }, []);

  return { sendMessage, isConnected };
}
