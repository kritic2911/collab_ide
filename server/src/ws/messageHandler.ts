import type { AuthenticatedSocket, ClientMessage, DiffPatch, ServerMessage } from './ws.types.js';
import {
  getRoomId,
  joinRoom,
  leaveRoom,
  broadcastToLocalSockets,
  removeFromAllRooms,
  updatePeerState,
  getPeerContent,
} from './roomManager.js';
import * as presenceStore from '../state/presenceStore.js';
import * as diffStore from '../state/diffStore.js';
import * as baseCache from '../state/baseCache.js';
import * as pubsub from '../state/pubsub.js';
import type { PubSubMessage } from '../state/pubsub.js';
import * as chatService from '../services/chatService.js';

// ──────────────────────────────────────────────
// handleMessage — route incoming JSON by `type`
// ──────────────────────────────────────────────
export function handleMessage(
  conn: AuthenticatedSocket,
  raw: string
): void {
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

    case 'chat_message':
      onChatMessage(conn, msg);
      break;

    case 'chat_load_older':
      onChatLoadOlder(conn, msg);
      break;

    case 'chat_delete':
      onChatDelete(conn, msg);
      break;

    default:
      conn.send(
        JSON.stringify({ type: 'error', message: 'Unknown message type' })
      );
  }
}

// ──────────────────────────────────────────────
// handleDisconnect — clean up all rooms on socket close
// ──────────────────────────────────────────────
export async function handleDisconnect(
  conn: AuthenticatedSocket
): Promise<void> {
  const affectedRooms = await removeFromAllRooms(conn);

  // Broadcast peer_left via PubSub for each room
  for (const roomId of affectedRooms) {
    const msg: PubSubMessage = {
      event: 'peer_left',
      roomId,
      userId: conn.user.userId,
      payload: {
        username: conn.user.username,
      },
      timestamp: Date.now(),
    };
    await pubsub.publish(roomId, msg);
  }
}

// ──────────────────────────────────────────────
// join_room — atomic hydration flow
//
// 1. presenceStore.join (via roomManager)
// 2. pubsub.subscribe (via roomManager)
// 3. Fetch base from D2 (L1→L2→L3 waterfall)
// 4. Fetch all active peer diffs from D3
// 5. Send single atomic hydrate_state to the joining client
// 6. Publish peer_joined via PubSub
//
// One hydrate_state message eliminates the race condition
// that would exist if base and diffs were sent separately.
// ──────────────────────────────────────────────
async function onJoinRoom(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'join_room' }>
): Promise<void> {
  // Normalize filePath: no leading slash, forward slashes only
  const filePath = msg.filePath.replace(/\\/g, '/').replace(/^\//, '');
  const roomId = getRoomId(msg.repoId, msg.branch, filePath);

  // 1-2. Join room (local + Redis presence + PubSub subscribe)
  await joinRoom(roomId, conn);

  // 3. Build peer list from presence (excluding self)
  const peerIds = await presenceStore.getPeers(roomId);
  const otherPeerIds = peerIds.filter((id) => id !== conn.user.userId);

  // Look up usernames/avatars from database for all present peers
  let peerInfoList: { username: string; avatarUrl: string | null }[] = [];
  if (otherPeerIds.length > 0) {
    const { db } = await import('../db/client.js');
    const placeholders = otherPeerIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.query<{ username: string; avatar_url: string | null }>(
      `SELECT username, avatar_url FROM users WHERE id IN (${placeholders})`,
      otherPeerIds
    );
    peerInfoList = result.rows.map((r) => ({
      username: r.username,
      avatarUrl: r.avatar_url,
    }));
  }

  // 4. Send room_joined first so the client populates the PresenceBar
  const joinedAck: ServerMessage = {
    type: 'room_joined',
    roomId,
    peers: peerInfoList,
  };
  conn.send(JSON.stringify(joinedAck));

  // 5. Fetch base content from the cache waterfall
  const base = await baseCache.getBase(roomId);

  // 6. Fetch all active peer diffs
  const diffsMap = await diffStore.getAllDiffs(roomId, otherPeerIds);

  // Convert Map to array for JSON serialization
  const diffs: { userId: number; patch: object }[] = [];
  for (const [userId, patch] of diffsMap) {
    diffs.push({ userId, patch });
  }

  // 7. Send single atomic hydrate_state to the joining client
  const hydrate: ServerMessage = {
    type: 'hydrate_state',
    roomId,
    base,
    diffs,
  };
  conn.send(JSON.stringify(hydrate));

  // 8. Send chat history (last 7 days, max 50)
  const chatHistory = await chatService.getHistory(roomId, 50);
  const historyMsg: ServerMessage = {
    type: 'chat_history',
    roomId,
    messages: chatHistory,
  };
  conn.send(JSON.stringify(historyMsg));

  // 9. Broadcast peer_joined via PubSub to all other subscribers
  const joinedMsg: PubSubMessage = {
    event: 'peer_joined',
    roomId,
    userId: conn.user.userId,
    payload: {
      username: conn.user.username,
      avatarUrl: conn.user.avatarUrl || null,
    },
    timestamp: Date.now(),
  };
  await pubsub.publish(roomId, joinedMsg);
}

// ──────────────────────────────────────────────
// leave_room — explicit leave handler
// ──────────────────────────────────────────────
async function onLeaveRoom(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'leave_room' }>
): Promise<void> {
  // Clean up local + Redis + diff
  await leaveRoom(msg.roomId, conn);

  // Broadcast peer_left via PubSub
  const leftMsg: PubSubMessage = {
    event: 'peer_left',
    roomId: msg.roomId,
    userId: conn.user.userId,
    payload: {
      username: conn.user.username,
    },
    timestamp: Date.now(),
  };
  await pubsub.publish(msg.roomId, leftMsg);
}

