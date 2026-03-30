import type { AuthenticatedSocket, ClientMessage, DiffPatch, ServerMessage } from './ws.types.js';
import {
  getRoomId,
  joinRoom,
  leaveRoom,
  broadcastToRoom,
  getRoomPeers,
  removeFromAllRooms,
  getPeerDocState,
  updatePeerContent,
} from './roomManager.js';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const MAX_CONTENT_BYTES = 500 * 1024; // 500 KB cap

// ──────────────────────────────────────────────
// applyPatches — apply Monaco-shaped DiffPatch[] to a string
// Processes patches in reverse offset order to avoid index shifts.
// ──────────────────────────────────────────────
export function applyPatches(text: string, patches: DiffPatch[]): string {
  const withOffsets = patches.map(p => ({
    ...p,
    startOffset: offsetFromRange(text, p.range),
    endOffset: offsetFromRange(text, {
      startLineNumber: p.range.endLineNumber,
      startColumn: p.range.endColumn,
      endLineNumber: p.range.endLineNumber,
      endColumn: p.range.endColumn
    }),
  }));

  const sorted = withOffsets.sort((a, b) => b.startOffset - a.startOffset);

  let result = text;
  for (const p of sorted) {
    result = result.slice(0, p.startOffset) + p.text + result.slice(p.endOffset);
  }
  return result;
}

/** Convert Monaco 1-based line/col range to a 0-based string offset. */
function offsetFromRange(
  text: string,
  range: DiffPatch['range'],
): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < range.startLineNumber - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for the \n
  }
  offset += range.startColumn - 1;
  return Math.min(offset, text.length);
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

  // Add to room with initial content
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
  // Apply patches to this peer's tracked shadow document
  const state = getPeerDocState(msg.roomId, conn);
  if (state) {
    const updated = applyPatches(state.content, msg.patches);
    updatePeerContent(msg.roomId, conn, updated, msg.seq);
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
