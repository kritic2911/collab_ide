// ──────────────────────────────────────────────
// Conflict Engine — Three-Class Classification
//
// Determines conflict severity when two users edit
// the same file simultaneously. Runs server-side,
// triggered by pubsub.ts on every incoming diff.
//
//   Class 1: ADJACENT       — auto-merge silently
//   Class 2: PARALLEL_INSERT — deterministic merge
//   Class 3: TRUE_CONFLICT   — flag + three-way preview
//
// All functions are pure — no Redis, no side effects.
// ──────────────────────────────────────────────

import type { DiffPatch } from '../ws/ws.types.js';
import {
  getAffectedLines,
  intersection,
  isInsertOnly,
  deterministicOrder,
  buildThreeWayPreview,
  collapseToRanges,
} from './mergeUtils.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/** Classification result for an edit overlap */
export type ConflictClassification =
  | {
      type: 'ADJACENT';
      action: 'AUTO_MERGE';
    }
  | {
      type: 'PARALLEL_INSERT';
      action: 'DETERMINISTIC_MERGE';
      insertOrder: [string, string];
    }
  | {
      type: 'TRUE_CONFLICT';
      action: 'FLAG';
      lines: number[];
      lineRanges: { start: number; end: number }[];
      preview: {
        line: number;
        base: string;
        userA: string;
        userB: string;
      }[];
    };

/** Input shape for a user's diff */
export interface UserDiff {
  userId: string;
  username: string;
  patches: DiffPatch[];
  content: string;
}

// ──────────────────────────────────────────────
// Core Classification
// ──────────────────────────────────────────────

/**
 * Classify the overlap between two users' edits on the same file.
 *
 * Algorithm:
 *   1. Extract affected line ranges from both diffs
 *   2. Compute intersection of ranges
 *   3. If intersection is empty → ADJACENT (auto-merge)
 *   4. If intersection exists AND both are INSERT-only → PARALLEL_INSERT
 *   5. If intersection exists AND either modifies existing content → TRUE_CONFLICT
 *
 * @param baseContent {string} The committed base file content from D2.
 * @param diffA {UserDiff} First user's diff data.
 * @param diffB {UserDiff} Second user's diff data.
 * @returns {ConflictClassification} The classification result with action and data.
 */
export function classifyConflict(
  baseContent: string,
  diffA: UserDiff,
  diffB: UserDiff
): ConflictClassification {
  // Step 1: Extract affected line ranges
  const linesA = getAffectedLines(diffA.patches);
  const linesB = getAffectedLines(diffB.patches);

  // Step 2: Compute intersection
  const overlap = intersection(linesA, linesB);

  // Step 3: No overlap → Adjacent edits (Class 1)
  if (overlap.length === 0) {
    return { type: 'ADJACENT', action: 'AUTO_MERGE' };
  }

  // Step 4: Both are insert-only → Parallel inserts (Class 2)
  if (isInsertOnly(diffA.patches) && isInsertOnly(diffB.patches)) {
    const [first, second] = deterministicOrder(diffA.userId, diffB.userId);
    return {
      type: 'PARALLEL_INSERT',
      action: 'DETERMINISTIC_MERGE',
      insertOrder: [first, second],
    };
  }

  // Step 5: True conflict — overlapping modifications (Class 3)
  const preview = buildThreeWayPreview(
    baseContent,
    diffA.content,
    diffB.content,
    overlap
  );

  return {
    type: 'TRUE_CONFLICT',
    action: 'FLAG',
    lines: overlap,
    lineRanges: collapseToRanges(overlap),
    preview,
  };
}

/**
 * Attempt to auto-merge two adjacent (non-overlapping) edits.
 * Only valid for ADJACENT classification — caller must verify.
 *
 * For adjacent edits, both diffs can be applied to the base
 * independently since they don't touch the same lines.
 *
 * @param baseContent {string} The committed base file content.
 * @param diffA {UserDiff} First user's diff data.
 * @param diffB {UserDiff} Second user's diff data.
 * @returns {string} The merged content with both edits applied.
 */
export function autoMerge(
  baseContent: string,
  diffA: UserDiff,
  diffB: UserDiff
): string {
  // For adjacent edits, choose the most recent content
  // In practice, the client with the latest seq wins,
  // but both edits are valid since they don't overlap.
  // Return the content with the most changes applied.
  const linesA = getAffectedLines(diffA.patches);
  const linesB = getAffectedLines(diffB.patches);

  const baseLines = baseContent.split('\n');
  const aLines = diffA.content.split('\n');
  const bLines = diffB.content.split('\n');

  // Start with base, apply A's changes, then B's changes
  const result = [...baseLines];
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  // Apply whichever user changed each line
  const maxLen = Math.max(result.length, aLines.length, bLines.length);
  const merged: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const ln = i + 1; // 1-indexed
    if (setA.has(ln) && i < aLines.length) {
      merged.push(aLines[i]);
    } else if (setB.has(ln) && i < bLines.length) {
      merged.push(bLines[i]);
    } else if (i < baseLines.length) {
      merged.push(baseLines[i]);
    }
  }

  return merged.join('\n');
}

/**
 * Build a structured resolution preview for a TRUE_CONFLICT.
 * Returns the data needed to render the three-way preview panel.
 *
 * @param baseContent {string} The committed base file content.
 * @param diffA {UserDiff} First user's diff data.
 * @param diffB {UserDiff} Second user's diff data.
 * @param conflictLines {number[]} The overlapping line numbers.
 * @returns {object} Structured preview data for the conflict panel.
 */
export function buildResolutionPreview(
  baseContent: string,
  diffA: UserDiff,
  diffB: UserDiff,
  conflictLines: number[]
): {
  userA: { userId: string; username: string };
  userB: { userId: string; username: string };
  lines: { line: number; base: string; userA: string; userB: string }[];
  lineRanges: { start: number; end: number }[];
} {
  return {
    userA: { userId: diffA.userId, username: diffA.username },
    userB: { userId: diffB.userId, username: diffB.username },
    lines: buildThreeWayPreview(
      baseContent,
      diffA.content,
      diffB.content,
      conflictLines
    ),
    lineRanges: collapseToRanges(conflictLines),
  };
}
