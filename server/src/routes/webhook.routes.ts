import { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import { db } from '../db/client.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { publishGlobalWebhook } from '../state/pubsub.js';
import { webhookLog } from '../utils/fileLogger.js';
import type { ServerMessage } from '../ws/ws.types.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Verify the X-Hub-Signature-256 header from GitHub.
 * Uses timing-safe comparison to prevent timing attacks.
 */
function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false; // length mismatch
  }
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

export const webhookRoutes: FastifyPluginAsync = async (app) => {

  // ── Custom JSON parser that captures raw body for HMAC verification ──
  //
  // The previous implementation used a preParsing hook + Readable.from()
  // to reconstruct the stream, but Fastify's parser was choking on the
  // reconstructed stream → 502 "unexpected end of JSON input".
  //
  // This approach is simpler and more reliable: intercept at the parser
  // level, save the raw string, and JSON.parse it ourselves.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req: any, body: Buffer, done: (err: Error | null, result?: any) => void) => {
      _req.rawBody = body.toString('utf8');
      try {
        done(null, JSON.parse(_req.rawBody));
      } catch (err: any) {
        err.statusCode = 400;
        done(err);
      }
    }
  );

  // Also handle form-encoded payloads (GitHub can send payload=... format)
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer' },
    (_req: any, body: Buffer, done: (err: Error | null, result?: any) => void) => {
      _req.rawBody = body.toString('utf8');
      try {
        const params = new URLSearchParams(_req.rawBody);
        const payloadStr = params.get('payload');
        if (payloadStr) {
          done(null, { payload: payloadStr });
        } else {
          done(null, Object.fromEntries(params));
        }
      } catch (err: any) {
        err.statusCode = 400;
        done(err);
      }
    }
  );

  /**
   * POST /webhooks/github
   *
   * Receives a GitHub webhook payload, verifies the HMAC signature,
   * matches the repo against connected_repos, persists the event,
   * and broadcasts a notification to all users on the affected branch.
   *
   * NOT behind JWT auth — GitHub calls it directly.
   * Security comes from HMAC-SHA256 signature verification.
   */
  app.post('/webhooks/github', async (req, reply) => {
    webhookLog('─── Incoming webhook request ───');
    webhookLog(`  Headers: X-GitHub-Event=${req.headers['x-github-event']}, Content-Type=${req.headers['content-type']}`);

    // ── Secret check ──
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      webhookLog('  ERROR: GITHUB_WEBHOOK_SECRET not set — rejecting');
      return reply.status(500).send({ error: 'Webhook secret not configured' });
    }

    // ── Signature verification ──
    const rawBody = (req as any).rawBody ?? '';
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    webhookLog(`  Raw body length: ${rawBody.length} bytes`);
    webhookLog(`  Signature present: ${!!signature}`);

    if (!verifySignature(rawBody, signature, secret)) {
      webhookLog('  ERROR: Signature verification FAILED — rejecting');
      return reply.status(401).send({ error: 'Invalid signature' });
    }
    webhookLog('  Signature: VALID ✓');

    // ── Event type ──
    const eventType = req.headers['x-github-event'] as string;
    if (!eventType) {
      webhookLog('  ERROR: Missing X-GitHub-Event header');
      return reply.status(400).send({ error: 'Missing X-GitHub-Event header' });
    }

    // ── Parse body (handle both JSON and form-encoded with payload=...) ──
    let body: Record<string, any>;
    if (typeof req.body === 'object' && req.body !== null && 'payload' in (req.body as any)) {
      try {
        body = JSON.parse((req.body as any).payload);
      } catch {
        body = req.body as Record<string, any>;
      }
    } else {
      body = req.body as Record<string, any>;
    }

    const githubRepoId = body?.repository?.id;
    const repoFullName = body?.repository?.full_name ?? 'unknown';
    const senderUsername = body?.sender?.login ?? 'unknown';
    const action = body?.action ?? null;

    webhookLog(`  Event: ${eventType}${action ? '/' + action : ''}`);
    webhookLog(`  Repo: ${repoFullName} (github_id=${githubRepoId})`);
    webhookLog(`  Sender: ${senderUsername}`);

    if (!githubRepoId) {
      webhookLog('  ERROR: Missing repository.id in payload');
      return reply.status(400).send({ error: 'Missing repository.id in payload' });
    }

    // ── Match to connected repo ──
    const repoResult = await db.query<{ id: number }>(
      'SELECT id FROM connected_repos WHERE github_repo_id = $1',
      [githubRepoId]
    );

    if (repoResult.rows.length === 0) {
      webhookLog(`  SKIP: Repo ${repoFullName} (github_id=${githubRepoId}) is not connected — ignoring`);
      return reply.status(200).send({ ignored: true, reason: 'Repo not connected' });
    }

    const repoId = repoResult.rows[0].id;
    webhookLog(`  Matched connected_repos.id = ${repoId}`);

    // ── Persist event ──
    try {
      const inserted = await db.query<{ id: number; received_at: Date }>(
        `INSERT INTO webhook_events (repo_id, event_type, action, sender_username, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id, received_at`,
        [repoId, eventType, action, senderUsername, JSON.stringify(body)]
      );
      const row = inserted.rows[0];
      webhookLog(`  PERSISTED: webhook_events.id = ${row.id}, received_at = ${row.received_at.toISOString()}`);
    } catch (err: any) {
      webhookLog(`  ERROR persisting event: ${err.message}`);
      // Don't return 500 — the webhook was valid, we just failed to store it
    }

    // ── Live broadcast for push events ──
    if (eventType === 'push') {
      const ref = body.ref as string | undefined;
      const branch =
        typeof ref === 'string' && ref.startsWith('refs/heads/')
          ? ref.slice('refs/heads/'.length)
          : (ref || '').split('/').filter(Boolean).pop() || '';

      const headCommit = body.head_commit as { id?: string } | undefined;
      const commitSha = headCommit?.id ?? (body.after as string | undefined) ?? '';

      const commits = body.commits as any[] | undefined;
      const changedFilesSet = new Set<string>();
      if (Array.isArray(commits)) {
        for (const c of commits) {
          for (const f of (c.added ?? [])) changedFilesSet.add(String(f));
          for (const f of (c.modified ?? [])) changedFilesSet.add(String(f));
          for (const f of (c.removed ?? [])) changedFilesSet.add(String(f));
        }
      }
      const changedFiles = Array.from(changedFilesSet);

      webhookLog(`  Push: branch=${branch}, commit=${commitSha.slice(0, 7)}, changedFiles=[${changedFiles.join(', ')}]`);

      // Broadcast to ALL users viewing ANY file on this repo+branch globally
      const pushMsg: ServerMessage = {
        type: 'remote_push',
        roomId: `${repoId}:${branch}:*`, // branch-level indicator
        pushedBy: senderUsername,
        branch,
        changedFiles,
        commitSha,
      };

      // Publish to global pubsub so ALL instances receive it
      publishGlobalWebhook({
        repoId: String(repoId),
        branch,
        msg: pushMsg
      }).catch(err => webhookLog(`  PubSub ERROR: ${err.message}`));
      
      webhookLog(`  Published global webhook for branch "${branch}"`);
    } else {
      webhookLog(`  Non-push event "${eventType}" — persisted only, no live broadcast`);
    }

    webhookLog('─── Webhook processed successfully ───');
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

      // Access check
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
