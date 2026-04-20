import type { AuthenticatedSocket, ClientMessage, DiffPatch, ServerMessage } from './ws.types.js';
import {
  getRoomId,
  joinRoom,
  leaveRoom,
  broadcastToLocalSockets,
  removeFromAllRooms,
  INSTANCE_ID,
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

  // Broadcast peer_left LOCALLY (instant) for each room
  for (const roomId of affectedRooms) {
    const peerLeftMsg: ServerMessage = {
      type: 'peer_left',
      roomId,
      username: conn.user.username,
    };
    broadcastToLocalSockets(roomId, peerLeftMsg);

    // Also publish to PubSub for other server instances
    pubsub.publish(roomId, {
      event: 'peer_left',
      roomId,
      userId: conn.user.userId,
      payload: { username: conn.user.username },
      timestamp: Date.now(),
      instanceId: INSTANCE_ID,
    } as any).catch((err) => console.error('[WS] PubSub peer_left publish failed:', err));
  }
}

// ──────────────────────────────────────────────
// join_room — atomic hydration flow
//
// 1. presenceStore.join (via roomManager)
// 2. Store initial content in D3
// 3. Fetch peers from Redis presence + their content from D3
// 4. Send room_joined + hydrate_state + chat_history to joiner
// 5. Broadcast peer_joined LOCALLY + via PubSub
// ──────────────────────────────────────────────
async function onJoinRoom(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'join_room' }>
): Promise<void> {
  // Normalize filePath: no leading slash, forward slashes only
  const filePath = msg.filePath.replace(/\\/g, '/').replace(/^\//, '');
  const roomId = getRoomId(msg.repoId, msg.branch, filePath);

  console.log(`[WS] join_room: ${conn.user.username} → ${roomId}`);

  // 1. Join room (local + Redis presence)
  await joinRoom(roomId, conn);

  // 2. Store the joiner's initial editor content in D3
  if (msg.content !== undefined) {
    await diffStore.setDiff(roomId, conn.user.userId, {
      patches: [],
      seq: 0,
      content: msg.content,
    });
  }

  // 3. Build peer list from presence (excluding self)
  const peerIds = await presenceStore.getPeers(roomId);
  const otherPeerIds = peerIds.filter((id) => id !== conn.user.userId);

  // Look up usernames/avatars + current content from database + diffStore
  let peerInfoList: { username: string; avatarUrl: string | null; currentContent?: string; seq?: number }[] = [];
  if (otherPeerIds.length > 0) {
    const { db } = await import('../db/client.js');
    const placeholders = otherPeerIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.query<{ id: number; username: string; avatar_url: string | null }>(
      `SELECT id, username, avatar_url FROM users WHERE id IN (${placeholders})`,
      otherPeerIds
    );

    // Fetch each peer's current content from diffStore in parallel
    const diffLookups = await Promise.all(
      result.rows.map(async (r) => {
        const diff = await diffStore.getDiff(roomId, r.id);
        return { row: r, diff: diff as { content?: string; seq?: number } | null };
      })
    );

    peerInfoList = diffLookups.map(({ row, diff }) => ({
      username: row.username,
      avatarUrl: row.avatar_url,
      currentContent: (diff as any)?.content ?? undefined,
      seq: (diff as any)?.seq ?? 0,
    }));
  }

  console.log(`[WS] room_joined: ${conn.user.username} sees ${peerInfoList.length} peer(s) in ${roomId}`);

  // 4. Send room_joined to the joining client
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

  const diffs: { userId: number; patch: object }[] = [];
  for (const [userId, patch] of diffsMap) {
    diffs.push({ userId, patch });
  }

  // 7. Send hydrate_state
  const hydrate: ServerMessage = {
    type: 'hydrate_state',
    roomId,
    base,
    diffs,
  };
  conn.send(JSON.stringify(hydrate));

  // 8. Send chat history
  const chatHistory = await chatService.getHistory(roomId, 50);
  const historyMsg: ServerMessage = {
    type: 'chat_history',
    roomId,
    messages: chatHistory,
  };
  conn.send(JSON.stringify(historyMsg));

  // 9. Broadcast peer_joined LOCALLY first (instant delivery to same-instance sockets)
  const peerJoinedMsg: ServerMessage = {
    type: 'peer_joined',
    roomId,
    username: conn.user.username,
    avatarUrl: conn.user.avatarUrl || null,
    currentContent: msg.content ?? undefined,
    seq: 0,
  };
  broadcastToLocalSockets(roomId, peerJoinedMsg, conn.user.userId);

  // Also publish to PubSub for other server instances (fire-and-forget)
  pubsub.publish(roomId, {
    event: 'peer_joined',
    roomId,
    userId: conn.user.userId,
    payload: {
      username: conn.user.username,
      avatarUrl: conn.user.avatarUrl || null,
      currentContent: msg.content ?? undefined,
      seq: 0,
    },
    timestamp: Date.now(),
    instanceId: INSTANCE_ID,
  } as any).catch((err) => console.error('[WS] PubSub peer_joined publish failed:', err));
}

// ──────────────────────────────────────────────
// leave_room — explicit leave handler
// ──────────────────────────────────────────────
async function onLeaveRoom(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'leave_room' }>
): Promise<void> {
  console.log(`[WS] leave_room: ${conn.user.username} ← ${msg.roomId}`);

  // Clean up local + Redis + diff
  await leaveRoom(msg.roomId, conn);

  // Broadcast peer_left LOCALLY (instant)
  const peerLeftMsg: ServerMessage = {
    type: 'peer_left',
    roomId: msg.roomId,
    username: conn.user.username,
  };
  broadcastToLocalSockets(msg.roomId, peerLeftMsg);

  // Also via PubSub for other instances
  pubsub.publish(msg.roomId, {
    event: 'peer_left',
    roomId: msg.roomId,
    userId: conn.user.userId,
    payload: { username: conn.user.username },
    timestamp: Date.now(),
    instanceId: INSTANCE_ID,
  } as any).catch((err) => console.error('[WS] PubSub peer_left publish failed:', err));
}

