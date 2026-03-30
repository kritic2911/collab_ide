import api from './client';

export interface WebhookEventRow {
  id: number;
  event_type: string;
  action: string | null;
  sender_username: string;
  payload: Record<string, unknown>;
  received_at: string;
}

export interface WebhookEventsResponse {
  events: WebhookEventRow[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchWebhookEvents(
  repoId: number,
  limit = 20,
  offset = 0
): Promise<WebhookEventsResponse> {
  const { data } = await api.get<WebhookEventsResponse>(`/api/repos/${repoId}/events`, {
    params: { limit, offset },
  });
  return data;
}
