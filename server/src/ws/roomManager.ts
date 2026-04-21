import type { AuthenticatedSocket, ServerMessage } from './ws.types.js';
import * as presenceStore from '../state/presenceStore.js';
import * as diffStore from '../state/diffStore.js';
import * as pubsub from '../state/pubsub.js';
import type { PubSubMessage } from '../state/pubsub.js';

// ──────────────────────────────────────────────
// Local socket registry — delivery mechanism ONLY
//
// This is NOT the source of truth for presence.
// Presence truth lives in Redis (presenceStore).
//
// localSockets maps roomId → Set<AuthenticatedSocket>
// scoped to THIS Fastify process. When a PubSub message
// arrives for a room, we look up localSockets to find
// which WebSockets on this instance need the message.
// ──────────────────────────────────────────────
const localSockets = new Map<string, Set<AuthenticatedSocket>>();

// ──────────────────────────────────────────────
// getRoomId — deterministic room key
// Rule: filePath must be normalized (no leading slash, forward slashes only)
// ──────────────────────────────────────────────
export function getRoomId(
  repoId: string,
  branch: string,
  filePath: string
): string {
  return `${repoId}:${branch}:${filePath}`;
}

// ──────────────────────────────────────────────
// joinRoom — register socket locally + update Redis presence + subscribe to PubSub
// ──────────────────────────────────────────────
export async function joinRoom(
  roomId: string,
  conn: AuthenticatedSocket
): Promise<void> {
  // 1. Add to local socket registry
  let room = localSockets.get(roomId);
  if (!room) {
    room = new Set();
    localSockets.set(roomId, room);
  }
  room.add(conn);

  // 2. Update Redis presence (source of truth)
  await presenceStore.join(roomId, conn.user.userId);

  // 3. Subscribe to PubSub channel (idempotent — skips if already subscribed)
  await pubsub.subscribe(roomId, (msg: PubSubMessage) => {
    onPubSubMessage(roomId, msg, conn.user.userId);
  });
}

// ──────────────────────────────────────────────
// leaveRoom — remove socket locally + clean Redis presence + delete diff + PubSub
// ──────────────────────────────────────────────
export async function leaveRoom(
  roomId: string,
  conn: AuthenticatedSocket
): Promise<void> {
  // 1. Remove from local registry
  const room = localSockets.get(roomId);
  if (room) {
    room.delete(conn);
    if (room.size === 0) {
      localSockets.delete(roomId);
      // Last local socket left — unsubscribe from PubSub
      await pubsub.unsubscribe(roomId);
    }
  }

  // 2. Update Redis presence
  await presenceStore.leave(roomId, conn.user.userId);

  // 3. Explicit diff cleanup (belt-and-suspenders alongside 60s TTL)
  await diffStore.deleteDiff(roomId, conn.user.userId);
}

// ──────────────────────────────────────────────
// broadcastToLocalSockets — send to all local connections in a room
// ──────────────────────────────────────────────
export function broadcastToLocalSockets(
  roomId: string,
  msg: ServerMessage,
  excludeUserId?: number
): void {
  const room = localSockets.get(roomId);
  if (!room) return;

  const payload = JSON.stringify(msg);

  for (const conn of room) {
    if (excludeUserId !== undefined && conn.user.userId === excludeUserId) {
      continue;
    }
    if (conn.readyState === conn.OPEN) {
      conn.send(payload);
    }
  }
}

// ──────────────────────────────────────────────
// removeFromAllRooms — clean up on disconnect
// Returns the list of roomIds the connection was in
// ──────────────────────────────────────────────
export async function removeFromAllRooms(
  conn: AuthenticatedSocket
): Promise<string[]> {
  const affectedRooms: string[] = [];

  for (const [roomId, room] of localSockets) {
    if (room.has(conn)) {
      room.delete(conn);
      affectedRooms.push(roomId);

      // Clean Redis presence + diff
      await presenceStore.leave(roomId, conn.user.userId);
      await diffStore.deleteDiff(roomId, conn.user.userId);

      if (room.size === 0) {
        localSockets.delete(roomId);
        await pubsub.unsubscribe(roomId);
      }
    }
  }

  return affectedRooms;
}

// ──────────────────────────────────────────────
// onPubSubMessage — handle messages arriving from Redis PubSub
//
// When any server instance publishes to a room channel,
// every subscriber (including this instance) receives it.
// We relay the message to the local sockets, excluding
// the user who originated it to avoid echo.
// ──────────────────────────────────────────────
function onPubSubMessage(
  roomId: string,
  msg: PubSubMessage,
  _localUserId: number
): void {
  switch (msg.event) {
    case 'peer_diff': {
      const serverMsg: ServerMessage = {
        type: 'peer_diff',
        roomId,
        username: (msg.payload as any).username ?? String(msg.userId),
        patches: (msg.payload as any).patches ?? [],
        seq: (msg.payload as any).seq ?? 0,
        content: (msg.payload as any).content ?? undefined,
      };
      // Exclude the originating user from receiving their own diff
      broadcastToLocalSockets(roomId, serverMsg, msg.userId);
      break;
    }

    case 'peer_joined': {
      const serverMsg: ServerMessage = {
        type: 'peer_joined',
        roomId,
        username: (msg.payload as any).username ?? String(msg.userId),
        avatarUrl: (msg.payload as any).avatarUrl ?? null,
      };
      broadcastToLocalSockets(roomId, serverMsg, msg.userId);
      break;
    }

    case 'peer_left': {
      const serverMsg: ServerMessage = {
        type: 'peer_left',
        roomId,
        username: (msg.payload as any).username ?? String(msg.userId),
      };
      broadcastToLocalSockets(roomId, serverMsg);
      break;
    }

    case 'base_updated': {
      // Webhook push received -- notify all clients in this room
      const payload = msg.payload as any;
      if (payload?.type === 'remote_push') {
        const pushMsg: ServerMessage = {
          type: 'remote_push',
          roomId,
          pushedBy: payload.pushedBy ?? 'unknown',
          branch: payload.branch ?? '',
          changedFiles: payload.changedFiles ?? [],
          commitSha: payload.commitSha ?? '',
        };
        broadcastToLocalSockets(roomId, pushMsg);
      }
      break;
    }

    case 'chat_message': {
      const p = msg.payload as any;
      const chatMsg: ServerMessage = {
        type: 'chat_broadcast',
        roomId,
        messageId: p.messageId,
        userId: msg.userId,
        username: p.username ?? String(msg.userId),
        avatarUrl: p.avatarUrl ?? null,
        text: p.text ?? '',
        timestamp: p.timestamp ?? Date.now(),
      };
      // Broadcast to ALL local sockets including sender (echo confirmation)
      broadcastToLocalSockets(roomId, chatMsg);
      break;
    }

    case 'chat_deleted': {
      const p = msg.payload as any;
      const deleteMsg: ServerMessage = {
        type: 'chat_deleted',
        roomId,
        messageId: p.messageId,
        deletedBy: msg.userId,
      };
      broadcastToLocalSockets(roomId, deleteMsg);
      break;
    }
  }
}
