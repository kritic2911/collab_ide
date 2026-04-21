import { redisClient, redisPubSubClient } from './redis.client.js';

// ──────────────────────────────────────────────
// Pub/Sub — cross-process message distribution
//
// Replaces the in-memory broadcast entirely. All server
// instances subscribe to room channels. When any instance
// receives a diff, it publishes to Redis — Redis fans it
// out to all subscribers.
//
// Channel format: room:{repoId}:{branch}:{filePath}
//
// Uses redisPubSubClient (dedicated connection) for
// subscriptions, and the regular redisClient for publishing.
// ──────────────────────────────────────────────

/**
 * Standardized message envelope.
 * All pub/sub messages share this shape so consumers
 * never have parsing ambiguity.
 */
export interface PubSubMessage {
  event: 'peer_diff' | 'peer_joined' | 'peer_left' | 'base_updated' | 'conflict_detected' | 'conflict_resolved' | 'chat_message' | 'chat_deleted';
  roomId: string;
  userId: number;
  payload: object;
  timestamp: number;
}

/** Build the Redis channel name for a room */
function channelName(roomId: string): string {
  return `room:${roomId}`;
}

/**
 * Track active subscriptions to avoid duplicate listeners.
 * Stores the WRAPPED handler (with JSON parsing) so we can
 * properly call removeListener() on unsubscribe.
 */
const activeSubscriptions = new Map<
  string,
  (channel: string, message: string) => void
>();

/**
 * Publish a message to a room's channel using the commands client.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param payload {PubSubMessage} The standardized message envelope to broadcast.
 * @returns {Promise<void>} Resolves when the message is published.
 * @throws {Error} Throws if Redis publish operation fails.
 */
export async function publish(
  roomId: string,
  payload: PubSubMessage
): Promise<void> {
  const channel = channelName(roomId);
  await redisClient.publish(channel, JSON.stringify(payload));
}

/**
 * Subscribe to a room's channel using the dedicated subscriber client.
 * The callback fires for every message published to that channel.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param onMessage {function} Callback function invoked with the parsed PubSubMessage.
 * @returns {Promise<void>} Resolves when subscription is established.
 * @throws {Error} Throws if Redis subscription operation fails.
 */
export async function subscribe(
  roomId: string,
  onMessage: (msg: PubSubMessage) => void
): Promise<void> {
  const channel = channelName(roomId);

  // Avoid duplicate subscriptions to the same channel
  if (activeSubscriptions.has(channel)) return;

  // Wrap the callback to handle JSON parsing and channel filtering
  const wrappedHandler = (_receivedChannel: string, rawMessage: string) => {
    if (_receivedChannel !== channel) return;
    try {
      const parsed = JSON.parse(rawMessage) as PubSubMessage;
      onMessage(parsed);
    } catch {
      console.error(`[PubSub] Failed to parse message on ${channel}`);
    }
  };

  // ioredis subscribe + message event
  await redisPubSubClient.subscribe(channel);
  redisPubSubClient.on('message', wrappedHandler);

  // Store the WRAPPED handler so unsubscribe can remove the exact listener
  activeSubscriptions.set(channel, wrappedHandler);
}

/**
 * Unsubscribe from a room's channel and remove its message listener.
 * Properly calls removeListener() to prevent handler accumulation.
 *
 * @param roomId {string} The unique identifier for the room.
 * @returns {Promise<void>} Resolves when unsubscription is complete.
 * @throws {Error} Throws if Redis unsubscribe operation fails.
 */
export async function unsubscribe(roomId: string): Promise<void> {
  const channel = channelName(roomId);

  const handler = activeSubscriptions.get(channel);
  if (!handler) return;

  // Remove the listener BEFORE unsubscribing to prevent race conditions
  redisPubSubClient.removeListener('message', handler);
  await redisPubSubClient.unsubscribe(channel);
  activeSubscriptions.delete(channel);
}
