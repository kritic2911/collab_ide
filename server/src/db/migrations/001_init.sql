CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  github_id     VARCHAR(255) UNIQUE NOT NULL,
  username      VARCHAR(255) NOT NULL,
  avatar_url    TEXT,
  color_hex     VARCHAR(7)   NOT NULL,
  role          VARCHAR(10)  NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  github_token  TEXT,                                   -- AES-256 encrypted, admin only
  created_at    TIMESTAMP    DEFAULT NOW(),
  updated_at    TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organizations (
  id         SERIAL PRIMARY KEY,
  code_hash  VARCHAR(255) NOT NULL,                     -- bcrypt hash of the org code
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed the org code on first setup:
-- Run this from a script or manually:
--   INSERT INTO organizations (code_hash) VALUES ('<bcrypt hash of your org code>');
-- Or set the ORG_CODE env variable and the server will seed it automatically on startup.