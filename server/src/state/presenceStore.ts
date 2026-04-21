import { redisClient } from './redis.client.js';

// ──────────────────────────────────────────────
// Presence Store — tracks active users per room
//
// Redis type: Set
//   Key:   presence:{roomId}
//   Value: Set<userId (as string)>
//   TTL:   5 minutes (rolling, reset on every join)
//
// The rolling TTL acts as a dead-man switch: if all
// sockets in a room crash without firing disconnect,
// the presence set auto-expires in 5 minutes.
// ──────────────────────────────────────────────

/** Rolling TTL for presence sets — 5 minutes */
const PRESENCE_TTL_SECONDS = 300;

/** Build the Redis key for a room's presence set */
function presenceKey(roomId: string): string {
  return `presence:${roomId}`;
}

/**
 * Add a user to a room's presence set (idempotent).
 * Refreshes the rolling 5-minute TTL on each join.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userId {number} The user ID to add to presence.
 * @returns {Promise<void>} Resolves when user is added to the set.
 * @throws {Error} Throws if Redis SADD/EXPIRE pipeline fails.
 */
export async function join(
  roomId: string,
  userId: number
): Promise<void> {
  const key = presenceKey(roomId);
  const pipeline = redisClient.pipeline();
  pipeline.sadd(key, String(userId));
  pipeline.expire(key, PRESENCE_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Remove a user from a room's presence set (idempotent).
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userId {number} The user ID to remove from presence.
 * @returns {Promise<void>} Resolves when user is removed from the set.
 * @throws {Error} Throws if Redis SREM operation fails.
 */
export async function leave(
  roomId: string,
  userId: number
): Promise<void> {
  await redisClient.srem(presenceKey(roomId), String(userId));
}

/**
 * Get all user IDs currently present in a room.
 *
 * @param roomId {string} The unique identifier for the room.
 * @returns {Promise<number[]>} Array of numeric user IDs present in the room.
 * @throws {Error} Throws if Redis SMEMBERS operation fails.
 */
export async function getPeers(roomId: string): Promise<number[]> {
  const members = await redisClient.smembers(presenceKey(roomId));
  return members.map(Number);
}

/**
 * Check if a specific user is present in a room.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userId {number} The user ID to check.
 * @returns {Promise<boolean>} True if user is present, false otherwise.
 * @throws {Error} Throws if Redis SISMEMBER operation fails.
 */
export async function isPresent(
  roomId: string,
  userId: number
): Promise<boolean> {
  const result = await redisClient.sismember(
    presenceKey(roomId),
    String(userId)
  );
  return result === 1;
}
