import { useCollabStore, colorFromUsername } from '../store/collabStore';
import { colors } from '../ui/styles';

function initials(username: string): string {
  const p = username.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase() || '?';
}

export default function PresenceBar() {
  const peers = useCollabStore((s) => s.peers);
  const selectedPeerUsername = useCollabStore((s) => s.selectedPeerUsername);
  const setSelectedPeerUsername = useCollabStore((s) => s.setSelectedPeerUsername);

  const list = Array.from(peers.values());

  if (list.length === 0) {
    return (
      <div style={{ color: colors.muted, fontSize: 12, padding: '4px 0' }}>
        No one else in this file yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ color: colors.muted, fontSize: 12, fontWeight: 700 }}>Here</span>
      {list.map((p) => {
        const selected = selectedPeerUsername === p.username;
        const color = colorFromUsername(p.username);
        return (
          <button
            key={p.username}
            type="button"
            title={p.username}
            onClick={() => setSelectedPeerUsername(selected ? null : p.username)}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: `2px solid ${color}`,
              background: selected ? 'rgba(88, 166, 255, 0.2)' : 'rgba(22, 27, 34, 0.9)',
              color: colors.text,
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: selected ? `0 0 0 2px ${color}` : 'none',
            }}
          >
            {initials(p.username)}
          </button>
        );
      })}
    </div>
  );
}

