import { FastifyInstance } from 'fastify';
import passport from '@fastify/passport';
import { signJwt } from '../auth/jwt.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { verifyOrgCode } from '../auth/github.strategy.js';

export async function authRoutes(app: FastifyInstance) {
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
  const authenticator = passport as any;

  // ── Verify org code (called by the client before OAuth) ──
  app.post('/auth/verify-code', async (req, reply) => {
    const { orgCode } = req.body as { orgCode?: string };

    if (!orgCode) {
      return reply.status(400).send({ valid: false, message: 'Organization code is required.' });
    }

    const valid = await verifyOrgCode(orgCode);
    return reply.send({ valid });
  });

  // 1. Kick off GitHub OAuth — accepts orgCode query param, passes it via state
  app.get('/auth/github', async (req, reply) => {
    const { orgCode } = req.query as { orgCode?: string };
    const state = encodeURIComponent(JSON.stringify({ orgCode: orgCode || '' }));

    return authenticator.authenticate('github', {
      scope: ['read:user'],
      state,
    })(req, reply);
  });

  // 2. GitHub redirects back here after user approves/denies
  app.get(
    '/auth/github/callback',
    {
      preValidation: authenticator.authenticate('github', {
        failureRedirect: `${CLIENT_URL}/invalid-code`,
      }),
    },
    async (req, reply) => {
      try {
        const user = req.user as any;

        if (!user) {
          return reply.redirect(`${CLIENT_URL}/invalid-code`);
        }

        // Sign JWT with full user data
        const token = signJwt({
          userId: user.id,
          username: user.username,
          role: user.role,
          color: user.color_hex,
          avatarUrl: user.avatar_url || '',
        });

        // Redirect client with JWT in query param
        return reply.redirect(`${CLIENT_URL}/auth/callback?token=${token}`);
      } catch (err) {
        console.error('Auth callback error:', err);
        return reply.redirect(`${CLIENT_URL}/login?error=auth_failed`);
      }
    }
  );

  // 3. Logout — destroy session, return success
  app.post(
    '/auth/logout',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        req.session?.destroy();
      } catch {
        // Session might not exist for JWT-only requests
      }
      return reply.send({ success: true });
    }
  );
}