import { redisClient } from './redis.client.js';

// ──────────────────────────────────────────────
// Conflict Store — Redis persistence for conflict state
//
// Two Redis Hash keys per room:
//
//   conflict:{roomId}
//     Fields: lineRange → JSON { type, lines, preview, detectedAt }
//     TTL: 30 minutes (idle session expiry)
//
//   resolution_history:{roomId}
//     Fields: conflictHash → JSON { resolution, resolvedBy, resolvedAt }
//     TTL: 2 hours (session memory for auto-apply)
//
// Mirrors the pattern established by diffStore.ts.
// ──────────────────────────────────────────────

/** TTL for active conflict entries — 30 minutes */
const CONFLICT_TTL_SECONDS = 1800;

/** TTL for resolution history — 2 hours */
const HISTORY_TTL_SECONDS = 7200;

/** Build the Redis key for active conflicts in a room */
function conflictKey(roomId: string): string {
  return `conflict:${roomId}`;
}

/** Build the Redis key for resolution history in a room */
function historyKey(roomId: string): string {
  return `resolution_history:${roomId}`;
}

/** Build a deterministic field key from a line range */
function rangeField(startLine: number, endLine: number): string {
  return `L${startLine}-L${endLine}`;
}

// ──────────────────────────────────────────────
// Active Conflict Operations
// ──────────────────────────────────────────────

/**
 * Conflict data shape stored in Redis.
 */
export interface ConflictRecord {
  type: 'TRUE_CONFLICT';
  lines: number[];
  lineRanges: { start: number; end: number }[];
  preview: { line: number; base: string; userA: string; userB: string }[];
  userA: { userId: string; username: string };
  userB: { userId: string; username: string };
  detectedAt: number;
}

/**
 * Resolution record stored in history.
 */
export interface ResolutionRecord {
  resolution: 'keep_mine' | 'keep_theirs' | 'manual';
  resolvedBy: string;
  resolvedAt: number;
  lineRange: string;
}

/**
 * Store a detected conflict in Redis.
 * Overwrites any existing conflict at the same line range.
 *
 * @param roomId {string} The room where the conflict occurred.
 * @param startLine {number} Start line of the conflict range.
 * @param endLine {number} End line of the conflict range.
 * @param data {ConflictRecord} The full conflict data to persist.
 * @returns {Promise<void>}
 */
export async function setConflict(
  roomId: string,
  startLine: number,
  endLine: number,
  data: ConflictRecord
): Promise<void> {
  const key = conflictKey(roomId);
  const field = rangeField(startLine, endLine);
  const pipeline = redisClient.pipeline();
  pipeline.hset(key, field, JSON.stringify(data));
  pipeline.expire(key, CONFLICT_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Resolve a conflict and move it to resolution history.
 * Removes the conflict from the active set and records the decision.
 *
 * @param roomId {string} The room where the conflict was.
 * @param startLine {number} Start line of the resolved range.
 * @param endLine {number} End line of the resolved range.
 * @param resolution {ResolutionRecord} The resolution decision.
 * @returns {Promise<void>}
 */
export async function resolveConflict(
  roomId: string,
  startLine: number,
  endLine: number,
  resolution: ResolutionRecord
): Promise<void> {
  const cKey = conflictKey(roomId);
  const hKey = historyKey(roomId);
  const field = rangeField(startLine, endLine);

  const pipeline = redisClient.pipeline();
  // Remove from active conflicts
  pipeline.hdel(cKey, field);
  // Add to resolution history
  pipeline.hset(hKey, field, JSON.stringify(resolution));
  pipeline.expire(hKey, HISTORY_TTL_SECONDS);
  await pipeline.exec();
}

/**
 * Get all active (unresolved) conflicts for a room.
 *
 * @param roomId {string} The room to query.
 * @returns {Promise<Map<string, ConflictRecord>>} Map of range field → conflict data.
 */
export async function getActiveConflicts(
  roomId: string
): Promise<Map<string, ConflictRecord>> {
  const all = await redisClient.hgetall(conflictKey(roomId));
  const result = new Map<string, ConflictRecord>();

  for (const [field, raw] of Object.entries(all)) {
    try {
      result.set(field, JSON.parse(raw) as ConflictRecord);
    } catch {
      // Corrupted entry — skip silently
    }
  }

  return result;
}

/**
 * Get resolution history for a room.
 * Used to auto-apply prior decisions if the same conflict recurs.
 *
 * @param roomId {string} The room to query.
 * @returns {Promise<Map<string, ResolutionRecord>>} Map of range field → resolution data.
 */
export async function getResolutionHistory(
  roomId: string
): Promise<Map<string, ResolutionRecord>> {
  const all = await redisClient.hgetall(historyKey(roomId));
  const result = new Map<string, ResolutionRecord>();

  for (const [field, raw] of Object.entries(all)) {
    try {
      result.set(field, JSON.parse(raw) as ResolutionRecord);
    } catch {
      // Corrupted entry — skip silently
    }
  }

  return result;
}

/**
 * Clear all conflicts for a room (e.g., on file close or base update).
 *
 * @param roomId {string} The room to clear.
 * @returns {Promise<void>}
 */
export async function clearConflicts(roomId: string): Promise<void> {
  await redisClient.del(conflictKey(roomId));
}
