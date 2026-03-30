import { useEffect, useState } from 'react';
import { fetchWebhookEvents, WebhookEventRow } from '../api/repo';
import { colors, cardStyle } from '../ui/styles';

interface WebhookLogProps {
  repoId: number;
  /** When set, prepend a row from live WS without refetch */
  liveEvent?: {
    id: number;
    event_type: string;
    action: string | null;
    sender_username: string;
    received_at: string;
  } | null;
}

export default function WebhookLog({ repoId, liveEvent }: WebhookLogProps) {
  const [events, setEvents] = useState<WebhookEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWebhookEvents(repoId, 30, 0)
      .then((res) => {
        if (cancelled) return;
        setEvents(res.events);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.response?.data?.error ?? e?.message ?? 'Failed to load events');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoId]);

  useEffect(() => {
    if (!liveEvent) return;
    setEvents((prev) => {
      if (prev.some((e) => e.id === liveEvent.id)) return prev;
      const synthetic: WebhookEventRow = {
        id: liveEvent.id,
        event_type: liveEvent.event_type,
        action: liveEvent.action,
        sender_username: liveEvent.sender_username,
        payload: {},
        received_at: liveEvent.received_at,
      };
      return [synthetic, ...prev];
    });
  }, [liveEvent]);

  return (
    <div style={{ ...cardStyle, padding: 12, maxHeight: 280, overflow: 'auto' }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Webhook activity</div>
      {loading && <div style={{ color: colors.muted, fontSize: 13 }}>Loading…</div>}
      {error && (
        <div style={{ color: colors.danger, fontSize: 13 }}>{error}</div>
      )}
      {!loading && !error && events.length === 0 && (
        <div style={{ color: colors.muted, fontSize: 13 }}>No events yet.</div>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {events.map((ev) => (
          <li
            key={ev.id}
            style={{
              borderBottom: `1px solid ${colors.border}`,
              padding: '8px 0',
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 700 }}>
              {ev.event_type}
              {ev.action ? ` / ${ev.action}` : ''}
            </div>
            <div style={{ color: colors.muted, marginTop: 2 }}>
              {ev.sender_username} · {new Date(ev.received_at).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
