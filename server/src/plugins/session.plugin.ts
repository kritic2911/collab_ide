import { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import fp from 'fastify-plugin';

async function sessionPlugin(app: FastifyInstance) {
  await app.register(fastifyCookie);
  await app.register(fastifySession, {
    secret: process.env.JWT_SECRET!,  // reuse JWT_SECRET for session signing
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600000, // 10 minutes — sessions only survive OAuth handshake
    },
    saveUninitialized: false,
  });
}

export default fp(sessionPlugin, {
  name: 'session-plugin',
});
