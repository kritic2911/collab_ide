import { colors } from '../ui/styles';

// ──────────────────────────────────────────────
// ConflictPanel — Three-Way Conflict Resolution UI
//
// Shows base (committed), your change, and peer change
// for each conflicting line. Provides resolution buttons:
//   · Keep Mine — accept your version
//   · Keep Theirs — accept peer's version
//   · Edit Manually — dismiss panel, let user resolve in editor
//
// Layout:
//   ╔═══════════════════════════════════════════╗
//   ║  CONFLICT — Lines 42-44                  ║
//   ╠═══════════════════════════════════════════╣
//   ║  Base       │ const timeout = 5000       ║
//   ║  You (blue) │ const timeout = 3000       ║
//   ║  Peer (org) │ const timeout = 10000      ║
//   ╠═══════════════════════════════════════════╣
//   ║  [Keep Mine] [Keep Theirs] [Edit Manual] ║
//   ╚═══════════════════════════════════════════╝
// ──────────────────────────────────────────────

/** Single conflict preview entry */
export interface ConflictPreview {
  startLine: number;
  endLine: number;
  lines: number[];
  preview: { line: number; base: string; userA: string; userB: string }[];
  userA: { userId: string; username: string };
  userB: { userId: string; username: string };
}

interface ConflictPanelProps {
  conflicts: ConflictPreview[];
  myUsername: string;
  onResolve: (
    startLine: number,
    endLine: number,
    resolution: 'keep_mine' | 'keep_theirs' | 'manual'
  ) => void;
  onDismiss: () => void;
}

/** Style constants for the conflict panel */
const panelStyles = {
  container: {
    position: 'fixed' as const,
    bottom: 16,
    right: 16,
    maxWidth: 520,
    maxHeight: '60vh',
    overflowY: 'auto' as const,
    background: 'rgba(22, 27, 34, 0.95)',
    border: `1px solid ${colors.danger}40`,
    borderRadius: 14,
    backdropFilter: 'blur(16px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    zIndex: 1000,
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  header: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: '12px 16px',
    borderBottom: `1px solid ${colors.border}`,
    background: `${colors.danger}15`,
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
    color: colors.danger,
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  dismissBtn: {
    background: 'none',
    border: 'none',
    color: colors.muted,
    fontSize: 16,
    cursor: 'pointer',
    padding: 4,
  },
  conflictCard: {
    padding: '12px 16px',
    borderBottom: `1px solid ${colors.border}`,
  },
  lineLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: colors.muted,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  previewRow: {
    display: 'flex' as const,
    alignItems: 'flex-start' as const,
    gap: 8,
    padding: '4px 0',
    fontSize: 12,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  },
  label: {
    width: 70,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    flexShrink: 0,
    paddingTop: 2,
  },
  code: {
    flex: 1,
    padding: '4px 8px',
    borderRadius: 6,
    fontSize: 12,
    overflowX: 'auto' as const,
    whiteSpace: 'pre' as const,
  },
  actions: {
    display: 'flex' as const,
    gap: 8,
    padding: '8px 16px 12px',
  },
  btn: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
};

/**
 * ConflictPanel — Renders a floating panel with three-way conflict previews
 * and resolution action buttons.
 *
 * @param props {ConflictPanelProps} The conflict data, callbacks, and user context.
 * @returns {JSX.Element} The conflict resolution panel UI.
 */
export default function ConflictPanel({
  conflicts,
  myUsername,
  onResolve,
  onDismiss,
}: ConflictPanelProps) {
  if (conflicts.length === 0) return null;

  return (
    <div style={panelStyles.container}>
      {/* Panel header with conflict count and dismiss button */}
      <div style={panelStyles.header}>
        <span style={panelStyles.title}>
          ⚠ {conflicts.length} Conflict{conflicts.length > 1 ? 's' : ''} Detected
        </span>
        <button
          type="button"
          style={panelStyles.dismissBtn}
          onClick={onDismiss}
          title="Dismiss"
        >
          ✕
        </button>
      </div>

      {/* Render each conflict card */}
      {conflicts.map((c) => {
        const isUserA = c.userA.username === myUsername;
        const myLabel = isUserA ? 'You' : c.userA.username;
        const peerLabel = isUserA ? c.userB.username : 'You';
        const peerColor = isUserA ? '#FF9F43' : colors.brandA;
        const myColor = isUserA ? colors.brandA : '#FF9F43';

        return (
          <div key={`${c.startLine}-${c.endLine}`}>
            <div style={panelStyles.conflictCard}>
              {/* Line range label */}
              <div style={panelStyles.lineLabel}>
                Line{c.lines.length > 1 ? 's' : ''}{' '}
                {c.startLine === c.endLine
                  ? c.startLine
                  : `${c.startLine}–${c.endLine}`}
              </div>

              {/* Three-way preview rows */}
              {c.preview.map((p) => (
                <div key={p.line}>
                  {/* Base version */}
                  <div style={panelStyles.previewRow}>
                    <span style={{ ...panelStyles.label, color: colors.muted }}>
                      Base
                    </span>
                    <code
                      style={{
                        ...panelStyles.code,
                        background: 'rgba(139, 148, 158, 0.08)',
                        color: colors.muted,
                      }}
                    >
                      {p.base || '(empty)'}
                    </code>
                  </div>

                  {/* User A (your) version */}
                  <div style={panelStyles.previewRow}>
                    <span style={{ ...panelStyles.label, color: myColor }}>
                      {myLabel}
                    </span>
                    <code
                      style={{
                        ...panelStyles.code,
                        background: `${myColor}15`,
                        color: colors.text,
                        borderLeft: `3px solid ${myColor}`,
                      }}
                    >
                      {p.userA || '(empty)'}
                    </code>
                  </div>

                  {/* User B (peer) version */}
                  <div style={panelStyles.previewRow}>
                    <span style={{ ...panelStyles.label, color: peerColor }}>
                      {peerLabel}
                    </span>
                    <code
                      style={{
                        ...panelStyles.code,
                        background: `${peerColor}15`,
                        color: colors.text,
                        borderLeft: `3px solid ${peerColor}`,
                      }}
                    >
                      {p.userB || '(empty)'}
                    </code>
                  </div>
                </div>
              ))}
            </div>

            {/* Resolution action buttons */}
            <div style={panelStyles.actions}>
              <button
                type="button"
                style={{
                  ...panelStyles.btn,
                  background: `${colors.brandA}20`,
                  color: colors.brandA,
                }}
                onClick={() => onResolve(c.startLine, c.endLine, 'keep_mine')}
              >
                Keep Mine
              </button>
              <button
                type="button"
                style={{
                  ...panelStyles.btn,
                  background: '#FF9F4320',
                  color: '#FF9F43',
                }}
                onClick={() => onResolve(c.startLine, c.endLine, 'keep_theirs')}
              >
                Keep Theirs
              </button>
              <button
                type="button"
                style={{
                  ...panelStyles.btn,
                  background: colors.bg2,
                  color: colors.muted,
                }}
                onClick={() => onResolve(c.startLine, c.endLine, 'manual')}
              >
                Edit Manually
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
