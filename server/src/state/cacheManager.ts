import { LRUCache } from './lru.js';
import { redisClient } from './redis.client.js';
import { getFileContent } from '../services/github.service.js';
import { getGithubToken } from '../services/token.service.js';
import { db } from '../db/client.js';

// ──────────────────────────────────────────────
// Cache Manager — L1 → L2 → L3 waterfall
//
//   L1: LRU (in-process)   — sub-ms reads, ~5 MB cap
//   L2: Redis / D2          — ms reads, shared, 24h TTL
//   L3: GitHub API          — slow, rate-limited, authoritative
//
// All calls go through this module. No other code
// should touch Redis base keys or the GitHub fetch
// for base content directly.
// ──────────────────────────────────────────────

/** L1 — in-process LRU. 100 entries × ~50 KB avg ≈ 5 MB */
const l1 = new LRUCache<string, string>(100);

/** Redis key prefix for base content (D2) */
const REDIS_PREFIX = 'base:';

/** TTL for Redis base entries — 24 hours */
const D2_TTL_SECONDS = 86400;

/**
 * Parse a roomId into its constituent parts.
 * Room ID format: `{repoId}:{branch}:{filePath}`
 */
function parseRoomId(roomId: string): {
  repoId: string;
  branch: string;
  filePath: string;
} {
  const firstColon = roomId.indexOf(':');
  const secondColon = roomId.indexOf(':', firstColon + 1);
  return {
    repoId: roomId.substring(0, firstColon),
    branch: roomId.substring(firstColon + 1, secondColon),
    filePath: roomId.substring(secondColon + 1),
  };
}

/**
 * Retrieve the admin's GitHub token for L3 fetches.
 * The admin is the user whose `role = 'admin'` in the DB.
 */
async function getAdminToken(): Promise<string> {
  const result = await db.query<{ id: number }>(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (result.rows.length === 0) {
    throw new Error('No admin user found — cannot fetch from GitHub');
  }
  const token = await getGithubToken(result.rows[0].id);
  if (!token) {
    throw new Error('Admin GitHub token not found');
  }
  return token;
}

/**
 * Resolve the GitHub (owner, repoName) from the numeric repoId
 * stored in `connected_repos`.
 */
async function resolveRepo(repoId: string): Promise<{
  owner: string;
  name: string;
}> {
  const result = await db.query<{ owner: string; name: string }>(
    'SELECT owner, name FROM connected_repos WHERE id = $1',
    [Number(repoId)]
  );
  if (result.rows.length === 0) {
    throw new Error(`connected_repo ${repoId} not found`);
  }
  return result.rows[0];
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Get the base file content for a room, checking L1, L2, and L3 sequentially.
 *
 * @param roomId {string} The unique identifier for the room.
 * @returns {Promise<string | null>} The file content as a string, or null if fetch fails.
 * @throws {Error} Throws if admin user or token is fundamentally missing.
 */
export async function getBase(roomId: string): Promise<string | null> {
  // L1 — in-process LRU
  const l1Hit = l1.get(roomId);
  if (l1Hit !== null) return l1Hit;

  // L2 — Redis
  const redisKey = REDIS_PREFIX + roomId;
  const l2Hit = await redisClient.get(redisKey);
  if (l2Hit !== null) {
    l1.set(roomId, l2Hit); // backfill L1
    return l2Hit;
  }

  // L3 — GitHub API (authoritative source)
  try {
    const { repoId, branch, filePath } = parseRoomId(roomId);
    const token = await getAdminToken();
    const repo = await resolveRepo(repoId);
    const content = await getFileContent(
      token,
      repo.owner,
      repo.name,
      filePath,
      branch
    );

    // Populate both cache layers
    await redisClient.set(redisKey, content, 'EX', D2_TTL_SECONDS);
    l1.set(roomId, content);

    return content;
  } catch (err) {
    console.error(`[CacheManager] L3 fetch failed for ${roomId}:`, err);
    return null;
  }
}

/**
 * Explicitly set the base content for a room in both L1 and L2 caches.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param content {string} The new base file content to cache.
 * @returns {Promise<void>} Resolves when caching is complete.
 * @throws {Error} Throws if Redis SET operation fails.
 */
export async function setBase(
  roomId: string,
  content: string
): Promise<void> {
  const redisKey = REDIS_PREFIX + roomId;
  await redisClient.set(redisKey, content, 'EX', D2_TTL_SECONDS);
  l1.set(roomId, content);
}

/**
 * Invalidate the base content for a room in both L1 and L2 caches.
 *
 * @param roomId {string} The unique identifier for the room to invalidate.
 * @returns {Promise<void>} Resolves when invalidation is complete.
 * @throws {Error} Throws if Redis DEL operation fails.
 */
export async function invalidateBase(roomId: string): Promise<void> {
  const redisKey = REDIS_PREFIX + roomId;
  l1.delete(roomId);
  await redisClient.del(redisKey);
}
