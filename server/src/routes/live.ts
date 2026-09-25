import type { LiveMessage } from '@pulse/core';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/** `GET /api/live?site=<id>` upgrades to a WebSocket that streams {@link LiveMessage}s. */
export function liveRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { site?: string } }>('/api/live', { websocket: true }, (socket, req) => {
    const siteId = req.query.site ?? '';
    if (!ctx.sites.get(siteId)) {
      socket.close(1008, 'Unknown site');
      return;
    }
    const send = (m: LiveMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    };
    send({ type: 'hello', siteId, active: ctx.pipeline.activeVisitors(siteId) });
    const unsubscribe = ctx.hub.subscribe(siteId, send);
    // Active-visitor count decays even without traffic, so push it periodically.
    const ticker = setInterval(
      () => send({ type: 'active', siteId, active: ctx.pipeline.activeVisitors(siteId) }),
      10_000,
    );
    socket.on('close', () => {
      clearInterval(ticker);
      unsubscribe();
    });
  });
}
