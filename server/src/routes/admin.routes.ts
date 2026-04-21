import { FastifyPluginAsync } from 'fastify';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getGithubToken } from '../services/token.service.js';
import { listUserRepos } from '../services/github.service.js';
import { db } from '../db/client.js';

// ──────────────────────────────────────────────
// Helper: find which user is the admin (has stored GitHub token)
// ──────────────────────────────────────────────
async function getAdminToken(req: any): Promise<string> {
  const token = await getGithubToken(req.user.userId);
  if (!token) throw new Error('Admin GitHub token not found');
  return token;
}

export const adminRoutes: FastifyPluginAsync = async (app) => {

  // ═══════════════════════════════════════════════
  // GITHUB — list admin's repos for connecting
  // ═══════════════════════════════════════════════
  app.get('/api/admin/github/repos', { preHandler: [requireAdmin] }, async (req, reply) => {
    try {
      const token = await getAdminToken(req);
      const repos = await listUserRepos(token);
      return repos;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════
  // REPOS — connect / disconnect / list
  // ═══════════════════════════════════════════════

  /** List all connected repos (admin view — includes access settings) */
  app.get('/api/admin/repos', { preHandler: [requireAdmin] }, async (_req, reply) => {
    try {
      const result = await db.query(`
        SELECT cr.*,
          COALESCE(
            json_agg(
              json_build_object('role_id', ra.role_id, 'group_id', ra.group_id)
            ) FILTER (WHERE ra.id IS NOT NULL),
            '[]'
          ) AS access_rules
        FROM connected_repos cr
        LEFT JOIN repo_access ra ON ra.repo_id = cr.id
        GROUP BY cr.id
        ORDER BY cr.connected_at DESC
      `);
      return result.rows;
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /** Connect a repo */
  app.post<{
    Body: { github_repo_id: number; owner: string; name: string; default_branch: string };
  }>('/api/admin/repos', { preHandler: [requireAdmin] }, async (req, reply) => {
    const { github_repo_id, owner, name, default_branch } = req.body;
    try {
      let webhookId: number | null = null;
      try {
        const token = await getAdminToken(req);
        // Ngrok or internet-accessible URL for webhooks
        const webhookUrl = process.env.WEBHOOK_TARGET_URL || 'http://localhost:3000/webhooks/github';
        const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

        if (webhookSecret) {
          const res = await fetch(`https://api.github.com/repos/${owner}/${name}/hooks`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github.v3+json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: 'web',
              active: true,
              events: ['push'],
              config: {
                url: webhookUrl,
                content_type: 'json',
                secret: webhookSecret,
                insecure_ssl: '0'
              }
            })
          });

          if (res.ok) {
            const data = (await res.json()) as { id: number };
            webhookId = data.id;
          } else {
            req.server.log.error('Failed to register webhook on GitHub: ' + await res.text());
          }
        }
      } catch (err: any) {
        req.server.log.error('Failed to register webhook on GitHub: ' + err.message);
      }

      const result = await db.query(
        `INSERT INTO connected_repos (github_repo_id, owner, name, default_branch, webhook_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (github_repo_id) DO NOTHING
         RETURNING *`,
        [github_repo_id, owner, name, default_branch || 'main', webhookId]
      );

      if (result.rows.length === 0) {
        return reply.status(409).send({ error: 'Repo already connected' });
      }
      return reply.status(201).send(result.rows[0]);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /** Disconnect a repo */
  app.delete<{ Params: { id: string } }>(
    '/api/admin/repos/:id',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { id } = req.params;
      const result = await db.query('DELETE FROM connected_repos WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) {
        return reply.status(404).send({ error: 'Repo not found' });
      }
      return { deleted: true };
    }
  );

  // ═══════════════════════════════════════════════
  // ACCESS — set visibility + role/group restrictions
  // ═══════════════════════════════════════════════

  /** Update repo visibility and access rules */
  app.put<{
    Params: { id: string };
    Body: { visibility: 'all' | 'restricted'; role_ids?: number[]; group_ids?: number[] };
  }>('/api/admin/repos/:id/access', { preHandler: [requireAdmin] }, async (req, reply) => {
    const { id } = req.params;
    const { visibility, role_ids = [], group_ids = [] } = req.body;

    try {
      // Update visibility
      const updated = await db.query(
        'UPDATE connected_repos SET visibility = $1 WHERE id = $2 RETURNING id',
        [visibility, id]
      );
      if (updated.rows.length === 0) {
        return reply.status(404).send({ error: 'Repo not found' });
      }

      // Replace access rules: delete old, insert new
      await db.query('DELETE FROM repo_access WHERE repo_id = $1', [id]);

      if (visibility === 'restricted') {
        for (const roleId of role_ids) {
          await db.query(
            'INSERT INTO repo_access (repo_id, role_id) VALUES ($1, $2)',
            [id, roleId]
          );
        }
        for (const groupId of group_ids) {
          await db.query(
            'INSERT INTO repo_access (repo_id, group_id) VALUES ($1, $2)',
            [id, groupId]
          );
        }
      }

      return { updated: true };
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // ═══════════════════════════════════════════════
  // ROLES — list / create
  // ═══════════════════════════════════════════════

  app.get('/api/admin/roles', { preHandler: [requireAdmin] }, async () => {
    const result = await db.query('SELECT * FROM roles ORDER BY is_predefined DESC, name ASC');
    return result.rows;
  });

  app.post<{ Body: { name: string } }>(
    '/api/admin/roles',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { name } = req.body;
      if (!name?.trim()) {
        return reply.status(400).send({ error: 'Role name is required' });
      }
      try {
        const result = await db.query(
          'INSERT INTO roles (name, is_predefined) VALUES ($1, false) RETURNING *',
          [name.trim()]
        );
        return reply.status(201).send(result.rows[0]);
      } catch (err: any) {
        if (err.code === '23505') {
          return reply.status(409).send({ error: 'Role already exists' });
        }
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // ═══════════════════════════════════════════════
  // GROUPS — list / create
  // ═══════════════════════════════════════════════

  app.get('/api/admin/groups', { preHandler: [requireAdmin] }, async () => {
    const result = await db.query(`
      SELECT g.*,
        COALESCE(
          json_agg(
            json_build_object('user_id', ug.user_id)
          ) FILTER (WHERE ug.user_id IS NOT NULL),
          '[]'
        ) AS members
      FROM groups g
      LEFT JOIN user_groups ug ON ug.group_id = g.id
      GROUP BY g.id
      ORDER BY g.name ASC
    `);
    return result.rows;
  });

  app.post<{ Body: { name: string; user_ids?: number[] } }>(
    '/api/admin/groups',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { name, user_ids = [] } = req.body;
      if (!name?.trim()) {
        return reply.status(400).send({ error: 'Group name is required' });
      }
      try {
        const result = await db.query(
          'INSERT INTO groups (name) VALUES ($1) RETURNING *',
          [name.trim()]
        );
        const group = result.rows[0];

        for (const userId of user_ids) {
          await db.query(
            'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)',
            [userId, group.id]
          );
        }

        return reply.status(201).send(group);
      } catch (err: any) {
        if (err.code === '23505') {
          return reply.status(409).send({ error: 'Group already exists' });
        }
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // ═══════════════════════════════════════════════
  // USERS — list all (for group member selection)
  // ═══════════════════════════════════════════════

  app.get('/api/admin/users', { preHandler: [requireAdmin] }, async () => {
    const result = await db.query(
      'SELECT id, username, avatar_url, role FROM users ORDER BY username ASC'
    );
    return result.rows;
  });
  // ═══════════════════════════════════════════════
  // USERS — update role
  // ═══════════════════════════════════════════════

  app.put<{ Params: { id: string }; Body: { role: string } }>(
    '/api/admin/users/:id/role',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { id } = req.params;
      const { role } = req.body;

      if (!role?.trim()) {
        return reply.status(400).send({ error: 'Role is required' });
      }

      try {
        // Validate that the role actually exists in the roles table
        const roleCheck = await db.query('SELECT id FROM roles WHERE name = $1', [role.trim()]);
        if (roleCheck.rows.length === 0) {
          return reply.status(400).send({ error: 'Invalid role' });
        }

        const result = await db.query(
          'UPDATE users SET role = $1 WHERE id = $2 and role not in ($3) RETURNING id, username, role',
          [role.trim(), id, 'admin']
        );
        if (result.rows.length === 0) {
          return reply.status(404).send({ error: 'User not found' });
        }
        const result2 = await db.query(
          'UPDATE user_roles set role_id = $1 where user_id = $2 RETURNING user_id, role_id',
          [roleCheck.rows[0].id, id]
        )
        return result2.rows[0];
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // ═══════════════════════════════════════════════
  // GROUPS — add member
  // ═══════════════════════════════════════════════

  app.post<{ Params: { id: string }; Body: { user_id: number } }>(
    '/api/admin/groups/:id/members',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { id } = req.params;
      const { user_id } = req.body;
      try {
        await db.query(
          'INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [user_id, id]
        );
        return { added: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );
  // Delete a group
  app.delete<{ Params: { id: string } }>(
    '/api/admin/groups/:id',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { id } = req.params;
      await db.query('DELETE FROM user_groups WHERE group_id = $1', [id]);
      const result = await db.query('DELETE FROM groups WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) return reply.status(404).send({ error: 'Group not found' });
      return { deleted: true };
    }
  );

  // Remove a member from a group
  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/admin/groups/:id/members/:userId',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { id, userId } = req.params;
      await db.query('DELETE FROM user_groups WHERE group_id = $1 AND user_id = $2', [id, userId]);
      return { removed: true };
    }
  );
  app.delete<{ Params: { id: string } }>(
    '/api/admin/roles/:id',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { id } = req.params;
      const role = await db.query('SELECT * FROM roles WHERE id = $1', [id]);
      if (role.rows.length === 0) return reply.status(404).send({ error: 'Role not found' });
      if (role.rows[0].is_predefined) return reply.status(400).send({ error: 'Cannot delete predefined roles' });
      // Reset all users with this role back to 'user'
      await db.query('UPDATE users SET role = $1 WHERE role = $2', ['user', role.rows[0].name]);
      await db.query('DELETE FROM roles WHERE id = $1', [id]);
      return { deleted: true };
    }
  );
  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/admin/roles/:id/users/:userId',
    { preHandler: [requireAdmin] },
    async (req, reply) => {
      const { id, userId } = req.params;
      await db.query('UPDATE users SET role = $1 WHERE id = $2', ['user', userId]);
      return { removed: true };
    }
  );

};
