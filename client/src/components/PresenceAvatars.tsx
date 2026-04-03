import { colors } from '../ui/styles';
import { usePresenceStore } from '../hooks/usePresence';
import type { Peer } from '../hooks/useWebSocket';

// Vivid colors for peer avatars (deterministic by username hash)
const PEER_COLORS = [
  '#58a6ff', '#3fb950', '#d2a8ff', '#f0883e', '#ff7b72',
  '#79c0ff', '#56d364', '#e2c5ff', '#ffa657', '#ffa198',
  '#a5d6ff', '#7ee787', '#f2cc60', '#db61a2', '#39d353',
];

function hashColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = (h * 31 + username.charCodeAt(i)) | 0;
  }
  return PEER_COLORS[Math.abs(h) % PEER_COLORS.length];
}

function getInitial(username: string): string {
  return username.charAt(0).toUpperCase();
}

export default function PresenceAvatars() {
  const peers = usePresenceStore((s) => s.peers);
  const roomId = usePresenceStore((s) => s.currentRoomId);

  if (!roomId || peers.length === 0) return null;

  return (
    <div
      id="presence-avatars"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0, // overlap
      }}
    >
      {/* Peer count badge */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: colors.muted,
          marginRight: 8,
          whiteSpace: 'nowrap',
        }}
      >
        {peers.length === 1 ? '1 viewer' : `${peers.length} viewers`}
      </span>

      {/* Avatar stack */}
      <div style={{ display: 'flex', flexDirection: 'row-reverse' }}>
        {peers.slice(0, 8).map((peer, i) => (
          <div
            key={peer.username}
            title={peer.username}
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              overflow: 'hidden',
              border: `2px solid ${colors.bg1}`,
              marginLeft: i === 0 ? 0 : -8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: '#fff',
              background: peer.avatarUrl
                ? `url(${peer.avatarUrl}) center/cover no-repeat`
                : hashColor(peer.username),
              position: 'relative',
              zIndex: peers.length - i,
              cursor: 'default',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              boxShadow: '0 0 0 0 transparent',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1.2)';
              (e.currentTarget as HTMLElement).style.boxShadow = `0 0 8px ${hashColor(peer.username)}80`;
              (e.currentTarget as HTMLElement).style.zIndex = '100';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 0 transparent';
              (e.currentTarget as HTMLElement).style.zIndex = String(peers.length - i);
            }}
          >
            {!peer.avatarUrl && getInitial(peer.username)}
          </div>
        ))}
      </div>

      {/* Overflow indicator */}
      {peers.length > 8 && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: colors.muted,
            marginLeft: 4,
          }}
        >
          +{peers.length - 8}
        </span>
      )}
    </div>
  );
}
