import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../auth/jwt.js';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing token' });
  }
  try {
    const payload = verifyToken(header.slice(7));
    // @ts-ignore — extend FastifyRequest if you want strict typing
    req.user = payload;
  } catch {
    return reply.status(401).send({ error: 'Invalid token' });
  }
}