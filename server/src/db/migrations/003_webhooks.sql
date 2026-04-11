-- ============================================================
-- Migration 003: Webhook Events — store GitHub webhook payloads
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id              SERIAL PRIMARY KEY,
  repo_id         INT          NOT NULL REFERENCES connected_repos(id) ON DELETE CASCADE,
  event_type      VARCHAR(50)  NOT NULL,          -- 'push', 'pull_request', etc.
  action          VARCHAR(50),                     -- 'opened', 'closed', 'synchronize', etc.
  sender_username VARCHAR(255) NOT NULL,
  payload         JSONB        NOT NULL DEFAULT '{}',
  received_at     TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Fast lookups: latest events per repo
CREATE INDEX IF NOT EXISTS idx_webhook_events_repo_time
  ON webhook_events(repo_id, received_at DESC);
