import type { AuthenticatedSocket, ServerMessage } from './ws.types.js';

// ──────────────────────────────────────────────
// Per-connection document state
// ──────────────────────────────────────────────
export type PeerDocState = {
  content: string;
  seq: number;
};

// ──────────────────────────────────────────────
// Room data structure — Map<roomId, Map<AuthenticatedSocket, PeerDocState>>
// ──────────────────────────────────────────────
const rooms = new Map<string, Map<AuthenticatedSocket, PeerDocState>>();

// ──────────────────────────────────────────────
// getRoomId — deterministic room key
// Rule: filePath must be normalized (no leading slash, forward slashes only)
// ──────────────────────────────────────────────
export function getRoomId(repoId: string, branch: string, filePath: string): string {
  return `${repoId}:${branch}:${filePath}`;
  // e.g. "repo_123:main:src/components/Editor.tsx"
}

// ──────────────────────────────────────────────
// joinRoom — add a connection to a room with its initial content
// ──────────────────────────────────────────────
export function joinRoom(roomId: string, conn: AuthenticatedSocket, initialContent: string): void {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }
  room.set(conn, { content: initialContent, seq: 0 });
}

// ──────────────────────────────────────────────
// updatePeerContent — update tracked content after applying patches
// ──────────────────────────────────────────────
export function updatePeerContent(
  roomId: string,
  conn: AuthenticatedSocket,
  content: string,
  seq: number,
): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const state = room.get(conn);
  if (state) {
    state.content = content;
    state.seq = seq;
  }
}

// ──────────────────────────────────────────────
// getPeerDocState — get a single connection's tracked state
// ──────────────────────────────────────────────
export function getPeerDocState(
  roomId: string,
  conn: AuthenticatedSocket,
): PeerDocState | undefined {
  return rooms.get(roomId)?.get(conn);
}

// ──────────────────────────────────────────────
// leaveRoom — remove a connection from a room, clean up empty rooms
// ──────────────────────────────────────────────
export function leaveRoom(roomId: string, conn: AuthenticatedSocket): void {
  const room = rooms.get(roomId);
  if (!room) return;

  room.delete(conn);

  if (room.size === 0) {
    rooms.delete(roomId);
  }
}

// ──────────────────────────────────────────────
// broadcastToRoom — send a message to all connections in a room,
//                   optionally excluding one (the sender)
// ──────────────────────────────────────────────
export function broadcastToRoom(
  roomId: string,
  msg: ServerMessage,
  excludeConn?: AuthenticatedSocket,
): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(msg);

  for (const [conn] of room.entries()) {
    if (conn === excludeConn) continue;
    if (conn.readyState === conn.OPEN) {
      conn.send(payload);
    }
  }
}

// ──────────────────────────────────────────────
// getRoomPeers — list of peers currently in a room (with their content)
// ──────────────────────────────────────────────
export function getRoomPeers(
  roomId: string,
): { username: string; avatarUrl: string | null; currentContent: string; seq: number }[] {
  const room = rooms.get(roomId);
  if (!room) return [];

  return Array.from(room.entries()).map(([conn, state]) => ({
    username: conn.user.username,
    avatarUrl: conn.user.avatarUrl || null,
    currentContent: state.content,
    seq: state.seq,
  }));
}

export function updatePeerState(roomId: string, conn: AuthenticatedSocket, content: string, seq: number): void {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.has(conn)) {
    room.set(conn, { content, seq });
  }
}

// ──────────────────────────────────────────────
// removeFromAllRooms — clean up on disconnect
// Returns the list of roomIds the connection was in (for peer_left broadcasts)
// ──────────────────────────────────────────────
export function removeFromAllRooms(conn: AuthenticatedSocket): string[] {
  const affectedRooms: string[] = [];

  for (const [roomId, room] of rooms) {
    if (room.has(conn)) {
      room.delete(conn);
      affectedRooms.push(roomId);

      if (room.size === 0) {
        rooms.delete(roomId);
      }
    }
  }

  return affectedRooms;
}
