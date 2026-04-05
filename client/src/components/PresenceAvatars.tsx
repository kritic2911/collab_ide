import { useState, useRef, useEffect } from 'react';
import { colors } from '../ui/styles';
import { usePresenceStore } from '../hooks/usePresence';

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

interface Props {
  currentUsername: string;
  selectedPeer: string | null;
  onSelectPeer: (username: string) => void;
}

export default function PresenceAvatars({ currentUsername, selectedPeer, onSelectPeer }: Props) {
  const peers = usePresenceStore((s) => s.peers);
  const roomId = usePresenceStore((s) => s.currentRoomId);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!roomId || peers.length === 0) return null;

  const otherPeers = peers.filter((p) => p.username !== currentUsername);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        id="presence-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: open ? 'rgba(88,166,255,0.12)' : 'transparent',
          border: `1px solid ${open ? 'rgba(88,166,255,0.3)' : 'transparent'}`,
          borderRadius: 8,
          padding: '4px 10px',
          cursor: 'pointer',
          color: colors.text,
          transition: 'all 0.2s',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row-reverse' }}>
          {peers.slice(0, 4).map((peer, i) => (
            <div
              key={peer.username}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                overflow: 'hidden',
                border: `2px solid ${colors.bg1}`,
                marginLeft: i === 0 ? 0 : -6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 9,
                fontWeight: 700,
                color: '#fff',
                background: peer.avatarUrl
                  ? `url(${peer.avatarUrl}) center/cover no-repeat`
                  : hashColor(peer.username),
                zIndex: peers.length - i,
              }}
            >
              {!peer.avatarUrl && getInitial(peer.username)}
            </div>
          ))}
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.muted }}>
          {peers.length} {peers.length === 1 ? 'viewer' : 'viewers'}
        </span>
        <span
          style={{
            fontSize: 10,
            color: colors.muted,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 240,
            background: 'rgba(22, 27, 34, 0.96)',
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: 6,
            backdropFilter: 'blur(16px)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            zIndex: 100,
          }}
        >
          <div
            style={{
              padding: '6px 10px',
              fontSize: 11,
              fontWeight: 700,
              color: colors.muted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Peers in this file
          </div>

          {otherPeers.length === 0 ? (
            <div style={{ padding: '12px 10px', fontSize: 12, color: colors.muted, textAlign: 'center' }}>
              You're the only one here
            </div>
          ) : (
            otherPeers.map((peer) => {
              const isSelected = selectedPeer === peer.username;
              return (
                <button
                  key={peer.username}
                  onClick={() => {
                    onSelectPeer(peer.username);
                    setOpen(false);
                  }}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: 'none',
                    background: isSelected ? 'rgba(88,166,255,0.14)' : 'transparent',
                    color: isSelected ? colors.brandA : colors.text,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#fff',
                      background: peer.avatarUrl
                        ? `url(${peer.avatarUrl}) center/cover no-repeat`
                        : hashColor(peer.username),
                      flexShrink: 0,
                    }}
                  >
                    {!peer.avatarUrl && getInitial(peer.username)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {peer.username}
                    </div>
                    <div style={{ fontSize: 11, color: colors.muted }}>
                      {isSelected ? 'Viewing code' : 'Click to view code'}
                    </div>
                  </div>
                  {isSelected && (
                    <div style={{ marginLeft: 'auto', fontSize: 10, color: colors.brandA }}>●</div>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
