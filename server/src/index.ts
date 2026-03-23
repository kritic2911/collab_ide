import Fastify from 'fastify';
import fastifySession from '@fastify/session';
import fastifyCookie from '@fastify/cookie';
import passport from '@fastify/passport';
import { Strategy as GitHubStrategy } from 'passport-github2';
import pool from './db/client.js';
import { encrypt, decrypt } from './auth/crypto.js';
import { authRoutes } from './routes/auth.routes.js';
import { repoRoutes } from './routes/repo.routes.js';
import { githubRoutes } from './routes/github.routes.js';

const app = Fastify({ logger: true });

// Plugins
await app.register(fastifyCookie);
await app.register(fastifySession, { secret: process.env.SESSION_SECRET!, cookie: { secure: false } });
await app.register(passport.initialize());
await app.register(passport.secureSession());

// GitHub Strategy
passport.use(new GitHubStrategy(
  {
    clientID: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: `${process.env.SERVER_URL}/auth/github/callback`,
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const tokenEnc = encrypt(_accessToken);
      const result = await pool.query(
        `INSERT INTO users (github_id, username, avatar_url, github_token_enc)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (github_id) DO UPDATE
           SET github_token_enc = EXCLUDED.github_token_enc,
               username = EXCLUDED.username
         RETURNING id, username`,
        [profile.id, profile.username, profile.photos?.[0]?.value, tokenEnc]
      );
      done(null, result.rows[0]);
    } catch (err) {
      done(err as Error);
    }
  }
));

passport.registerUserSerializer(async (user: any) => user.id);
passport.registerUserDeserializer(async (id: string) => {
  const r = await pool.query('SELECT id, username FROM users WHERE id = $1', [id]);
  return r.rows[0];
});

// Routes
await app.register(authRoutes);
await app.register(repoRoutes, { prefix: '/api' });
await app.register(githubRoutes, { prefix: '/api' });

await app.listen({ port: Number(process.env.PORT ?? 3000) });