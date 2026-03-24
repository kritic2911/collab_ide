import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJwt, JwtPayload } from '../auth/jwt.js';

// Extend Passport's PassportUser to include our JWT payload fields
// This avoids conflicting with @fastify/passport's own declaration of req.user
declare module 'fastify' {
  interface PassportUser extends JwtPayload {}
}

/**
 * Fastify preHandler — extracts and verifies JWT from Authorization header.
 * Attaches decoded payload to req.user.
 *
 * Returns 401 if token missing/invalid.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' });
  }

  const token = header.slice(7);
  const payload = verifyJwt(token);

  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  // Attach decoded payload to request — typed via PassportUser extension
  (req as any).user = payload;
}