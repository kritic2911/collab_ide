import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { colorFromUsername } from '../store/collabStore';
import { getUser } from '../hooks/useAuth';
import { colors } from '../ui/styles';

// ──────────────────────────────────────────────
// ChatPanel — collapsible right-edge overlay
//
// Collapsed: floating button with unread badge
// Expanded: 320px panel with message history + input
// Features: pagination (load older), delete own messages
// ──────────────────────────────────────────────

interface ChatPanelProps {
  sendMessage: (msg: any) => void;
  roomId: string | null;
  isConnected: boolean;
}

function initials(username: string): string {
  const p = username.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase() || '?';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function shouldShowDateSeparator(messages: ChatMessage[], index: number): boolean {
  if (index === 0) return true;
  const prev = new Date(messages[index - 1].timestamp).toDateString();
  const curr = new Date(messages[index].timestamp).toDateString();
  return prev !== curr;
}

export default function ChatPanel({ sendMessage, roomId, isConnected }: ChatPanelProps) {
  const messages = useChatStore((s) => s.messages);
  const isOpen = useChatStore((s) => s.isOpen);
  const unreadCount = useChatStore((s) => s.unreadCount);
  const hasOlderMessages = useChatStore((s) => s.hasOlderMessages);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const toggleOpen = useChatStore((s) => s.toggleOpen);

  const [input, setInput] = useState('');
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const currentUser = getUser();

  // Auto-scroll to bottom on new messages (unless user scrolled up)
  useEffect(() => {
    if (isAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isAutoScroll]);

  // Detect if user scrolled up (disable auto-scroll)
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setIsAutoScroll(atBottom);
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !roomId || !isConnected) return;
    sendMessage({ type: 'chat_message', roomId, text });
    setInput('');
    setIsAutoScroll(true);
  }, [input, roomId, isConnected, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Load older messages (pagination)
  const handleLoadOlder = useCallback(() => {
    if (!roomId || !isConnected || loadingOlder || messages.length === 0) return;
    const oldestId = messages[0].id;
    useChatStore.getState().setLoadingOlder(true);
    sendMessage({ type: 'chat_load_older', roomId, beforeId: oldestId });
  }, [roomId, isConnected, loadingOlder, messages, sendMessage]);

  // Delete own message
  const handleDelete = useCallback(
    (messageId: number) => {
      if (!roomId || !isConnected) return;
      sendMessage({ type: 'chat_delete', roomId, messageId });
    },
    [roomId, isConnected, sendMessage]
  );

  // ──────────────────────────────────────────────
  // Collapsed state: floating button
  // ──────────────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        type="button"
        id="chat-toggle-button"
        onClick={toggleOpen}
        style={{
          position: 'absolute',
          bottom: 48,
          right: 16,
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: `1px solid ${colors.border}`,
          background: 'rgba(22, 27, 34, 0.9)',
          backdropFilter: 'blur(14px)',
          color: colors.text,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          zIndex: 20,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.08)';
          e.currentTarget.style.boxShadow = '0 6px 28px rgba(0, 0, 0, 0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.4)';
        }}
      >
        💬
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              minWidth: 20,
              height: 20,
              borderRadius: 10,
              background: '#f85149',
              color: '#fff',
              fontSize: 11,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
              boxShadow: '0 2px 8px rgba(248, 81, 73, 0.5)',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    );
  }

  // ──────────────────────────────────────────────
  // Expanded state: chat panel
  // ──────────────────────────────────────────────
  return (
    <div
      id="chat-panel"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(22, 27, 34, 0.95)',
        backdropFilter: 'blur(14px)',
        borderLeft: `1px solid ${colors.border}`,
        zIndex: 20,
        animation: 'chatSlideIn 0.25s ease',
      }}
    >
      {/* Inline keyframes for slide animation */}
      <style>{`
        @keyframes chatSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          padding: '12px 14px',
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>💬</span>
          <span style={{ fontWeight: 800, fontSize: 13 }}>Chat</span>
          <span style={{ color: colors.muted, fontSize: 11 }}>
            {messages.length > 0 ? `${messages.length} messages` : ''}
          </span>
        </div>
        <button
          type="button"
          id="chat-collapse-button"
          onClick={toggleOpen}
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: 'transparent',
            color: colors.muted,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
          }}
          title="Collapse chat"
        >
          ✕
        </button>
      </div>

      {/* Messages area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {/* Load older messages button */}
        {hasOlderMessages && messages.length > 0 && (
          <button
            type="button"
            id="chat-load-older"
            onClick={handleLoadOlder}
            disabled={loadingOlder}
            style={{
              alignSelf: 'center',
              padding: '6px 16px',
              borderRadius: 12,
              border: `1px solid ${colors.border}`,
              background: 'rgba(255, 255, 255, 0.04)',
              color: colors.muted,
              fontSize: 11,
              fontWeight: 600,
              cursor: loadingOlder ? 'default' : 'pointer',
              marginBottom: 8,
              opacity: loadingOlder ? 0.5 : 1,
              transition: 'background 0.15s ease',
            }}
          >
            {loadingOlder ? 'Loading…' : '↑ Load older messages'}
          </button>
        )}

        {messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.muted,
              fontSize: 12,
              textAlign: 'center',
              padding: 24,
            }}
          >
            No messages yet.
            <br />
            Start the conversation!
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isOwn = currentUser?.userId === msg.userId;
            const showDate = shouldShowDateSeparator(messages, idx);
            const userColor = colorFromUsername(msg.username);
            const isHovered = hoveredMsgId === msg.id;

            return (
              <div key={msg.id}>
                {/* Date separator */}
                {showDate && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      margin: '12px 0 8px',
                    }}
                  >
                    <div style={{ flex: 1, height: 1, background: colors.border }} />
                    <span style={{ color: colors.muted, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {formatDateSeparator(msg.timestamp)}
                    </span>
                    <div style={{ flex: 1, height: 1, background: colors.border }} />
                  </div>
                )}

                {/* Message bubble */}
                <div
                  onMouseEnter={() => setHoveredMsgId(msg.id)}
                  onMouseLeave={() => setHoveredMsgId(null)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: isOwn ? 'rgba(88, 166, 255, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                    marginBottom: 2,
                    position: 'relative',
                  }}
                >
                  {/* Sender info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        border: `2px solid ${userColor}`,
                        background: 'rgba(22, 27, 34, 0.9)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 9,
                        fontWeight: 800,
                        color: colors.text,
                        flexShrink: 0,
                      }}
                    >
                      {initials(msg.username)}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: userColor }}>
                      {isOwn ? 'You' : msg.username}
                    </span>
                    <span style={{ fontSize: 10, color: colors.muted, marginLeft: 'auto' }}>
                      {formatTime(msg.timestamp)}
                    </span>

                    {/* Delete button — only visible on hover for own messages */}
                    {isOwn && isHovered && (
                      <button
                        type="button"
                        onClick={() => handleDelete(msg.id)}
                        title="Delete message"
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 4,
                          border: 'none',
                          background: 'rgba(248, 81, 73, 0.15)',
                          color: colors.danger,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 12,
                          marginLeft: 4,
                          flexShrink: 0,
                          transition: 'background 0.1s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(248, 81, 73, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(248, 81, 73, 0.15)';
                        }}
                      >
                        🗑
                      </button>
                    )}
                  </div>

                  {/* Message text */}
                  <div
                    style={{
                      fontSize: 13,
                      color: colors.text,
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      paddingLeft: 28,
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-to-bottom indicator */}
      {!isAutoScroll && messages.length > 0 && (
        <button
          type="button"
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setIsAutoScroll(true);
          }}
          style={{
            position: 'absolute',
            bottom: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '4px 12px',
            borderRadius: 12,
            border: `1px solid ${colors.border}`,
            background: 'rgba(22, 27, 34, 0.95)',
            color: colors.muted,
            fontSize: 11,
            cursor: 'pointer',
            zIndex: 5,
          }}
        >
          ↓ New messages
        </button>
      )}

      {/* Input bar */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          flexShrink: 0,
          background: 'rgba(13, 17, 23, 0.6)',
        }}
      >
        <textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? 'Type a message...' : 'Connecting...'}
          disabled={!isConnected || !roomId}
          rows={1}
          style={{
            flex: 1,
            padding: '8px 10px',
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: 'rgba(13, 17, 23, 0.8)',
            color: colors.text,
            outline: 'none',
            fontSize: 13,
            resize: 'none',
            lineHeight: 1.4,
            maxHeight: 80,
            fontFamily: 'inherit',
          }}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = 'auto';
            el.style.height = Math.min(el.scrollHeight, 80) + 'px';
          }}
        />
        <button
          type="button"
          id="chat-send-button"
          onClick={handleSend}
          disabled={!input.trim() || !isConnected || !roomId}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            border: 'none',
            background:
              input.trim() && isConnected
                ? 'linear-gradient(135deg, #58a6ff, #2ea043)'
                : 'rgba(255, 255, 255, 0.06)',
            color: input.trim() && isConnected ? '#fff' : colors.muted,
            cursor: input.trim() && isConnected ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            flexShrink: 0,
            transition: 'background 0.15s ease',
          }}
          title="Send (Enter)"
        >
          ↵
        </button>
      </div>
    </div>
  );
}
