import { DAY, MINUTE, type Monitor } from '@pulse/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('scheduling', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Counts probes per URL. The fetch call happens synchronously when a timer fires. */
    function setup() {
      vi.useFakeTimers({ now: Date.parse('2026-06-10T12:00:00Z') });
      const repo = new UptimeRepository(openDatabase(':memory:'));
      const probes = new Map<string, number>();
      const service = new UptimeService({
        repo,
        fetch: async (url) => {
          probes.set(url, (probes.get(url) ?? 0) + 1);
          return { status: 200 };
        },
      });
      const count = (url: string) => probes.get(url) ?? 0;
      return { repo, service, count };
    }
    const fast: Monitor = { ...monitor, id: 'fast', url: 'https://fast.example/' };
    const hourly: Monitor = {
      ...monitor,
      id: 'hourly',
      url: 'https://hourly.example/',
      intervalSec: 3600,
    };

    it('probes each monitor at its own interval when the worker re-syncs every 5 minutes', async () => {
      const { repo, service, count } = setup();
      repo.upsertMonitor(fast);
      repo.upsertMonitor(hourly);
      service.start();
      expect([count(fast.url), count(hourly.url)]).toEqual([1, 1]);
      // What uptime-worker.ts does: re-sync every 5 minutes, for an hour.
      for (let i = 0; i < 12; i++) {
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        service.sync();
      }
      expect(count(fast.url)).toBe(61);
      expect(count(hourly.url)).toBe(2);
      service.stop();
    });

    it('prunes raw checks once an hour while the worker re-syncs every 5 minutes', async () => {
      const { repo, service } = setup();
      repo.upsertMonitor(hourly);
      const old = Date.now() - 8 * DAY;
      service.record({
        monitorId: hourly.id,
        ts: old,
        ok: true,
        status: 200,
        latencyMs: 10,
        error: null,
      });
      service.start();
      for (let i = 0; i < 12; i++) {
        await vi.advanceTimersByTimeAsync(5 * MINUTE);
        service.sync();
      }
      expect(repo.checks(hourly.id, 0).map((c) => c.ts)).not.toContain(old);
      service.stop();
    });

    it('starts timers only for new or changed monitors and stops paused ones', async () => {
      const { repo, service, count } = setup();
      repo.upsertMonitor(fast);
      repo.upsertMonitor(hourly);
      service.start();
      await vi.advanceTimersByTimeAsync(30 * 1000);

      const added: Monitor = { ...monitor, id: 'added', url: 'https://added.example/' };
      repo.upsertMonitor(added);
      repo.upsertMonitor({ ...hourly, name: 'Renamed' });
      service.sync();
      expect([count(fast.url), count(hourly.url), count(added.url)]).toEqual([1, 1, 1]);

      // A changed URL or interval is probed at once and rescheduled.
      repo.upsertMonitor({ ...hourly, url: 'https://hourly.example/v2', intervalSec: 120 });
      service.sync();
      expect(count('https://hourly.example/v2')).toBe(1);
      await vi.advanceTimersByTimeAsync(120 * 1000);
      expect(count('https://hourly.example/v2')).toBe(2);
      expect(count(hourly.url)).toBe(1);

      repo.upsertMonitor(fast, true);
      service.sync();
      const before = count(fast.url);
      await vi.advanceTimersByTimeAsync(10 * MINUTE);
      expect(count(fast.url)).toBe(before);
      expect(service.running).toBe(true);
      service.stop();
      expect(service.running).toBe(false);
    });

    it('does not re-probe existing monitors when one is posted to the admin API', async () => {
      // Only intervals are faked: Fastify needs real setImmediate and setTimeout.
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const probes: string[] = [];
      const t = await createTestApp(
        {},
        {
          fetch: async (url) => {
            probes.push(url);
            return { status: 200 };
          },
        },
      );
      t.ctx.uptimeRepo.upsertMonitor(hourly);
      t.ctx.uptime.start();
      expect(probes).toEqual([hourly.url]);
      const post = (body: object) =>
        t.app.inject({
          method: 'POST',
          url: '/api/admin/monitors',
          headers: { authorization: 'Bearer secret' },
          payload: body,
        });
      const added = { id: 'added', name: 'Added', url: 'https://added.example/' };
      expect((await post(added)).statusCode).toBe(201);
      expect(probes).toEqual([hourly.url, added.url]);
      // Posting the same monitor again changes nothing, so nothing is probed.
      expect((await post(added)).statusCode).toBe(201);
      expect(probes).toEqual([hourly.url, added.url]);
      await t.app.close();
    });
  });
});
