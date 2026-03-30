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

export type PeerDoc = {
  username: string;
  color: string;
  content: string;       // full reconstructed file text
  lastSeq: number;
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
// Client-side applyPatches — same logic as server
// ──────────────────────────────────────────────
function offsetFromRange(text: string, range: DiffPatch['range']): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < range.startLineNumber - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  offset += range.startColumn - 1;
  return Math.min(offset, text.length);
}

export function applyPatchesToString(text: string, patches: DiffPatch[]): string {
  const withOffsets = patches.map(p => ({
    ...p,
    startOffset: offsetFromRange(text, p.range),
    endOffset: offsetFromRange(text, {
      startLineNumber: p.range.endLineNumber,
      startColumn: p.range.endColumn,
      endLineNumber: p.range.endLineNumber, // unused by offsetFromRange
      endColumn: p.range.endColumn        // unused by offsetFromRange
    }),
  }));

  // Sort by startOffset descending so later patches don't shift earlier indices
  const sorted = withOffsets.sort((a, b) => b.startOffset - a.startOffset);

  let result = text;
  for (const p of sorted) {
    result = result.slice(0, p.startOffset) + p.text + result.slice(p.endOffset);
  }
  return result;
}

// ──────────────────────────────────────────────

interface CollabStore {
  roomId: string | null;
  peers: Map<string, PeerState>;
  peerDocuments: Map<string, PeerDoc>;
  selectedPeerUsername: string | null;

  setRoom: (roomId: string | null) => void;
  setPeers: (peers: { username: string; avatarUrl: string | null; currentContent: string; seq: number }[]) => void;
  peerJoined: (p: { username: string; avatarUrl: string | null; currentContent: string; seq: number }) => void;
  peerLeft: (username: string) => void;
  peerDiff: (username: string, patches: DiffPatch[], seq: number) => void;
  setSelectedPeerUsername: (username: string | null) => void;
  clear: () => void;
}

export const useCollabStore = create<CollabStore>((set) => ({
  roomId: null,
  peers: new Map(),
  peerDocuments: new Map(),
  selectedPeerUsername: null,

  setRoom: (roomId) => set({ roomId }),

  setPeers: (list) =>
    set((state) => {
      const nextPeers = new Map<string, PeerState>();
      const nextDocs = new Map<string, PeerDoc>();
      for (const p of list) {
        const prev = state.peers.get(p.username);
        nextPeers.set(p.username, {
          username: p.username,
          avatarUrl: p.avatarUrl,
          patches: prev?.patches ?? [],
          seq: prev?.seq ?? 0,
        });
        // Initialize shadow document from server-provided content
        nextDocs.set(p.username, {
          username: p.username,
          color: colorFromUsername(p.username),
          content: p.currentContent ?? '',
          lastSeq: p.seq ?? 0,
        });
      }
      return { peers: nextPeers, peerDocuments: nextDocs };
    }),

  peerJoined: (p) =>
    set((state) => {
      const nextPeers = new Map(state.peers);
      const prev = nextPeers.get(p.username);
      nextPeers.set(p.username, {
        username: p.username,
        avatarUrl: p.avatarUrl,
        patches: prev?.patches ?? [],
        seq: prev?.seq ?? 0,
      });

      const nextDocs = new Map(state.peerDocuments);
      nextDocs.set(p.username, {
        username: p.username,
        color: colorFromUsername(p.username),
        content: p.currentContent ?? '',
        lastSeq: p.seq ?? 0,
      });

      return { peers: nextPeers, peerDocuments: nextDocs };
    }),

  peerLeft: (username) =>
    set((state) => {
      const nextPeers = new Map(state.peers);
      nextPeers.delete(username);

      const nextDocs = new Map(state.peerDocuments);
      nextDocs.delete(username);

      const selected = state.selectedPeerUsername === username ? null : state.selectedPeerUsername;
      return { peers: nextPeers, peerDocuments: nextDocs, selectedPeerUsername: selected };
    }),

  peerDiff: (username, patches, seq) =>
    set((state) => {
      // Update PeerState (for gutter highlights)
      const nextPeers = new Map(state.peers);
      const prev = nextPeers.get(username);
      if (prev) {
        nextPeers.set(username, { ...prev, patches: [...prev.patches, ...patches], seq });
      } else {
        nextPeers.set(username, { username, avatarUrl: null, patches, seq });
      }

      // Apply patches to shadow document
      const nextDocs = new Map(state.peerDocuments);
      const doc = nextDocs.get(username);
      if (doc) {
        const updatedContent = applyPatchesToString(doc.content, patches);
        nextDocs.set(username, { ...doc, content: updatedContent, lastSeq: seq });
      }

      return { peers: nextPeers, peerDocuments: nextDocs };
    }),

  setSelectedPeerUsername: (selectedPeerUsername) => set({ selectedPeerUsername }),

  clear: () =>
    set({
      roomId: null,
      peers: new Map(),
      peerDocuments: new Map(),
      selectedPeerUsername: null,
    }),
}));
