import { FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './requireAuth.js';

/**
 * Fastify preHandler — requires authentication AND admin role.
 * Must be used as an array: [requireAdmin] (it chains requireAuth internally).
 *
 * Returns 403 if authenticated user is not an admin.
 */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  // First verify JWT
  await requireAuth(req, reply);

  // If requireAuth already sent a 401, stop
  if (reply.sent) return;

  const user = (req as any).user;
  if (!user || user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}
