import { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../middleware/requireAuth.js';
import { getGithubToken } from '../services/token.service.js';
import { getBranches, getFileTree, getFileContent } from '../services/github.service.js';
import { db } from '../db/client.js';
import {
  setSnapshot,
  getCachedTree,
  getCachedFile,
  setCachedFile,
  getCacheInfo,
} from '../cache/branchCache.js';

/**
 * Helper: get admin's GitHub token.
 * The admin is the user whose `role = 'admin'` in the DB;
 * their encrypted GitHub token is used for all repo API calls.
 */
async function getAdminGithubToken(): Promise<string> {
  const admin = await db.query<{ id: number }>(
    "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
  );
  if (admin.rows.length === 0) throw new Error('No admin user found');
  const token = await getGithubToken(admin.rows[0].id);
  if (!token) throw new Error('Admin GitHub token not found');
  return token;
}

/**
 * Check if a user can access a specific connected repo.
 * Returns true if visibility='all' OR the user's roles/groups match.
 */
async function canAccess(userId: number, repoId: number): Promise<boolean> {
  const repo = await db.query<{ visibility: string }>(
    'SELECT visibility FROM connected_repos WHERE id = $1',
    [repoId]
  );
  if (repo.rows.length === 0) return false;
  if (repo.rows[0].visibility === 'all') return true;
  const role = await db.query(
    `select role from users where id = $1`,
    [userId]
  )
  if(role.rows[0].role === 'admin')  return true;
  // Check if user matches any access rule via role or group
  const access = await db.query(
    `SELECT 1 FROM repo_access ra
     WHERE ra.repo_id = $1
       AND (
         ra.role_id IN (SELECT role_id FROM user_roles WHERE user_id = $2)
         OR
         ra.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
       )
     LIMIT 1`,
    [repoId, userId]
  );
  return access.rows.length > 0;
}

export const repoRoutes: FastifyPluginAsync = async (app) => {

  /**
   * GET /api/repos — list repos visible to the current user.
   * Admin sees everything; non-admin sees 'all' + repos matching their roles/groups.
   */
  app.get('/api/repos', { preHandler: [requireAuth] }, async (req) => {
    const user = (req as any).user;

    if (user.role === 'admin') {
      const result = await db.query(
        'SELECT * FROM connected_repos ORDER BY connected_at DESC'
      );
      return result.rows;
    }

    // Non-admin: return repos where visibility='all' OR user matches access rules
    const result = await db.query(
      `SELECT DISTINCT cr.* FROM connected_repos cr
       LEFT JOIN repo_access ra ON ra.repo_id = cr.id
       WHERE cr.visibility = 'all'
          OR ra.role_id  IN (SELECT role_id  FROM user_roles  WHERE user_id = $1)
          OR ra.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $1)
       ORDER BY cr.connected_at DESC`,
      [user.userId]
    );
    return result.rows;
  });

  /**
   * GET /api/repos/:id/branches — list branches for a connected repo.
   */
  app.get<{ Params: { id: string } }>(
    '/api/repos/:id/branches',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const repoId = Number(req.params.id);

      if (!(await canAccess(user.userId, repoId))) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const repo = await db.query<{ owner: string; name: string }>(
        'SELECT owner, name FROM connected_repos WHERE id = $1',
        [repoId]
      );
      if (repo.rows.length === 0) {
        return reply.status(404).send({ error: 'Repo not found' });
      }

      const token = await getAdminGithubToken();
      const branches = await getBranches(token, repo.rows[0].owner, repo.rows[0].name);
      return branches;
    }
  );

  /**
   * GET /api/repos/:id/snapshot?branch=X
   *
   * Fetch (or return from cache) the committed file tree for a branch.
   * This seeds the server-side branch cache, establishing the "branch base"
   * that the collaborative editor can diff user edits against.
   *
   * Response:
   *   { cached: boolean, ageMs?: number, fileCount?: number, tree: TreeItem[] }
   */
  app.get<{ Params: { id: string }; Querystring: { branch: string } }>(
    '/api/repos/:id/snapshot',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const repoId = Number(req.params.id);
      const branch = (req.query as any).branch as string;

      if (!branch) {
        return reply.status(400).send({ error: 'branch query param required' });
      }

      if (!(await canAccess(user.userId, repoId))) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      const repo = await db.query<{ owner: string; name: string }>(
        'SELECT owner, name FROM connected_repos WHERE id = $1',
        [repoId]
      );
      if (repo.rows.length === 0) {
        return reply.status(404).send({ error: 'Repo not found' });
      }

      // Check the in-memory cache first — return immediately if still fresh
      const existing = getCachedTree(repoId, branch);
      if (existing) {
        const info = getCacheInfo(repoId, branch);
        return {
          ...(info.cached ? { cached: true, ageMs: info.ageMs, fileCount: info.fileCount } : { cached: false }),
          tree: existing,
        };
      }

      // Cache miss — fetch from GitHub and seed the snapshot
      const token = await getAdminGithubToken();
      const tree = await getFileTree(
        token,
        repo.rows[0].owner,
        repo.rows[0].name,
        branch
      );

      // Seed the cache with the fresh tree (file contents populate lazily)
      setSnapshot(repoId, branch, tree as any);

      return { cached: false, tree };
    }
  );

  /**
   * GET /api/repos/:id/tree?branch=X — file tree for a connected repo.
   * Kept for backwards compatibility; internally delegates to snapshot cache.
   */
  app.get<{ Params: { id: string }; Querystring: { branch: string } }>(
    '/api/repos/:id/tree',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const repoId = Number(req.params.id);
      const branch = (req.query as any).branch;

      if (!branch) {
        return reply.status(400).send({ error: 'branch query param required' });
      }

      if (!(await canAccess(user.userId, repoId))) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Serve from cache when available
      const cached = getCachedTree(repoId, branch);
      if (cached) return cached;

      const repo = await db.query<{ owner: string; name: string }>(
        'SELECT owner, name FROM connected_repos WHERE id = $1',
        [repoId]
      );
      if (repo.rows.length === 0) {
        return reply.status(404).send({ error: 'Repo not found' });
      }

      const token = await getAdminGithubToken();
      const tree = await getFileTree(token, repo.rows[0].owner, repo.rows[0].name, branch);

      // Seed the cache so subsequent /file requests can be served from it
      setSnapshot(repoId, branch, tree as any);

      return tree;
    }
  );

  /**
   * GET /api/repos/:id/file?branch=X&path=Y
   *
   * Returns file content. Checks the branch cache first so repeated opens
   * of the same file don't hit the GitHub API. Content is stored in the
   * snapshot on first fetch — this becomes the "base" for that file.
   */
  app.get<{ Params: { id: string }; Querystring: { branch: string; path: string } }>(
    '/api/repos/:id/file',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const repoId = Number(req.params.id);
      const { branch, path } = req.query as any;

      if (!branch || !path) {
        return reply.status(400).send({ error: 'branch and path query params required' });
      }

      if (!(await canAccess(user.userId, repoId))) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Check the in-memory file cache — return immediately if present
      const cachedContent = getCachedFile(repoId, branch, path);
      if (cachedContent !== null) {
        return { content: cachedContent, cached: true };
      }

      const repo = await db.query<{ owner: string; name: string }>(
        'SELECT owner, name FROM connected_repos WHERE id = $1',
        [repoId]
      );
      if (repo.rows.length === 0) {
        return reply.status(404).send({ error: 'Repo not found' });
      }

      const token = await getAdminGithubToken();
      const content = await getFileContent(
        token,
        repo.rows[0].owner,
        repo.rows[0].name,
        path,
        branch
      );

      // Store in the snapshot so subsequent requests for the same file are free
      setCachedFile(repoId, branch, path, content);

      return { content, cached: false };
    }
  );
};
