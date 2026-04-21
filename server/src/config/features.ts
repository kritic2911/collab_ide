// ──────────────────────────────────────────────
// Feature Flags — runtime toggles for new behaviour
//
// All flags default to their production-intended value.
// Flip to false to revert to the legacy code path.
// ──────────────────────────────────────────────

export const FEATURES = {
  /**
   * When true, diffs are stored in a single Redis Hash per room
   * (`diffs:{roomId}` with userId fields) instead of individual
   * keys per user (`diff:{roomId}:{userId}`).
   *
   * This eliminates the KEYS scan and enables atomic HGETALL
   * retrieval of all room diffs in one round-trip.
   */
  REDIS_HASH_DIFFS: true,
} as const;
