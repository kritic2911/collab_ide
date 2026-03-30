import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import { verifyJwt } from '../auth/jwt.js';
import { handleMessage, handleDisconnect } from '../ws/messageHandler.js';
import type { AuthenticatedSocket } from '../ws/ws.types.js';

async function wsPlugin(app: FastifyInstance) {
  // Register the WebSocket plugin
  await app.register(websocket);

  // WebSocket endpoint with JWT auth on upgrade
  app.get('/ws', { websocket: true }, (socket, req) => {
    // ── Auth: extract JWT from ?token= query param ──
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      socket.close(4401, 'Missing token');
      return;
    }

    const payload = verifyJwt(token);
    if (!payload) {
      socket.close(4401, 'Invalid or expired token');
      return;
    }

    // Attach user info to the socket for room operations
    const conn = socket as AuthenticatedSocket;
    conn.user = payload;

    app.log.info(`WebSocket connected: ${payload.username} (userId=${payload.userId})`);

    // ── Route incoming messages ──
    conn.on('message', (data: import('ws').RawData) => {
      let raw: string;
      if (typeof data === 'string') {
        raw = data;
      } else if (Array.isArray(data)) {
        raw = Buffer.concat(data).toString('utf-8');
      } else {
        raw = data.toString('utf-8');
      }
      handleMessage(conn, raw);
    });

    // ── Clean up on disconnect ──
    conn.on('close', () => {
      app.log.info(`WebSocket disconnected: ${payload.username}`);
      handleDisconnect(conn);
    });
  });
}

export default fp(wsPlugin, {
  name: 'ws-plugin',
});
