import { DAY, MINUTE, type Monitor } from '@pulse/core';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { UptimeRepository } from '../src/db/uptime-repo.js';
import { performCheck, type FetchLike } from '../src/uptime/checker.js';
import { UptimeService } from '../src/uptime/service.js';
import { createTestApp } from './helpers.js';

const monitor: Monitor = {
  id: 'api',
  name: 'API',
  url: 'https://api.example/health',
  method: 'GET',
  intervalSec: 60,
  timeoutMs: 50,
  degradedAfterMs: 500,
};

const respond =
  (status: number): FetchLike =>
  async () => ({ status });

describe('performCheck', () => {
  it('classifies HTTP statuses', async () => {
    expect(await performCheck(monitor, respond(204))).toMatchObject({
      ok: true,
      status: 204,
      error: null,
    });
    expect(await performCheck(monitor, respond(503))).toMatchObject({
      ok: false,
      status: 503,
      error: 'HTTP 503',
    });
  });

  it('turns network errors and timeouts into failed checks', async () => {
    const refused: FetchLike = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    expect(await performCheck(monitor, refused)).toMatchObject({
      ok: false,
      status: null,
      error: 'ECONNREFUSED',
    });
    const hang: FetchLike = (_url, init) =>
      new Promise((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    expect(await performCheck(monitor, hang)).toMatchObject({
      ok: false,
      error: 'Timeout after 0.05s',
      latencyMs: 50,
    });
  });
});

describe('UptimeService', () => {
  it('records checks, opens and resolves incidents, and builds the overview', async () => {
    const repo = new UptimeRepository(openDatabase(':memory:'));
    repo.upsertMonitor(monitor);
    let now = Date.parse('2026-06-10T12:00:00Z');
    const statuses = [200, 200, 500, 500, 500, 200, 200];
    let i = 0;
    const service = new UptimeService({
      repo,
      now: () => now,
      fetch: async () => ({ status: statuses[i++]! }),
    });
    const stored = repo.getMonitor('api')!;
    for (let n = 0; n < statuses.length; n++) {
      await service.runCheck(stored);
      now += MINUTE;
    }
    const incidents = repo.incidents('api');
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ cause: 'HTTP 500', failures: 3 });
    expect(incidents[0]!.resolvedAt).not.toBeNull();

    const overview = service.overview(stored);
    expect(overview.status).toBe('up');
    expect(overview.uptime24h).toBeCloseTo(4 / 7);
    expect(overview.daily).toHaveLength(90);
    expect(overview.daily.at(-1)).toMatchObject({ checks: 7, failures: 3 });
    const detail = service.detail('api')!;
    expect(detail.recentChecks[0]!.ts).toBeGreaterThan(detail.recentChecks.at(-1)!.ts);
    expect(detail.hourly.length).toBeGreaterThanOrEqual(7 * 24);
    expect(repo.pruneChecks(now + 8 * DAY)).toBe(7);
  });

  it('serves monitors over the API', async () => {
    const t = await createTestApp({}, { fetch: respond(200) });
    t.ctx.uptimeRepo.upsertMonitor(monitor);
    await t.ctx.uptime.runCheck(t.ctx.uptimeRepo.getMonitor('api')!);
    const list = (await t.app.inject('/api/monitors')).json<
      { status: string; monitor: Monitor }[]
    >();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'up', monitor: { id: 'api' } });
    expect((await t.app.inject('/api/monitors/api')).statusCode).toBe(200);
    expect((await t.app.inject('/api/monitors/nope')).statusCode).toBe(404);
    await t.app.close();
  });
});
