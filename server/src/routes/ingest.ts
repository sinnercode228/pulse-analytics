import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { decodePayload, toPageview } from '../ingest/parse.js';

export function ingestRoutes(app: FastifyInstance, ctx: AppContext): void {
  // sendBeacon posts `text/plain`, which avoids a CORS preflight.
  app.post('/api/event', { bodyLimit: 8 * 1024 }, async (req, reply) => {
    const payload = decodePayload(req.body);
    if (!payload) return reply.code(400).send({ error: 'Invalid payload' });
    const now = ctx.now();
    const result = toPageview(
      payload,
      { ip: req.ip, userAgent: req.headers['user-agent'], headers: req.headers, now },
      (id) => ctx.sites.get(id),
      ctx.salts.forTime(now),
    );
    if (!result.ok) {
      // Bots are silently accepted-and-dropped so they don't retry.
      if (result.reason === 'bot') return reply.code(202).send({ ok: true, dropped: 'bot' });
      return reply
        .code(result.reason === 'unknown-site' ? 404 : 422)
        .send({ error: result.reason });
    }
    ctx.pipeline.ingest(result.event);
    return reply.code(202).send({ ok: true });
  });
}
