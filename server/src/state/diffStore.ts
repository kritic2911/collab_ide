import { redisClient } from './redis.client.js';

// ──────────────────────────────────────────────
// Diff Store (D3) — per-user snapshot of active edits
//
// Storage: Redis HSET
//   Key:    diff:{roomId}:{userId}
//   Field:  "patch"
//   Value:  JSON-stringified Monaco patch array
//   TTL:    60 seconds (rolling, reset on every write)
//
// Design decision (Option B — HSET):
//   One snapshot per user per room. Monaco tracks edit
//   history on the client. The server only needs to know
//   "what does User B's file look like right now?"
//
// Rolling TTL is the dead-man switch: if a socket crashes
// without firing disconnect, the diff auto-expires in 60s.
// ──────────────────────────────────────────────

/** TTL for diff entries — 60 seconds rolling */
const DIFF_TTL_SECONDS = 60;

/** Build the Redis key for a user's diff in a room */
function diffKey(roomId: string, userId: number): string {
  return `diff:${roomId}:${userId}`;
}

/**
 * Store (or overwrite) a user's current diff snapshot with a rolling 60s TTL.
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
  const key = diffKey(roomId, userId);
  const pipeline = redisClient.pipeline();
  pipeline.hset(key, 'patch', JSON.stringify(patch));
  pipeline.expire(key, DIFF_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Retrieve a single user's diff snapshot.
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
  const raw = await redisClient.hget(diffKey(roomId, userId), 'patch');
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Retrieve all active diffs for a room for the provided list of user IDs.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userIds {number[]} Array of user IDs expected to be in the room.
 * @returns {Promise<Map<number, object>>} Map of user ID to their active patch object.
 * @throws {Error} Throws if Redis HGET pipelining fails.
 */
export async function getAllDiffs(
  roomId: string,
  userIds: number[]
): Promise<Map<number, object>> {
  const result = new Map<number, object>();
  if (userIds.length === 0) return result;

  const entries = await Promise.all(
    userIds.map(async (uid) => {
      const raw = await redisClient.hget(diffKey(roomId, uid), 'patch');
      return { uid, raw };
    })
  );

  for (const { uid, raw } of entries) {
    if (raw !== null) {
      try {
        result.set(uid, JSON.parse(raw));
      } catch {
        // Corrupted entry — skip silently
      }
    }
  }

  return result;
}

/**
 * Explicitly delete a user's diff on disconnect.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param userId {number} The user ID whose diff should be deleted.
 * @returns {Promise<void>} Resolves when the key is successfully deleted.
 * @throws {Error} Throws if Redis DEL operation fails.
 */
export async function deleteDiff(
  roomId: string,
  userId: number
): Promise<void> {
  await redisClient.del(diffKey(roomId, userId));
}
