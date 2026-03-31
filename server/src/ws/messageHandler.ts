import type { AuthenticatedSocket, ClientMessage, DiffPatch, ServerMessage } from './ws.types.js';
import {
  getRoomId,
  joinRoom,
  leaveRoom,
  broadcastToRoom,
  getRoomPeers,
  removeFromAllRooms,
  updatePeerState,
  getPeerContent,
} from './roomManager.js';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const MAX_CONTENT_BYTES = 500 * 1024; // 500 KB cap

// ──────────────────────────────────────────────
// applyPatches — apply Monaco-shaped DiffPatch[] to a string
// ──────────────────────────────────────────────
export function applyPatches(text: string, patches: DiffPatch[]): string {
  let result = text;
  for (const patch of patches) {
    const lines = result.split('\n');
    let startOffset = 0;
    for (let i = 0; i < patch.range.startLineNumber - 1; i++) {
      startOffset += lines[i].length + 1;
    }
    startOffset += patch.range.startColumn - 1;

    let endOffset = 0;
    for (let i = 0; i < patch.range.endLineNumber - 1; i++) {
      endOffset += lines[i].length + 1;
    }
    endOffset += patch.range.endColumn - 1;

    result = result.substring(0, startOffset) + patch.text + result.substring(endOffset);
  }
  return result;
}

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

    case 'request_peer_content':
      onRequestPeerContent(conn, msg);
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
  const content = msg.content ?? '';

  // 500 KB cap
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    conn.send(JSON.stringify({ type: 'error', message: 'File too large to render collaboratively (>500 KB)' }));
    return;
  }

  // Normalize filePath: no leading slash, forward slashes only
  const filePath = msg.filePath.replace(/\\/g, '/').replace(/^\//, '');
  const roomId = getRoomId(msg.repoId, msg.branch, filePath);

  // Add to room
  joinRoom(roomId, conn, content);

  // Send room_joined back to this connection with current peer list (includes content+seq)
  const peers = getRoomPeers(roomId);
  const roomJoined: ServerMessage = {
    type: 'room_joined',
    roomId,
    peers,
  };
  conn.send(JSON.stringify(roomJoined));

  // Broadcast peer_joined to everyone else in the room (with this peer's content)
  const peerJoined: ServerMessage = {
    type: 'peer_joined',
    roomId,
    username: conn.user.username,
    avatarUrl: conn.user.avatarUrl || null,
    currentContent: content,
    seq: 0,
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
  const peers = getRoomPeers(msg.roomId);
  const me = peers.find(p => p.username === conn.user.username);
  if (me) {
     const newContent = applyPatches(me.currentContent, msg.patches);
     updatePeerState(msg.roomId, conn, newContent, msg.seq);
  }

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

function onRequestPeerContent(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'request_peer_content' }>,
): void {
  const content = getPeerContent(msg.roomId, msg.username);
  if (content !== null) {
    const response: ServerMessage = {
      type: 'peer_content',
      roomId: msg.roomId,
      username: msg.username,
      content,
    };
    conn.send(JSON.stringify(response));
  }
}
