-- ============================================================
-- Migration 005: Chat Messages — encrypted at rest
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_messages (
  id             SERIAL PRIMARY KEY,
  room_id        VARCHAR(500)  NOT NULL,   -- "repoId:branch:filePath"
  user_id        INT           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username       VARCHAR(255)  NOT NULL,   -- denormalized for fast reads
  avatar_url     TEXT,                     -- denormalized for fast reads
  message_enc    TEXT          NOT NULL,   -- AES-256-CBC encrypted (iv:ciphertextHex)
  created_at     TIMESTAMP     DEFAULT NOW()
);

-- Primary query: "last 7 days of messages for a room, newest last"
CREATE INDEX IF NOT EXISTS idx_chat_room_time ON chat_messages(room_id, created_at DESC);

-- Secondary: cleanup or admin queries by user
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id);
