import type { AuthenticatedSocket, ClientMessage, ServerMessage } from './ws.types.js';
import {
  getRoomId,
  joinRoom,
  leaveRoom,
  broadcastToRoom,
  getRoomPeers,
  removeFromAllRooms,
} from './roomManager.js';

// ──────────────────────────────────────────────
// handleMessage — route incoming JSON by `type`
// ──────────────────────────────────────────────
export function handleMessage(conn: AuthenticatedSocket, raw: string): void {
  let msg: ClientMessage;

  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    conn.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    return;
  }

  switch (msg.type) {
    case 'join_room':
      onJoinRoom(conn, msg);
      break;

    case 'leave_room':
      onLeaveRoom(conn, msg);
      break;

    case 'diff_update':
      onDiffUpdate(conn, msg);
      break;

    default:
      conn.send(JSON.stringify({ type: 'error', message: `Unknown message type` }));
  }
}

// ──────────────────────────────────────────────
// handleDisconnect — clean up all rooms on socket close
// ──────────────────────────────────────────────
export function handleDisconnect(conn: AuthenticatedSocket): void {
  const affectedRooms = removeFromAllRooms(conn);

  for (const roomId of affectedRooms) {
    const peerLeft: ServerMessage = {
      type: 'peer_left',
      roomId,
      username: conn.user.username,
    };
    broadcastToRoom(roomId, peerLeft);
  }
}

// ──────────────────────────────────────────────
// Handlers for each message type
// ──────────────────────────────────────────────

function onJoinRoom(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'join_room' }>,
): void {
  // Normalize filePath: no leading slash, forward slashes only
  const filePath = msg.filePath.replace(/\\/g, '/').replace(/^\//, '');
  const roomId = getRoomId(msg.repoId, msg.branch, filePath);

  // Add to room
  joinRoom(roomId, conn);

  // Send room_joined back to this connection with current peer list
  const peers = getRoomPeers(roomId);
  const roomJoined: ServerMessage = {
    type: 'room_joined',
    roomId,
    peers,
  };
  conn.send(JSON.stringify(roomJoined));

  // Broadcast peer_joined to everyone else in the room
  const peerJoined: ServerMessage = {
    type: 'peer_joined',
    roomId,
    username: conn.user.username,
    avatarUrl: conn.user.avatarUrl || null,
  };
  broadcastToRoom(roomId, peerJoined, conn);
}

function onLeaveRoom(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'leave_room' }>,
): void {
  leaveRoom(msg.roomId, conn);

  // Broadcast peer_left to remaining room members
  const peerLeft: ServerMessage = {
    type: 'peer_left',
    roomId: msg.roomId,
    username: conn.user.username,
  };
  broadcastToRoom(msg.roomId, peerLeft);
}

function onDiffUpdate(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'diff_update' }>,
): void {
  // Relay as peer_diff to everyone else in the room
  const peerDiff: ServerMessage = {
    type: 'peer_diff',
    roomId: msg.roomId,
    username: conn.user.username,
    patches: msg.patches,
    seq: msg.seq,
  };
  broadcastToRoom(msg.roomId, peerDiff, conn);
}
