import { useEffect, useRef, useState } from 'react';
import { useCollabStore, colorFromUsername } from '../store/collabStore';
import { colors } from '../ui/styles';

// ──────────────────────────────────────────────
// PresenceBar — Live collaborator avatars
//
// Shows who else is editing the current file.
// Tracks last activity per peer and greys out
// avatars after 15s of no diff activity (stale).
//
// Visual states:
//   · Active   — coloured ring, full opacity
//   · Stale    — grey ring, reduced opacity, "(idle)" label
//   · Selected — glow ring, opens diff view
// ──────────────────────────────────────────────

/** Stale threshold — grey out after 15 seconds of no activity */
const STALE_THRESHOLD_MS = 15_000;

/** Polling interval for stale checks */
const STALE_CHECK_INTERVAL_MS = 5_000;

/**
 * Extract initials from a username for avatar badges.
 *
 * @param username {string} The username to extract initials from.
 * @returns {string} 1-2 character uppercase initials.
 */
function initials(username: string): string {
  const p = username.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase() || '?';
}

/**
 * PresenceBar — Renders collaborator avatars with stale detection.
 *
 * Tracks the timestamp of each peer's last diff event. If a peer
 * hasn't sent a diff in 15+ seconds, their avatar is greyed out
 * with an "(idle)" indicator. This prevents phantom peers from
 * crashed sessions appearing as active collaborators.
 *
 * @returns {JSX.Element} The presence bar UI.
 */
export default function PresenceBar() {
  const peers = useCollabStore((s) => s.peers);
  const selectedPeerUsername = useCollabStore((s) => s.selectedPeerUsername);
  const setSelectedPeerUsername = useCollabStore((s) => s.setSelectedPeerUsername);

  // Track last activity timestamp per peer
  const lastActivityRef = useRef<Map<string, number>>(new Map());
  const [, forceRender] = useState(0);

  const list = Array.from(peers.values());

  // Update last activity when peer diffs arrive (seq changes)
  useEffect(() => {
    for (const p of list) {
      if (p.seq > 0) {
        lastActivityRef.current.set(p.username, Date.now());
      }
    }
  }, [list]);

  // Mark presence for peers on join (initial activity)
  useEffect(() => {
    const now = Date.now();
    for (const p of list) {
      if (!lastActivityRef.current.has(p.username)) {
        lastActivityRef.current.set(p.username, now);
      }
    }
    // Clean up departed peers
    for (const key of lastActivityRef.current.keys()) {
      if (!list.some((p) => p.username === key)) {
        lastActivityRef.current.delete(key);
      }
    }
  }, [list]);

  // Periodic check to trigger re-render for stale detection
  useEffect(() => {
    if (list.length === 0) return;
    const interval = setInterval(() => {
      forceRender((n) => n + 1);
    }, STALE_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [list.length]);

  // Empty state when no collaborators
  if (list.length === 0) {
    return (
      <div style={{ color: colors.muted, fontSize: 12, padding: '4px 0' }}>
        No one else in this file yet.
      </div>
    );
  }

  const now = Date.now();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ color: colors.muted, fontSize: 12, fontWeight: 700 }}>Here</span>
      {list.map((p) => {
        const selected = selectedPeerUsername === p.username;
        const color = colorFromUsername(p.username);
        const lastActive = lastActivityRef.current.get(p.username) ?? now;
        const isStale = now - lastActive > STALE_THRESHOLD_MS;

        return (
          <button
            key={p.username}
            type="button"
            title={
              isStale
                ? `${p.username} (idle)`
                : p.username
            }
            onClick={() => setSelectedPeerUsername(selected ? null : p.username)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: `2px solid ${isStale ? colors.muted : color}`,
              background: selected
                ? 'rgba(88, 166, 255, 0.2)'
                : 'rgba(22, 27, 34, 0.9)',
              color: isStale ? colors.muted : colors.text,
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: selected ? `0 0 0 2px ${color}` : 'none',
              opacity: isStale ? 0.45 : 1,
              transition: 'opacity 0.3s ease, border-color 0.3s ease',
              position: 'relative',
            }}
          >
            {initials(p.username)}
            {/* Stale indicator dot */}
            {isStale && (
              <span
                style={{
                  position: 'absolute',
                  bottom: -2,
                  right: -2,
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: colors.muted,
                  border: `2px solid ${colors.bg1}`,
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
