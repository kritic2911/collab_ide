import { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { verifyJwt, JwtPayload } from '../auth/jwt.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type DiffPatch = {
  range: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  text: string
  rangeLength: number
}

type ClientMessage =
  | {
      type: 'join_room'
      repoId: string
      branch: string
      filePath: string
    }
  | {
      type: 'leave_room'
      roomId: string
    }
  | {
      type: 'diff_update'
      roomId: string
      patches: DiffPatch[]
      seq: number
    }

type ServerMessage =
  | {
      type: 'room_joined'
      roomId: string
      peers: {
        username: string
        avatarUrl: string | null
      }[]
    }
  | {
      type: 'peer_joined'
      roomId: string
      username: string
      avatarUrl: string | null
    }
  | {
      type: 'peer_left'
      roomId: string
      username: string
    }
  | {
      type: 'peer_diff'
      roomId: string
      username: string
      patches: DiffPatch[]
      seq: number
    }
  | {
      type: 'remote_push'
      roomId: string
      pushedBy: string
      branch: string
      changedFiles: string[]
      commitSha: string
    }

// ──────────────────────────────────────────────
// Room state (in-memory)
// ──────────────────────────────────────────────

interface RoomClient {
  ws: WebSocket;
  user: JwtPayload;
}

/** roomId → Set of connected clients */
const rooms = new Map<string, Set<RoomClient>>();

function normalizeFilePath(filePath: string): string {
  // Rule: no leading slash, forward slashes only
  const trimmed = filePath.replace(/^[/\\]+/, '');
  return trimmed.replace(/\\/g, '/');
}

// Must match WEBHOOKS.md and client getRoomId.
function getRoomId(repoId: string, branch: string, filePath: string): string {
  return `${repoId}:${branch}:${normalizeFilePath(filePath)}`;
}

function getOrCreateRoom(roomId: string): Set<RoomClient> {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId)!;
}

function removeFromAllRooms(ws: WebSocket): void {
  for (const [roomId, clients] of rooms) {
    for (const client of clients) {
      if (client.ws === ws) {
        clients.delete(client);
        broadcastToRoom(
          roomId,
          { type: 'peer_left', roomId, username: client.user.username },
          ws
        );
        break;
      }
    }
    if (clients.size === 0) rooms.delete(roomId);
  }
}

function broadcastToRoom(roomId: string, msg: ServerMessage, excludeWs?: WebSocket): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const data = JSON.stringify(msg);
  for (const client of room) {
    if (client.ws !== excludeWs && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}

function getPeersInRoom(roomId: string, excludeWs?: WebSocket): { username: string; avatarUrl: string | null }[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  const peers: { username: string; avatarUrl: string | null }[] = [];
  for (const client of room) {
    if (client.ws !== excludeWs) {
      peers.push({
        username: client.user.username,
        avatarUrl: client.user.avatarUrl ?? null,
      });
    }
  }
  return peers;
}

/**
 * Called by the webhook handler after storing a GitHub push event.
 * Sends `remote_push` to every joined room for the given repo + branch.
 */
export function broadcastRemotePush(
  repoId: number,
  branch: string,
  pushedBy: string,
  changedFiles: string[],
  commitSha: string
): void {
  const repoIdStr = String(repoId);
  const prefix = `${repoIdStr}:${branch}:`;
  for (const [roomId] of rooms) {
    if (!roomId.startsWith(prefix)) continue;
    broadcastToRoom(roomId, {
      type: 'remote_push',
      roomId,
      pushedBy,
      branch,
      changedFiles,
      commitSha,
    });
  }
}

// ──────────────────────────────────────────────
// Plugin
// ──────────────────────────────────────────────

export async function wsPlugin(app: FastifyInstance) {
  await app.register(websocket);

  app.get('/ws', { websocket: true }, (socket, req) => {
    // ── Auth: JWT from query string ──
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const user = token ? verifyJwt(token) : null;

    if (!user) {
      socket.close(4001, 'Authentication failed');
      return;
    }

    app.log.info(`WS connected: ${user.username} (id=${user.userId})`);

    // ── Message handling ──
    socket.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case 'join_room': {
          const { repoId, branch, filePath } = msg;
          if (!repoId || !branch || !filePath) return;

          const roomId = getRoomId(repoId, branch, filePath);
          const room = getOrCreateRoom(roomId);

          // Prevent duplicate joins in the same room by same user.
          for (const client of room) {
            if (client.user.userId === user.userId) return;
          }

          room.add({ ws: socket, user });

          // Notify others that this peer joined.
          broadcastToRoom(
            roomId,
            {
              type: 'peer_joined',
              roomId,
              username: user.username,
              avatarUrl: user.avatarUrl ?? null,
            },
            socket
          );

          // Send current peer list to the joiner.
          socket.send(
            JSON.stringify({
              type: 'room_joined',
              roomId,
              peers: getPeersInRoom(roomId, socket),
            } satisfies ServerMessage)
          );
          break;
        }

        case 'leave_room': {
          const { roomId } = msg;
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;

          for (const client of room) {
            if (client.ws === socket) {
              room.delete(client);
              broadcastToRoom(roomId, { type: 'peer_left', roomId, username: user.username }, socket);
              break;
            }
          }
          if (room.size === 0) rooms.delete(roomId);
          break;
        }

        case 'diff_update': {
          const { roomId, patches, seq } = msg;
          if (!roomId) return;
          const room = rooms.get(roomId);
          if (!room) return;
          broadcastToRoom(
            roomId,
            {
              type: 'peer_diff',
              roomId,
              username: user.username,
              patches,
              seq,
            },
            socket
          );
          break;
        }
      }
    });

    // ── Cleanup on disconnect ──
    socket.on('close', () => {
      app.log.info(`WS disconnected: ${user.username}`);
      removeFromAllRooms(socket);
    });
  });
}

// Export for testing
export { rooms, getOrCreateRoom, removeFromAllRooms, broadcastToRoom, getPeersInRoom };
export type { ClientMessage, ServerMessage, DiffPatch, RoomClient };