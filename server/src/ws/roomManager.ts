import type { AuthenticatedSocket, ServerMessage } from './ws.types.js';

// ──────────────────────────────────────────────
// Room data structure — Map<roomId, Set<AuthenticatedSocket>>
// ──────────────────────────────────────────────
const rooms = new Map<string, Set<AuthenticatedSocket>>();

// ──────────────────────────────────────────────
// getRoomId — deterministic room key
// Rule: filePath must be normalized (no leading slash, forward slashes only)
// ──────────────────────────────────────────────
export function getRoomId(repoId: string, branch: string, filePath: string): string {
  return `${repoId}:${branch}:${filePath}`;
  // e.g. "repo_123:main:src/components/Editor.tsx"
}

// ──────────────────────────────────────────────
// joinRoom — add a connection to a room
// ──────────────────────────────────────────────
export function joinRoom(roomId: string, conn: AuthenticatedSocket): void {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Set();
    rooms.set(roomId, room);
  }
  room.add(conn);
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

  for (const conn of room) {
    if (conn === excludeConn) continue;
    if (conn.readyState === conn.OPEN) {
      conn.send(payload);
    }
  }
}

// ──────────────────────────────────────────────
// getRoomPeers — list of peers currently in a room
// ──────────────────────────────────────────────
export function getRoomPeers(roomId: string): { username: string; avatarUrl: string | null }[] {
  const room = rooms.get(roomId);
  if (!room) return [];

  return Array.from(room).map((conn) => ({
    username: conn.user.username,
    avatarUrl: conn.user.avatarUrl || null,
  }));
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

// ──────────────────────────────────────────────
// getSocketByUsername — find a specific peer's socket in a room
// ──────────────────────────────────────────────
export function getSocketByUsername(roomId: string, username: string): AuthenticatedSocket | null {
  const room = rooms.get(roomId);
  if (!room) return null;
  for (const conn of room) {
    if (conn.user.username === username) return conn;
  }
  return null;
}
