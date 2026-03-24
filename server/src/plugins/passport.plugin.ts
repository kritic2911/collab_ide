import { FastifyInstance } from 'fastify';
import passport from '@fastify/passport';
import fp from 'fastify-plugin';
import { githubStrategy } from '../auth/github.strategy.js';
import { db } from '../db/client.js';

async function passportPlugin(app: FastifyInstance) {
  // @fastify/passport default export is an Authenticator instance
  const authenticator = passport as any;

  await app.register(authenticator.initialize());
  await app.register(authenticator.secureSession());

  // Register GitHub strategy
  authenticator.use('github', githubStrategy);

  // Serialize: store just the user id in the session
  authenticator.registerUserSerializer(async (user: any) => user.id);

  // Deserialize: fetch full user from DB by id
  authenticator.registerUserDeserializer(async (id: number) => {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      throw new Error('User not found');
    }
    return result.rows[0];
  });
}

export default fp(passportPlugin, {
  name: 'passport-plugin',
  dependencies: ['session-plugin'],
});
