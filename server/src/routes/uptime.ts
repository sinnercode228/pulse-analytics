import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export function uptimeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/monitors', async () => ctx.uptime.overviews());

  app.get<{ Params: { id: string } }>('/api/monitors/:id', async (req, reply) => {
    const detail = ctx.uptime.detail(req.params.id);
    if (!detail) return reply.code(404).send({ error: 'Monitor not found' });
    return detail;
  });
}
