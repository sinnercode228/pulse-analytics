import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [
  join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'p.js'),
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'p.js'),
  join(process.cwd(), 'public', 'p.js'),
];

function loadTracker(): string | null {
  for (const path of CANDIDATES) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      // try next
    }
  }
  return null;
}

/** Serves the < 2 KB tracker built by `npm run build:tracker`. */
export function trackerRoutes(app: FastifyInstance): void {
  let cached: string | null = null;
  app.get('/p.js', async (_req, reply) => {
    cached ??= loadTracker();
    if (!cached)
      return reply.code(404).send({ error: 'Tracker not built — run `npm run build:tracker`' });
    return reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .header('access-control-allow-origin', '*')
      .send(cached);
  });
}
