import { isValidTimeZone } from '@pulse/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context.js';

const siteBody = {
  type: 'object',
  required: ['id', 'name', 'domain'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    domain: { type: 'string', pattern: '^[a-z0-9.-]+\\.[a-z]{2,}$|^localhost$' },
    timeZone: { type: 'string', maxLength: 64 },
  },
} as const;

const monitorBody = {
  type: 'object',
  required: ['id', 'name', 'url'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,62}$' },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    url: { type: 'string', pattern: '^https?://', maxLength: 2048 },
    method: { type: 'string', enum: ['GET', 'HEAD'] },
    intervalSec: { type: 'integer', minimum: 30, maximum: 3600 },
    timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000 },
    degradedAfterMs: { type: 'integer', minimum: 50, maximum: 30000 },
  },
} as const;

interface SiteBody {
  id: string;
  name: string;
  domain: string;
  timeZone?: string;
}

interface MonitorBody {
  id: string;
  name: string;
  url: string;
  method?: 'GET' | 'HEAD';
  intervalSec?: number;
  timeoutMs?: number;
  degradedAfterMs?: number;
}

function authorized(req: FastifyRequest, token: string): boolean {
  if (!token) return false;
  const given = Buffer.from(req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Write endpoints, enabled only when `ADMIN_TOKEN` is set. */
export function adminRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.addHook('preHandler', async (req, reply) => {
    if (
      req.method === 'POST' &&
      req.url.startsWith('/api/admin/') &&
      !authorized(req, ctx.config.adminToken)
    ) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.post<{ Body: SiteBody }>(
    '/api/admin/sites',
    { schema: { body: siteBody } },
    async (req, reply) => {
      const timeZone = req.body.timeZone ?? 'UTC';
      if (!isValidTimeZone(timeZone)) return reply.code(400).send({ error: 'Unknown time zone' });
      return reply.code(201).send(ctx.sites.upsert({ ...req.body, timeZone }, ctx.now()));
    },
  );

  app.post<{ Body: MonitorBody }>(
    '/api/admin/monitors',
    { schema: { body: monitorBody } },
    async (req, reply) => {
      const monitor = {
        method: 'GET' as const,
        intervalSec: 60,
        timeoutMs: 10_000,
        degradedAfterMs: 1_000,
        ...req.body,
      };
      ctx.uptimeRepo.upsertMonitor(monitor, false, ctx.now());
      if (ctx.uptime.running) ctx.uptime.start();
      return reply.code(201).send(monitor);
    },
  );
}
