import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import { createContext, type ContextOverrides } from '../src/create-context.js';
import { openDatabase } from '../src/db/database.js';

export const NOW = Date.parse('2026-06-10T12:30:00Z');

export const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  clock: { now: number };
}

export async function createTestApp(
  config: Partial<Config> = {},
  overrides: ContextOverrides = {},
): Promise<TestApp> {
  const clock = { now: NOW };
  const cfg = { ...loadConfig({}), databasePath: ':memory:', adminToken: 'secret', ...config };
  const ctx = createContext(cfg, {
    db: openDatabase(':memory:'),
    now: () => clock.now,
    ...overrides,
  });
  ctx.sites.upsert({ id: 'demo', name: 'Demo Site', domain: 'demo.example', timeZone: 'UTC' }, NOW);
  const app = await buildApp(ctx);
  return { app, ctx, clock };
}

export function pageview(
  app: FastifyInstance,
  opts: {
    path?: string;
    ref?: string;
    ip?: string;
    ua?: string;
    country?: string;
    w?: number;
    l?: number;
    site?: string;
  } = {},
) {
  return app.inject({
    method: 'POST',
    url: '/api/event',
    headers: {
      'content-type': 'text/plain;charset=UTF-8',
      'user-agent': opts.ua ?? CHROME,
      'x-forwarded-for': opts.ip ?? '203.0.113.1',
      ...(opts.country ? { 'x-country-code': opts.country } : {}),
    },
    payload: JSON.stringify({
      s: opts.site ?? 'demo',
      u: `https://demo.example${opts.path ?? '/'}`,
      r: opts.ref,
      w: opts.w ?? 1440,
      l: opts.l,
    }),
  });
}
