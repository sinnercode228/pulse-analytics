import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AppContext } from './context.js';
import { adminRoutes } from './routes/admin.js';
import { ingestRoutes } from './routes/ingest.js';
import { liveRoutes } from './routes/live.js';
import { statsRoutes } from './routes/stats.js';
import { trackerRoutes } from './routes/tracker.js';
import { uptimeRoutes } from './routes/uptime.js';

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(
  ctx: AppContext,
  opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const { config } = ctx;
  const app = Fastify({
    logger: opts.logger ? { level: config.logLevel } : false,
    trustProxy: config.trustProxy,
  });

  // The tracker must be able to post from any site; the dashboard API follows CORS_ORIGIN.
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || config.corsOrigin === '*') return cb(null, true);
      cb(
        null,
        config.corsOrigin
          .split(',')
          .map((s) => s.trim())
          .includes(origin),
      );
    },
  });
  await app.register(websocket);

  app.get('/api/health', async () => ({
    ok: true,
    sites: ctx.sites.list().length,
    rollupRows: ctx.rollups.count(),
    accepted: ctx.pipeline.accepted,
    liveSubscribers: ctx.hub.subscriberCount,
    uptime: ctx.uptime.running ? 'inline' : 'external',
  }));

  ingestRoutes(app, ctx);
  statsRoutes(app, ctx);
  uptimeRoutes(app, ctx);
  adminRoutes(app, ctx);
  liveRoutes(app, ctx);
  trackerRoutes(app);

  if (config.staticDir && existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: resolve(config.staticDir),
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Not found' })
        : reply.sendFile('index.html'),
    );
  }

  app.addHook('onClose', async () => {
    ctx.uptime.stop();
    ctx.pipeline.stop();
  });

  return app;
}