// ──────────────────────────────────────────────
// diff_update — store in D3 + broadcast locally + relay via PubSub
//
// LOCAL delivery is instant (no Redis round-trip).
// PubSub ensures other server instances also get notified.
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

  // 2. Broadcast LOCALLY to all sockets in the room (instant, no Redis round-trip)
  const peerDiffMsg: ServerMessage = {
    type: 'peer_diff',
    roomId: msg.roomId,
    username: conn.user.username,
    patches: msg.patches,
    seq: msg.seq,
    content: msg.content ?? undefined,
  };
  broadcastToLocalSockets(msg.roomId, peerDiffMsg, conn.user.userId);

  // 3. Also relay via PubSub for other server instances (fire-and-forget)
  pubsub.publish(msg.roomId, {
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
    instanceId: INSTANCE_ID,
  } as any).catch((err) => console.error('[WS] PubSub peer_diff publish failed:', err));
}

// ──────────────────────────────────────────────
// chat_message — validate, persist (encrypted), broadcast + relay
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

  // 3. Broadcast LOCALLY (instant)
  const chatBroadcast: ServerMessage = {
    type: 'chat_broadcast',
    roomId: msg.roomId,
    messageId: entry.id,
    userId: conn.user.userId,
    username: entry.username,
    avatarUrl: entry.avatarUrl,
    text: entry.text,
    timestamp: entry.timestamp,
  };
  broadcastToLocalSockets(msg.roomId, chatBroadcast);

  // 4. Also via PubSub for other instances
  pubsub.publish(msg.roomId, {
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
    instanceId: INSTANCE_ID,
  } as any).catch((err) => console.error('[WS] PubSub chat_message publish failed:', err));
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

  // Broadcast LOCALLY (instant)
  const deleteMsg: ServerMessage = {
    type: 'chat_deleted',
    roomId: msg.roomId,
    messageId: msg.messageId,
    deletedBy: conn.user.userId,
  };
  broadcastToLocalSockets(msg.roomId, deleteMsg);

  // Also via PubSub
  pubsub.publish(msg.roomId, {
    event: 'chat_deleted',
    roomId: msg.roomId,
    userId: conn.user.userId,
    payload: { messageId: msg.messageId },
    timestamp: Date.now(),
    instanceId: INSTANCE_ID,
  } as any).catch((err) => console.error('[WS] PubSub chat_deleted publish failed:', err));
}
