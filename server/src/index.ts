import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import sessionPlugin from './plugins/session.plugin.js';
import passportPlugin from './plugins/passport.plugin.js';
import { authRoutes } from './routes/auth.routes.js';
import { seedOrgCode } from './db/seedOrgCode.js';

// ──────────────────────────────────────────────
// Env validation — crash immediately if anything missing
// ──────────────────────────────────────────────
const required = [
  'DATABASE_URL',
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

// CORS — allow client origin
await app.register(fastifyCors, {
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
});

// Plugins (order matters: session → passport)
await app.register(sessionPlugin);
await app.register(passportPlugin);

// Routes
await app.register(authRoutes);

// Seed / update organization code hash in the database
await seedOrgCode();

// Health check
app.get('/health', async () => {
  return { status: 'ok' };
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`🚀 Server running on port ${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}