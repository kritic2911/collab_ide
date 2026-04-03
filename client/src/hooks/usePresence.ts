import { useEffect, useRef, useCallback } from 'react';
import { create } from 'zustand';
import { onServerMessage, useWsStore, Peer } from './useWebSocket';
import { getUser } from './useAuth';

// ─── Presence store ───
interface PresenceStore {
  /** Current room ID (set after server confirms join) */
  currentRoomId: string | null;
  /** Peers in the current room (including self) */
  peers: Peer[];
  setRoom: (roomId: string, peers: Peer[]) => void;
  addPeer: (roomId: string, peer: Peer) => void;
  removePeer: (roomId: string, username: string) => void;
  clear: () => void;
}

export const usePresenceStore = create<PresenceStore>((set, get) => ({
  currentRoomId: null,
  peers: [],
  setRoom: (roomId, peers) => set({ currentRoomId: roomId, peers }),
  addPeer: (roomId, peer) => {
    const state = get();
    if (state.currentRoomId !== roomId) return;
    // Avoid duplicates
    if (state.peers.some((p) => p.username === peer.username)) return;
    set({ peers: [...state.peers, peer] });
  },
  removePeer: (roomId, username) => {
    const state = get();
    if (state.currentRoomId !== roomId) return;
    set({ peers: state.peers.filter((p) => p.username !== username) });
  },
  clear: () => set({ currentRoomId: null, peers: [] }),
}));

/**
 * Hook that joins/leaves WebSocket rooms as the active file changes.
 * Keeps the presence store in sync with server events.
 *
 * @param repoId   - numeric repo ID (from URL params)
 * @param branch   - current branch name
 * @param filePath - currently selected file path (null if none)
 */
export function usePresence(
  repoId: number | null,
  branch: string | null,
  filePath: string | null,
) {
  const ws = useWsStore((s) => s.ws);
  const status = useWsStore((s) => s.status);
  const { setRoom, addPeer, removePeer, clear } = usePresenceStore();
  const lastRoomRef = useRef<string | null>(null);

  // Join / leave rooms when the active file changes
  useEffect(() => {
    if (status !== 'open' || !ws) return;

    // Leave previous room
    if (lastRoomRef.current) {
      ws.send(JSON.stringify({ type: 'leave_room', roomId: lastRoomRef.current }));
      lastRoomRef.current = null;
      clear();
    }

    // Join new room if there's an active file
    if (repoId && branch && filePath) {
      ws.send(
        JSON.stringify({
          type: 'join_room',
          repoId: String(repoId),
          branch,
          filePath: filePath.replace(/\\/g, '/').replace(/^\//, ''),
        }),
      );
    }

    return () => {
      // Leave room on unmount
      if (lastRoomRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave_room', roomId: lastRoomRef.current }));
        lastRoomRef.current = null;
        clear();
      }
    };
  }, [ws, status, repoId, branch, filePath, clear]);

  // Subscribe to server messages to update presence
  useEffect(() => {
    const unsub = onServerMessage((msg) => {
      switch (msg.type) {
        case 'room_joined': {
          lastRoomRef.current = msg.roomId;
          setRoom(msg.roomId, msg.peers);
          break;
        }
        case 'peer_joined': {
          addPeer(msg.roomId, { username: msg.username, avatarUrl: msg.avatarUrl });
          break;
        }
        case 'peer_left': {
          removePeer(msg.roomId, msg.username);
          break;
        }
      }
    });
    return unsub;
  }, [setRoom, addPeer, removePeer]);
}
