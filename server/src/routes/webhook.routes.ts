import { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { broadcastRemotePush } from '../plugins/ws.plugin.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Verify the X-Hub-Signature-256 header from GitHub.
 * Returns true if signature is valid, false otherwise.
 */
function verifySignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;  // length mismatch
  }
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

export const webhookRoutes: FastifyPluginAsync = async (app) => {

  /**
   * POST /webhooks/github
   *
   * Receives a GitHub webhook payload, verifies the signature,
   * matches the repo against connected_repos, and persists the event.
   *
   * This endpoint is NOT behind JWT auth — GitHub calls it directly.
   * Security comes from the HMAC signature verification.
   */
  app.post('/webhooks/github', {
    // Capture exact raw bytes GitHub signed (JSON.stringify(req.body) breaks HMAC).
    preParsing: async (_request, _reply, payload) => {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks);
      (_request as { rawBody?: string }).rawBody = raw.toString('utf8');
      return Readable.from(raw);
    },
  }, async (req, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      app.log.warn('GITHUB_WEBHOOK_SECRET not set — rejecting webhook');
      return reply.status(500).send({ error: 'Webhook secret not configured' });
    }

    const rawBody = (req as { rawBody?: string }).rawBody ?? '';
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!verifySignature(rawBody, signature, secret)) {
      return reply.status(401).send({ error: 'Invalid signature' });
    }

    const eventType = req.headers['x-github-event'] as string;
    if (!eventType) {
      return reply.status(400).send({ error: 'Missing X-GitHub-Event header' });
    }

    const body = req.body as Record<string, unknown>;
    const githubRepoId = (body as { repository?: { id?: number } })?.repository?.id;
    const senderUsername =
      (body as { sender?: { login?: string } })?.sender?.login || 'unknown';
    const action = (body as { action?: string })?.action || null;

    if (!githubRepoId) {
      return reply.status(400).send({ error: 'Missing repository.id in payload' });
    }

    // ── Match to connected repo ──
    const repoResult = await db.query<{ id: number }>(
      'SELECT id FROM connected_repos WHERE github_repo_id = $1',
      [githubRepoId]
    );

    if (repoResult.rows.length === 0) {
      // Not a repo we track — ignore silently (return 200 so GitHub doesn't retry)
      return reply.status(200).send({ ignored: true, reason: 'Repo not connected' });
    }

    const repoId = repoResult.rows[0].id;

    const inserted = await db.query<{ id: number; received_at: Date }>(
      `INSERT INTO webhook_events (repo_id, event_type, action, sender_username, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, received_at`,
      [repoId, eventType, action, senderUsername, JSON.stringify(body)]
    );

    // Live push banner / awareness updates over WS (only for GitHub "push" events).
    if (eventType === 'push') {
      const ref = (body as any).ref as string | undefined;
      const branch =
        typeof ref === 'string' && ref.startsWith('refs/heads/')
          ? ref.slice('refs/heads/'.length)
          : (ref || '').split('/').filter(Boolean).pop() || '';

      const headCommit = (body as any).head_commit as { id?: string } | undefined;
      const commitSha = headCommit?.id || ((body as any).after as string | undefined) || '';

      const commits = (body as any).commits as any[] | undefined;
      const changedFilesSet = new Set<string>();
      if (Array.isArray(commits)) {
        for (const c of commits) {
          const added: string[] = Array.isArray(c.added) ? c.added : [];
          const modified: string[] = Array.isArray(c.modified) ? c.modified : [];
          const removed: string[] = Array.isArray(c.removed) ? c.removed : [];
          for (const f of [...added, ...modified, ...removed]) changedFilesSet.add(String(f));
        }
      }
      const changedFiles = Array.from(changedFilesSet);

      broadcastRemotePush(repoId, branch, senderUsername, changedFiles, commitSha);
    }

    const row = inserted.rows[0];

    app.log.info(`Webhook received: ${eventType}${action ? '/' + action : ''} for repo ${repoId}`);

    return reply.status(200).send({ received: true });
  });

  /**
   * GET /api/repos/:repoId/events?limit=N&offset=M
   *
   * Returns recent webhook events for a connected repo.
   * Protected by JWT auth. User must have access to the repo.
   */
  app.get<{ Params: { repoId: string }; Querystring: { limit?: string; offset?: string } }>(
    '/api/repos/:repoId/events',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const user = (req as any).user;
      const repoId = Number(req.params.repoId);
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const offset = Number(req.query.offset) || 0;

      // Verify repo exists
      const repo = await db.query('SELECT id, visibility FROM connected_repos WHERE id = $1', [repoId]);
      if (repo.rows.length === 0) {
        return reply.status(404).send({ error: 'Repo not found' });
      }

      // Access check (reuse pattern from repo.routes.ts)
      if (repo.rows[0].visibility !== 'all' && user.role !== 'admin') {
        const access = await db.query(
          `SELECT 1 FROM repo_access ra
           WHERE ra.repo_id = $1
             AND (
               ra.role_id IN (SELECT role_id FROM user_roles WHERE user_id = $2)
               OR ra.group_id IN (SELECT group_id FROM user_groups WHERE user_id = $2)
             ) LIMIT 1`,
          [repoId, user.userId]
        );
        if (access.rows.length === 0) {
          return reply.status(403).send({ error: 'Access denied' });
        }
      }

      // Fetch events
      const result = await db.query(
        `SELECT id, event_type, action, sender_username, payload, received_at
         FROM webhook_events
         WHERE repo_id = $1
         ORDER BY received_at DESC
         LIMIT $2 OFFSET $3`,
        [repoId, limit, offset]
      );

      // Total count for pagination
      const countResult = await db.query(
        'SELECT COUNT(*)::int AS total FROM webhook_events WHERE repo_id = $1',
        [repoId]
      );

      return {
        events: result.rows,
        total: countResult.rows[0].total,
        limit,
        offset,
      };
    }
  );
};
