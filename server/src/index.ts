// Side-effect import — MUST be the first import.
// ES module `import` statements are hoisted and evaluated in order,
// so this guarantees process.env is populated before any other module
// (like github.strategy.ts or crypto.ts) reads env vars.
import 'dotenv/config';

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import sessionPlugin from './plugins/session.plugin.js';
import passportPlugin from './plugins/passport.plugin.js';
import { authRoutes } from './routes/auth.routes.js';
import { repoRoutes } from './routes/repo.routes.js';
import { githubRoutes } from './routes/github.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { webhookRoutes } from './routes/webhook.routes.js';
import wsPlugin from './plugins/wsPlugin.js';
import { seedOrgCode } from './db/seedOrgCode.js';
import { seedRoles } from './db/seedRoles.js';
import { connectRedis, disconnectRedis } from './state/redis.client.js';

// ──────────────────────────────────────────────
// Env validation — crash immediately if anything missing
// ──────────────────────────────────────────────
const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'ADMIN_GITHUB_USERNAME',
  'ORG_CODE',
];


for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env variable: ${key}`);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Create Fastify app
// ──────────────────────────────────────────────
const app = Fastify({ logger: true });

await app.register(fastifyCors, {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

// Plugins (order matters: session → passport → websocket)
await app.register(sessionPlugin);
await app.register(passportPlugin);
await app.register(wsPlugin);

// Routes
await app.register(authRoutes);
await app.register(repoRoutes);
await app.register(githubRoutes);
await app.register(adminRoutes);
await app.register(webhookRoutes);

// Seed / update organization code hash in the database
await seedOrgCode();

// Seed predefined roles
await seedRoles();

// Connect Redis (commands + PubSub clients)
await connectRedis();

import { subscribeToGlobalWebhooks } from './state/pubsub.js';
import { broadcastToBranch } from './ws/roomManager.js';
import { webhookLog } from './utils/fileLogger.js';

// Setup Global Webhook Subscriber
await subscribeToGlobalWebhooks((payload) => {
  if (payload && payload.repoId && payload.branch && payload.msg) {
    const sentCount = broadcastToBranch(payload.repoId, payload.branch, payload.msg);
    if (sentCount > 0) {
      webhookLog(`  [Instance] Delivered global push for repo ${payload.repoId} branch ${payload.branch} to ${sentCount} local socket(s)`);
    }
  }
});

// ──────────────────────────────────────────────
// Chat cleanup — delete messages older than 30 days (runs every 24h)
// ──────────────────────────────────────────────
import { db } from './db/client.js';

const CHAT_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const chatCleanupTimer = setInterval(async () => {
  try {
    const result = await db.query(
      `DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '30 days'`
    );
    console.log(`🧹 Chat cleanup: removed ${result.rowCount} messages older than 30 days`);
  } catch (err) {
    console.error('Chat cleanup failed:', err);
  }
}, CHAT_CLEANUP_INTERVAL);

// Health check
app.get('/health', async () => {
  return { status: 'ok' };
});

// Graceful shutdown — close Redis connections + clear cleanup timer
app.addHook('onClose', async () => {
  clearInterval(chatCleanupTimer);
  await disconnectRedis();
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3001);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 Server running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}