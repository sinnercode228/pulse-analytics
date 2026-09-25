import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../context.js';
import { toCsv } from '../stats/csv.js';
import {
  breakdownQuerySchema,
  rangeQuerySchema,
  resolveRange,
  siteParamsSchema,
  timeseriesQuerySchema,
  type BreakdownQuerystring,
  type RangeQuerystring,
  type SiteParams,
  type TimeseriesQuerystring,
} from './schemas.js';

export function statsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { stats, sites } = ctx;

  const ensureSite = (siteId: string, reply: FastifyReply): boolean => {
    if (sites.get(siteId)) return true;
    void reply.code(404).send({ error: 'Site not found' });
    return false;
  };

  app.get('/api/sites', async () => sites.list());

  app.get<{ Params: SiteParams; Querystring: RangeQuerystring }>(
    '/api/sites/:siteId/summary',
    { schema: { params: siteParamsSchema, querystring: rangeQuerySchema } },
    async (req, reply) => {
      if (!ensureSite(req.params.siteId, reply)) return reply;
      return stats.summary(req.params.siteId, resolveRange(req.query, ctx.now()));
    },
  );

  app.get<{ Params: SiteParams; Querystring: TimeseriesQuerystring }>(
    '/api/sites/:siteId/timeseries',
    { schema: { params: siteParamsSchema, querystring: timeseriesQuerySchema } },
    async (req, reply) => {
      if (!ensureSite(req.params.siteId, reply)) return reply;
      return stats.timeseries(
        req.params.siteId,
        resolveRange(req.query, ctx.now()),
        req.query.interval,
      );
    },
  );

  app.get<{ Params: SiteParams; Querystring: BreakdownQuerystring }>(
    '/api/sites/:siteId/breakdown',
    { schema: { params: siteParamsSchema, querystring: breakdownQuerySchema } },
    async (req, reply) => {
      if (!ensureSite(req.params.siteId, reply)) return reply;
      const { dimension, limit, offset, search } = req.query;
      return stats.breakdown(req.params.siteId, resolveRange(req.query, ctx.now()), dimension, {
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {}),
        ...(search !== undefined ? { search } : {}),
      });
    },
  );

  app.get<{ Params: SiteParams; Querystring: BreakdownQuerystring }>(
    '/api/sites/:siteId/export.csv',
    { schema: { params: siteParamsSchema, querystring: breakdownQuerySchema } },
    async (req, reply) => {
      if (!ensureSite(req.params.siteId, reply)) return reply;
      const { dimension } = req.query;
      const result = stats.breakdown(
        req.params.siteId,
        resolveRange(req.query, ctx.now()),
        dimension,
        {
          limit: 5000,
        },
      );
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="${req.params.siteId}-${dimension}.csv"`,
        )
        .send(
          toCsv(
            [dimension, 'visitors', 'pageviews', 'avg_load_ms'],
            result.rows.map((r) => [r.value, r.visitors, r.pageviews, r.avgLoadMs]),
          ),
        );
    },
  );

  app.get<{ Params: SiteParams }>(
    '/api/sites/:siteId/realtime',
    { schema: { params: siteParamsSchema } },
    async (req, reply) => {
      if (!ensureSite(req.params.siteId, reply)) return reply;
      return stats.realtime(req.params.siteId);
    },
  );
}
