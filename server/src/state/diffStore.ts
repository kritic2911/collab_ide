import { redisClient } from './redis.client.js';

// ──────────────────────────────────────────────
// Diff Store (D3) — per-user snapshot of active edits
//
// Storage: Redis Hash (one hash per room)
//   Key:    diffs:{roomId}
//   Field:  userId (as string)
//   Value:  JSON-stringified Monaco patch object
//   TTL:    60 seconds (rolling, reset on every write)
//
// Design: One hash per room. Each user's diff is a field
// inside that hash. This enables single-roundtrip HGETALL
// for fetching all peer diffs, and eliminates the KEYS scan
// that individual keys would require.
//
// Rolling TTL is the dead-man switch: if a socket crashes
// without firing disconnect, the diff auto-expires in 60s.
// ──────────────────────────────────────────────

/** TTL for the room's diff hash — 60 seconds rolling */
const DIFF_TTL_SECONDS = 60;

/** Build the Redis hash key for a room's diffs */
function diffsKey(roomId: string): string {
  return `diffs:${roomId}`;
}

/**
 * Store (or overwrite) a user's current diff snapshot with a rolling 60s TTL.
 * Uses a pipeline to atomically HSET the field and reset the TTL.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userId {number} The ID of the user submitting the patch.
 * @param patch {object} The JSON-serializable patch object from Monaco editor.
 * @returns {Promise<void>} Resolves when the diff is stored.
 * @throws {Error} Throws if Redis pipeline execution fails.
 */
export async function setDiff(
  roomId: string,
  userId: number,
  patch: object
): Promise<void> {
  const key = diffsKey(roomId);
  const pipeline = redisClient.pipeline();
  pipeline.hset(key, String(userId), JSON.stringify(patch));
  pipeline.expire(key, DIFF_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Retrieve a single user's diff snapshot from the room hash.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userId {number} The ID of the user to look up.
 * @returns {Promise<object | null>} The parsed patch object, or null if missing/expired.
 * @throws {Error} Throws if Redis HGET operation fails (but catches JSON parse errors).
 */
export async function getDiff(
  roomId: string,
  userId: number
): Promise<object | null> {
  const raw = await redisClient.hget(diffsKey(roomId), String(userId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Retrieve all active diffs for a room in a single HGETALL round-trip.
 * Filters to only the provided userIds to avoid returning stale fields.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userIds {number[]} Array of user IDs expected to be in the room.
 * @returns {Promise<Map<number, object>>} Map of user ID to their active patch object.
 * @throws {Error} Throws if Redis HGETALL operation fails.
 */
export async function getAllDiffs(
  roomId: string,
  userIds: number[]
): Promise<Map<number, object>> {
  const result = new Map<number, object>();
  if (userIds.length === 0) return result;

  // Single round-trip: fetch all fields from the room hash
  const all = await redisClient.hgetall(diffsKey(roomId));

  // Build a lookup set for O(1) membership checks
  const wantedIds = new Set(userIds.map(String));

  for (const [field, raw] of Object.entries(all)) {
    if (!wantedIds.has(field)) continue;
    try {
      result.set(Number(field), JSON.parse(raw));
    } catch {
      // Corrupted entry — skip silently
    }
  }

  return result;
}

/**
 * Explicitly delete a user's diff field from the room hash on disconnect.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userId {number} The user ID whose diff should be deleted.
 * @returns {Promise<void>} Resolves when the field is removed.
 * @throws {Error} Throws if Redis HDEL operation fails.
 */
export async function deleteDiff(
  roomId: string,
  userId: number
): Promise<void> {
  await redisClient.hdel(diffsKey(roomId), String(userId));
}
