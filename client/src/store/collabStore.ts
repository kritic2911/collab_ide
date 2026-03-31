import { create } from 'zustand';

export type DiffPatch = {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  text: string
  rangeLength: number
}

export interface PeerState {
  username: string;
  avatarUrl: string | null;
  patches: DiffPatch[];
  seq: number;
}

// ──────────────────────────────────────────────
// Deterministic color from username (shared utility)
// ──────────────────────────────────────────────
export function colorFromUsername(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  const r = hash & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = (hash >> 16) & 0xff;
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ──────────────────────────────────────────────

interface CollabStore {
  roomId: string | null;
  peers: Map<string, PeerState>;
  selectedPeerUsername: string | null;

  setRoom: (roomId: string | null) => void;
  setPeers: (peers: { username: string; avatarUrl: string | null }[]) => void;
  peerJoined: (p: { username: string; avatarUrl: string | null }) => void;
  peerLeft: (username: string) => void;
  peerDiff: (username: string, patches: DiffPatch[], seq: number) => void;
  setSelectedPeerUsername: (username: string | null) => void;
  clear: () => void;
}

export const useCollabStore = create<CollabStore>((set) => ({
  roomId: null,
  peers: new Map(),
  selectedPeerUsername: null,

  setRoom: (roomId) => set({ roomId }),

  setPeers: (list) =>
    set(() => {
      const nextPeers = new Map<string, PeerState>();
      for (const p of list) {
        nextPeers.set(p.username, {
          username: p.username,
          avatarUrl: p.avatarUrl,
          patches: [],
          seq: 0,
        });
      }
      return { peers: nextPeers };
    }),

  peerJoined: (p) =>
    set((state) => {
      const nextPeers = new Map(state.peers);
      nextPeers.set(p.username, {
        username: p.username,
        avatarUrl: p.avatarUrl,
        patches: [],
        seq: 0,
      });
      return { peers: nextPeers };
    }),

  peerLeft: (username) =>
    set((state) => {
      const nextPeers = new Map(state.peers);
      nextPeers.delete(username);
      return { peers: nextPeers };
    }),

  peerDiff: (username, patches, seq) =>
    set((state) => {
      const nextPeers = new Map(state.peers);
      const prev = nextPeers.get(username);
      nextPeers.set(username, {
        username,
        avatarUrl: prev?.avatarUrl ?? null,
        patches,   // latest batch only, not accumulated
        seq,
      });
      return { peers: nextPeers };
    }),

  setSelectedPeerUsername: (selectedPeerUsername) => set({ selectedPeerUsername }),

  clear: () =>
    set({
      roomId: null,
      peers: new Map(),
      selectedPeerUsername: null,
    }),
}));