// ──────────────────────────────────────────────
// diff_update — store in D3 + relay via PubSub
//
// 1. diffStore.setDiff (overwrites user's snapshot, resets 60s TTL)
// 2. pubsub.publish (peer_diff to all subscribers)
//
// Server is a "dumb relay" — clients handle merge logic.
// ──────────────────────────────────────────────
async function onDiffUpdate(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'diff_update' }>
): Promise<void> {
  // 1. Store the user's current diff snapshot in D3
  await diffStore.setDiff(msg.roomId, conn.user.userId, {
    patches: msg.patches,
    seq: msg.seq,
    content: msg.content ?? null,
  });

  // 2. Relay via PubSub -- all server instances will broadcast to their local sockets
  const diffMsg: PubSubMessage = {
    event: 'peer_diff',
    roomId: msg.roomId,
    userId: conn.user.userId,
    payload: {
      patches: msg.patches,
      seq: msg.seq,
      username: conn.user.username,
      content: msg.content ?? null,
    },
    timestamp: Date.now(),
  };
  await pubsub.publish(msg.roomId, diffMsg);
}

// ──────────────────────────────────────────────
// chat_message — validate, persist (encrypted), relay via PubSub
// ──────────────────────────────────────────────
async function onChatMessage(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'chat_message' }>
): Promise<void> {
  // 1. Validate text
  const text = (msg.text || '').trim();
  if (!text || text.length > 2000) {
    conn.send(
      JSON.stringify({ type: 'error', message: 'Message must be 1-2000 characters' })
    );
    return;
  }

  // 2. Persist (encrypt + INSERT)
  const entry = await chatService.saveMessage(
    msg.roomId,
    conn.user.userId,
    conn.user.username,
    conn.user.avatarUrl || null,
    text
  );

  // 3. Fan out via PubSub (plaintext — never persisted in Redis)
  const chatMsg: PubSubMessage = {
    event: 'chat_message',
    roomId: msg.roomId,
    userId: conn.user.userId,
    payload: {
      messageId: entry.id,
      username: entry.username,
      avatarUrl: entry.avatarUrl,
      text: entry.text,
      timestamp: entry.timestamp,
    },
    timestamp: Date.now(),
  };
  await pubsub.publish(msg.roomId, chatMsg);
}

// ──────────────────────────────────────────────
// chat_load_older — cursor-based pagination (up to 30 days)
// ──────────────────────────────────────────────
async function onChatLoadOlder(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'chat_load_older' }>
): Promise<void> {
  const PAGE_SIZE = 30;
  const older = await chatService.getOlderMessages(msg.roomId, msg.beforeId, PAGE_SIZE);

  const olderMsg: ServerMessage = {
    type: 'chat_older_history',
    roomId: msg.roomId,
    messages: older,
    hasMore: older.length === PAGE_SIZE,
  };
  conn.send(JSON.stringify(olderMsg));
}

// ──────────────────────────────────────────────
// chat_delete — delete own message, broadcast removal
// ──────────────────────────────────────────────
async function onChatDelete(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'chat_delete' }>
): Promise<void> {
  const deleted = await chatService.deleteMessage(msg.messageId, conn.user.userId);

  if (!deleted) {
    conn.send(
      JSON.stringify({ type: 'error', message: 'Message not found or not owned by you' })
    );
    return;
  }

  // Broadcast deletion to all peers via PubSub
  const deleteMsg: PubSubMessage = {
    event: 'chat_deleted',
    roomId: msg.roomId,
    userId: conn.user.userId,
    payload: {
      messageId: msg.messageId,
    },
    timestamp: Date.now(),
  };
  await pubsub.publish(msg.roomId, deleteMsg);
}
