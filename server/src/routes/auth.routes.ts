import { FastifyInstance } from 'fastify';
import passport from '@fastify/passport';
import { signToken } from '../auth/jwt.js';

export async function authRoutes(app: FastifyInstance) {
  // 1. Kick off GitHub OAuth
  app.get('/auth/github', { preValidation: passport.authenticate('github', { scope: ['repo', 'read:user'] }) }, async () => {});

  // 2. GitHub redirects back here
  app.get('/auth/github/callback',
    { preValidation: passport.authenticate('github', { failureRedirect: '/login' }) },
    async (req, reply) => {
      const user = req.user as any;
      const token = signToken({ userId: user.id, username: user.username });
      // Send JWT to client via redirect — client reads it from URL param and stores it
      reply.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
    }
  );

  app.post('/auth/logout', async (req, reply) => {
    req.logout();
    reply.send({ ok: true });
  });
}