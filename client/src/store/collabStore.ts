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
    set((state) => {
      const next = new Map<string, PeerState>();
      for (const p of list) {
        const prev = state.peers.get(p.username);
        next.set(p.username, {
          username: p.username,
          avatarUrl: p.avatarUrl,
          patches: prev?.patches ?? [],
          seq: prev?.seq ?? 0,
        });
      }
      return { peers: next };
    }),

  peerJoined: (p) =>
    set((state) => {
      const next = new Map(state.peers);
      const prev = next.get(p.username);
      next.set(p.username, {
        username: p.username,
        avatarUrl: p.avatarUrl,
        patches: prev?.patches ?? [],
        seq: prev?.seq ?? 0,
      });
      return { peers: next };
    }),

  peerLeft: (username) =>
    set((state) => {
      const next = new Map(state.peers);
      next.delete(username);
      const selected = state.selectedPeerUsername === username ? null : state.selectedPeerUsername;
      return { peers: next, selectedPeerUsername: selected };
    }),

  peerDiff: (username, patches, seq) =>
    set((state) => {
      const next = new Map(state.peers);
      const prev = next.get(username);
      if (prev) {
        next.set(username, { ...prev, patches: [...prev.patches, ...patches], seq });
      } else {
        next.set(username, { username, avatarUrl: null, patches, seq });
      }
      return { peers: next };
    }),

  setSelectedPeerUsername: (selectedPeerUsername) => set({ selectedPeerUsername }),

  clear: () =>
    set({
      roomId: null,
      peers: new Map(),
      selectedPeerUsername: null,
    }),
}));
