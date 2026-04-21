-- ============================================================
-- Migration 002: Admin Portal — repos, roles, groups, access
-- ============================================================

-- Repos the admin has connected to CollabIDE
CREATE TABLE IF NOT EXISTS connected_repos (
  id             SERIAL PRIMARY KEY,
  github_repo_id BIGINT UNIQUE NOT NULL,
  owner          VARCHAR(255) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  default_branch VARCHAR(255) NOT NULL DEFAULT 'main',
  visibility     VARCHAR(20)  NOT NULL DEFAULT 'all',  -- 'all' | 'restricted'
  connected_at   TIMESTAMP DEFAULT NOW()
);

-- Predefined + custom roles (name is display-only; all logic uses IDs)
CREATE TABLE IF NOT EXISTS roles (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL UNIQUE,
  is_predefined BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- Many-to-many: which users have which roles
CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- Named collections of users
CREATE TABLE IF NOT EXISTS groups (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Many-to-many: which users are in which groups
CREATE TABLE IF NOT EXISTS user_groups (
  user_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id INT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, group_id)
);

-- Which roles/groups can access a restricted repo (union / OR logic)
CREATE TABLE IF NOT EXISTS repo_access (
  id       SERIAL PRIMARY KEY,
  repo_id  INT NOT NULL REFERENCES connected_repos(id) ON DELETE CASCADE,
  role_id  INT REFERENCES roles(id) ON DELETE CASCADE,
  group_id INT REFERENCES groups(id) ON DELETE CASCADE,
  CONSTRAINT at_least_one CHECK (role_id IS NOT NULL OR group_id IS NOT NULL)
);

-- Index for fast access lookups
CREATE INDEX IF NOT EXISTS idx_repo_access_repo ON repo_access(repo_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user  ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups(user_id);

INSERT INTO roles (name, is_predefined) VALUES ('admin', true);
INSERT INTO roles (name, is_predefined) VALUES ('user', true);