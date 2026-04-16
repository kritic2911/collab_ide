import { Redis } from 'ioredis';

// ──────────────────────────────────────────────
// Redis URL — read once from env
// ──────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ──────────────────────────────────────────────
// Commands client — for all GET/SET/HSET/SADD etc.
// ioredis handles reconnection and backoff automatically.
// ──────────────────────────────────────────────
export const redisClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true, // don't connect until first command
});

// ──────────────────────────────────────────────
// Pub/Sub client — dedicated connection
// Once a Redis client enters subscribe mode it can
// only issue subscription commands. This is a Redis
// protocol constraint, not an ioredis limitation.
// ──────────────────────────────────────────────
export const redisPubSubClient = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // subscriber must never time out
  lazyConnect: true,
});

// ──────────────────────────────────────────────
// Connection lifecycle helpers
// ──────────────────────────────────────────────

/**
 * Connect both master and pub/sub Redis clients. Call once at server startup.
 *
 * @returns {Promise<void>} Resolves when both connections emit 'ready' and ping succeeds.
 * @throws {Error} Throws if initial connection drops or ping fails.
 */
export async function connectRedis(): Promise<void> {
  await Promise.all([
    redisClient.connect(),
    redisPubSubClient.connect(),
  ]);
  const pong = await redisClient.ping();
  console.log(`✅ Redis connected (PING → ${pong})`);
}

/**
 * Graceful shutdown. Call on SIGTERM / app.close().
 *
 * @returns {Promise<void>} Resolves when both client connections safely quit.
 * @throws {Error} Throws if graceful shutdown is forcibly interrupted.
 */
export async function disconnectRedis(): Promise<void> {
  await Promise.all([
    redisClient.quit(),
    redisPubSubClient.quit(),
  ]);
  console.log('🔌 Redis disconnected');
}
