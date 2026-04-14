import { useEffect, useRef, useState, useCallback } from 'react';
import { useCollabStore } from '../store/collabStore';
import { useChatStore } from '../store/chatStore';
import { getToken } from './useAuth';
import { getWsBaseUrl } from '../lib/wsUrl';

interface CollabSocketResult {
  sendMessage: (msg: any) => void;
  isConnected: boolean;
}

export function useCollabSocket(
  enabled: boolean,
  onRoomJoined?: (roomId: string) => void,
  onPeerContent?: (username: string, content: string) => void,
  onHydrateState?: (base: string | null, diffs: { userId: number; patch: any }[]) => void,
): CollabSocketResult {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimeout = useRef<number>();
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Store latest callbacks in refs so the socket handler always sees the current one
  const onPeerContentRef = useRef(onPeerContent);
  onPeerContentRef.current = onPeerContent;
  const onRoomJoinedRef = useRef(onRoomJoined);
  onRoomJoinedRef.current = onRoomJoined;
  const onHydrateRef = useRef(onHydrateState);
  onHydrateRef.current = onHydrateState;

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
        
        switch (msg.type) {
          case 'room_joined':
            setPeers(msg.peers || []);
            if (onRoomJoinedRef.current && msg.roomId) {
              onRoomJoinedRef.current(msg.roomId);
            }
            break;
          case 'hydrate_state':
            // Redis state layer sends base content + active peer diffs
            // on room join as a single atomic payload
            if (onHydrateRef.current) {
              onHydrateRef.current(msg.base ?? null, msg.diffs ?? []);
            }
            break;
          case 'peer_joined':
            if (msg.username) peerJoined({
              username: msg.username,
              avatarUrl: msg.avatarUrl || null,
            });
            break;
          case 'peer_left':
            if (msg.username) peerLeft(msg.username);
            break;
          case 'peer_diff':
            if (msg.username && msg.patches) {
              peerDiff(msg.username, msg.patches, msg.seq ?? Date.now());
            }
            // If the peer_diff includes full content, fire the content callback
            if (msg.username && msg.content !== undefined) {
              onPeerContentRef.current?.(msg.username, msg.content);
            }
            break;
          case 'peer_content':
            if (msg.username && msg.content !== undefined) {
              onPeerContentRef.current?.(msg.username, msg.content);
            }
            break;
          case 'remote_push':
            window.dispatchEvent(new CustomEvent('collab:remote_push', { detail: msg }));
            break;
          case 'error':
            console.error('Collab socket error from server:', msg.message);
            break;
          case 'chat_history':
            useChatStore.getState().setHistory(msg.messages || []);
            break;
          case 'chat_broadcast':
            useChatStore.getState().addMessage({
              id: msg.messageId,
              userId: msg.userId,
              username: msg.username,
              avatarUrl: msg.avatarUrl,
              text: msg.text,
              timestamp: msg.timestamp,
            });
            break;
          case 'chat_older_history':
            useChatStore.getState().prependMessages(msg.messages || [], msg.hasMore ?? false);
            break;
          case 'chat_deleted':
            useChatStore.getState().removeMessage(msg.messageId);
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
    };

    ws.current = socket;
  }, [enabled, setPeers, peerJoined, peerLeft, peerDiff]);

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
