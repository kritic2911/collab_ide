-- ============================================================
-- Migration 003: Branch access control & file hiding
-- ============================================================

-- Allowlist: which branches a role/group can access on a given repo.
-- No rows for a repo = everyone sees all branches (open access).
-- When rows exist, only matching role/group members see listed branches.
CREATE TABLE IF NOT EXISTS branch_access (
  id        SERIAL PRIMARY KEY,
  repo_id   INT NOT NULL REFERENCES connected_repos(id) ON DELETE CASCADE,
  branch    VARCHAR(255) NOT NULL,
  role_id   INT REFERENCES roles(id) ON DELETE CASCADE,
  group_id  INT REFERENCES groups(id) ON DELETE CASCADE,
  CONSTRAINT ba_at_least_one CHECK (role_id IS NOT NULL OR group_id IS NOT NULL)
);

-- Prevent duplicate rules
CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_access_uniq
  ON branch_access (repo_id, branch, COALESCE(role_id, 0), COALESCE(group_id, 0));

CREATE INDEX IF NOT EXISTS idx_branch_access_repo ON branch_access(repo_id);

-- Blocklist: file path patterns to hide from a role/group on a given repo.
-- No rows for a repo = all files visible.
-- Patterns are matched with simple glob logic (e.g. ".env", "secrets/*", "*.key").
CREATE TABLE IF NOT EXISTS hidden_files (
  id        SERIAL PRIMARY KEY,
  repo_id   INT NOT NULL REFERENCES connected_repos(id) ON DELETE CASCADE,
  pattern   VARCHAR(500) NOT NULL,
  role_id   INT REFERENCES roles(id) ON DELETE CASCADE,
  group_id  INT REFERENCES groups(id) ON DELETE CASCADE,
  CONSTRAINT hf_at_least_one CHECK (role_id IS NOT NULL OR group_id IS NOT NULL)
);

-- Prevent duplicate rules
CREATE UNIQUE INDEX IF NOT EXISTS idx_hidden_files_uniq
  ON hidden_files (repo_id, pattern, COALESCE(role_id, 0), COALESCE(group_id, 0));

CREATE INDEX IF NOT EXISTS idx_hidden_files_repo ON hidden_files(repo_id);
