import type { AuthenticatedSocket, ClientMessage } from './ws.types.js';
import * as conflictStore from '../state/conflictStore.js';
import * as pubsub from '../state/pubsub.js';
import type { PubSubMessage } from '../state/pubsub.js';

// ──────────────────────────────────────────────
// Conflict Handler — WebSocket resolution routing
//
// Handles 'resolve_conflict' messages from clients.
// When a user clicks "Keep Mine", "Keep Theirs", or
// "Edit Manually" in the ConflictPanel, this handler:
//
//   1. Records the decision in conflictStore
//   2. Publishes a 'conflict_resolved' event via PubSub
//   3. All peers see the conflict disappear in real-time
// ──────────────────────────────────────────────

/**
 * Handle a resolve_conflict message from a client.
 *
 * @param conn {AuthenticatedSocket} The authenticated WebSocket connection.
 * @param msg {object} The parsed resolve_conflict message.
 * @returns {Promise<void>}
 */
export async function onResolveConflict(
  conn: AuthenticatedSocket,
  msg: Extract<ClientMessage, { type: 'resolve_conflict' }>
): Promise<void> {
  const { roomId, startLine, endLine, resolution } = msg;

  // 1. Record the resolution in Redis
  await conflictStore.resolveConflict(roomId, startLine, endLine, {
    resolution,
    resolvedBy: conn.user.username,
    resolvedAt: Date.now(),
    lineRange: `L${startLine}-L${endLine}`,
  });

  // 2. Publish conflict_resolved via PubSub to all room subscribers
  const resolvedMsg: PubSubMessage = {
    event: 'conflict_resolved' as any,
    roomId,
    userId: conn.user.userId,
    payload: {
      startLine,
      endLine,
      resolution,
      resolvedBy: conn.user.username,
    },
    timestamp: Date.now(),
  };
  await pubsub.publish(roomId, resolvedMsg);
}
