/**
 * In-memory branch snapshot cache.
 *
 * Stores the committed file tree and lazily-populated file contents
 * for each (repoId, branch) pair. File contents are populated on first
 * access and kept for the duration of the TTL — this gives us the
 * "branch base" state that a collaborative editor can diff against.
 *
 * Uses plain JS Maps (no Redis) per the MVP design in README.md.
 * TTL defaults to 5 minutes; stale entries are evicted on next access.
 */

/** A single item from the GitHub git-tree response */
export interface TreeItem {
  path: string;
  type: string; // 'blob' | 'tree'
  sha?: string;
}

/** Everything cached for one repo + branch combination */
interface BranchSnapshot {
  tree: TreeItem[];
  /** path → decoded UTF-8 file content (populated lazily on first open) */
  files: Map<string, string>;
  fetchedAt: number;
}

/** Cache TTL in milliseconds (5 minutes) */
const TTL_MS = 5 * 60 * 1_000;

/** Primary cache store: `"repoId:branch"` → snapshot */
const _cache = new Map<string, BranchSnapshot>();

/** Build the string key used for all cache lookups */
function key(repoId: number, branch: string): string {
  return `${repoId}:${branch}`;
}

/**
 * Return a live snapshot or null if the entry is absent / stale.
 * Stale entries are deleted on access (lazy eviction).
 */
function getSnapshot(repoId: number, branch: string): BranchSnapshot | null {
  const snap = _cache.get(key(repoId, branch));
  if (!snap) return null;
  if (Date.now() - snap.fetchedAt > TTL_MS) {
    _cache.delete(key(repoId, branch));
    return null;
  }
  return snap;
}

/**
 * Seed or refresh the cache with a freshly-fetched file tree.
 * Resets the file-content sub-map so stale content is not served.
 */
export function setSnapshot(repoId: number, branch: string, tree: TreeItem[]): void {
  _cache.set(key(repoId, branch), {
    tree,
    files: new Map(),
    fetchedAt: Date.now(),
  });
}

/**
 * Return the cached tree for a branch, or null on a cache miss.
 */
export function getCachedTree(repoId: number, branch: string): TreeItem[] | null {
  return getSnapshot(repoId, branch)?.tree ?? null;
}

/**
 * Return a cached file's content, or null if not yet populated.
 */
export function getCachedFile(
  repoId: number,
  branch: string,
  path: string
): string | null {
  return getSnapshot(repoId, branch)?.files.get(path) ?? null;
}

/**
 * Store a file's content inside an existing snapshot.
 * No-op if the snapshot has already expired.
 */
export function setCachedFile(
  repoId: number,
  branch: string,
  path: string,
  content: string
): void {
  getSnapshot(repoId, branch)?.files.set(path, content);
}

/**
 * Return metadata about the current cache entry (for the API response).
 * Returns null if no valid entry exists.
 */
export function getCacheInfo(
  repoId: number,
  branch: string
): { cached: true; fileCount: number; ageMs: number } | { cached: false } {
  const snap = getSnapshot(repoId, branch);
  if (!snap) return { cached: false };
  return {
    cached: true,
    fileCount: snap.files.size,
    ageMs: Date.now() - snap.fetchedAt,
  };
}

/**
 * Manually invalidate a cache entry (e.g. after a push event, future use).
 */
export function invalidate(repoId: number, branch: string): void {
  _cache.delete(key(repoId, branch));
}
