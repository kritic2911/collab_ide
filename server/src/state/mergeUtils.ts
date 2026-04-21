// ──────────────────────────────────────────────
// Merge Utilities — Pure functions for conflict math
//
// No Redis, no side effects. These are the low-level
// building blocks used by conflictEngine.ts.
//
// Line-range intersection, deterministic ordering,
// and three-way preview construction.
// ──────────────────────────────────────────────

import type { DiffPatch } from '../ws/ws.types.js';

/**
 * Represents a contiguous range of affected lines.
 */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * Extract the set of affected line numbers from a DiffPatch array.
 * Returns a sorted, deduplicated array of 1-indexed line numbers.
 *
 * @param patches {DiffPatch[]} Array of Monaco-style edit patches.
 * @returns {number[]} Sorted array of unique line numbers touched by the patches.
 */
export function getAffectedLines(patches: DiffPatch[]): number[] {
  const lines = new Set<number>();
  for (const p of patches) {
    const start = Math.min(p.range.startLineNumber, p.range.endLineNumber);
    const end = Math.max(p.range.startLineNumber, p.range.endLineNumber);
    for (let ln = start; ln <= end; ln++) {
      lines.add(ln);
    }
    // Insertions at a point still affect the target line
    if (start === end && p.text.includes('\n')) {
      lines.add(start);
    }
  }
  return Array.from(lines).sort((a, b) => a - b);
}

/**
 * Compute the intersection of two sorted line arrays.
 * Returns the line numbers present in both arrays.
 *
 * @param linesA {number[]} Sorted line numbers from diff A.
 * @param linesB {number[]} Sorted line numbers from diff B.
 * @returns {number[]} Array of line numbers present in both inputs.
 */
export function intersection(linesA: number[], linesB: number[]): number[] {
  const setB = new Set(linesB);
  return linesA.filter((ln) => setB.has(ln));
}

/**
 * Determine if a patch array consists entirely of insertions
 * (no deletions or modifications of existing content).
 *
 * @param patches {DiffPatch[]} Array of patches to evaluate.
 * @returns {boolean} True if all patches are pure insertions.
 */
export function isInsertOnly(patches: DiffPatch[]): boolean {
  return patches.every(
    (p) => p.rangeLength === 0 && p.text.length > 0
  );
}

/**
 * Deterministic ordering for parallel inserts.
 * Lower userId string sorts first — consistent across all clients.
 *
 * @param userIdA {string} First user's identifier.
 * @param userIdB {string} Second user's identifier.
 * @returns {[string, string]} Ordered tuple [first, second].
 */
export function deterministicOrder(
  userIdA: string,
  userIdB: string
): [string, string] {
  return userIdA.localeCompare(userIdB) <= 0
    ? [userIdA, userIdB]
    : [userIdB, userIdA];
}

/**
 * Extract specific lines from a content string by 1-indexed line numbers.
 *
 * @param content {string} The full file content.
 * @param lineNumbers {number[]} 1-indexed line numbers to extract.
 * @returns {Map<number, string>} Map of line number to line content.
 */
export function extractLines(
  content: string,
  lineNumbers: number[]
): Map<number, string> {
  const allLines = content.split('\n');
  const result = new Map<number, string>();
  for (const ln of lineNumbers) {
    // 1-indexed → 0-indexed
    if (ln >= 1 && ln <= allLines.length) {
      result.set(ln, allLines[ln - 1]);
    }
  }
  return result;
}

/**
 * Build a three-way preview payload for a set of conflicting lines.
 * Shows the base content, User A's version, and User B's version
 * for each conflicting line.
 *
 * @param baseContent {string} The committed base file content.
 * @param contentA {string} User A's current file content.
 * @param contentB {string} User B's current file content.
 * @param conflictLines {number[]} Line numbers where the conflict occurs.
 * @returns {Array} Array of per-line preview objects.
 */
export function buildThreeWayPreview(
  baseContent: string,
  contentA: string,
  contentB: string,
  conflictLines: number[]
): {
  line: number;
  base: string;
  userA: string;
  userB: string;
}[] {
  const baseLines = extractLines(baseContent, conflictLines);
  const aLines = extractLines(contentA, conflictLines);
  const bLines = extractLines(contentB, conflictLines);

  return conflictLines.map((ln) => ({
    line: ln,
    base: baseLines.get(ln) ?? '',
    userA: aLines.get(ln) ?? '',
    userB: bLines.get(ln) ?? '',
  }));
}

/**
 * Collapse an array of individual line numbers into
 * contiguous LineRange segments for display purposes.
 *
 * Example: [1, 2, 3, 7, 8, 12] → [{start:1, end:3}, {start:7, end:8}, {start:12, end:12}]
 *
 * @param lines {number[]} Sorted array of line numbers.
 * @returns {LineRange[]} Array of contiguous ranges.
 */
export function collapseToRanges(lines: number[]): LineRange[] {
  if (lines.length === 0) return [];

  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: LineRange[] = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push({ start, end });
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push({ start, end });
  return ranges;
}
