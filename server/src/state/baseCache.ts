// ──────────────────────────────────────────────
// Base Cache (D2) — Thin wrapper
//
// Translates roomIds into Redis key format and
// delegates all work to cacheManager.ts.
//
// Redis key format: base:{repoId}:{branch}:{filePath}
// TTL: 24 hours (EX 86400), refreshed on webhook push.
// ──────────────────────────────────────────────

import {
  getBase as managerGetBase,
  setBase as managerSetBase,
  invalidateBase as managerInvalidateBase,
} from './cacheManager.js';

/**
 * Get the committed (base) file content for a room.
 * Handles fallthrough: L1 → L2 (Redis) → L3 (GitHub).
 *
 * @param roomId {string} The unique identifier for the room.
 * @returns {Promise<string | null>} The base file content, or null if fetch fails.
 * @throws {Error} Throws if underlying request mechanisms fail.
 */
export async function getBase(roomId: string): Promise<string | null> {
  return managerGetBase(roomId);
}

/**
 * Set the base content for a room.
 * Populates both L1 and L2 caches.
 *
 * @param roomId {string} The unique identifier for the room.
 * @param content {string} The new document content.
 * @returns {Promise<void>} Resolves when the content is cached.
 * @throws {Error} Throws if backend cache update fails.
 */
export async function setBase(
  roomId: string,
  content: string
): Promise<void> {
  return managerSetBase(roomId, content);
}

/**
 * Invalidate the base for a room.
 * Clears L1 and L2 — next read will refetch from GitHub.
 *
 * @param roomId {string} The unique identifier for the room.
 * @returns {Promise<void>} Resolves when the cache is cleared.
 * @throws {Error} Throws if backend cache deletion fails.
 */
export async function invalidateBase(roomId: string): Promise<void> {
  return managerInvalidateBase(roomId);
}
