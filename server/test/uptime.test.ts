import { DAY, MINUTE, type CheckResult, type Monitor } from '@pulse/core';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { UptimeRepository } from '../src/db/uptime-repo.js';
import { performCheck, type FetchLike } from '../src/uptime/checker.js';
import { UptimeService } from '../src/uptime/service.js';
import { NOW, createTestApp } from './helpers.js';

const monitor: Monitor = {
  id: 'api',
  name: 'API',
  url: 'https://api.example/health',
  method: 'GET',
  intervalSec: 60,
  timeoutMs: 50,
  degradedAfterMs: 500,
  failureThreshold: 2,
};

const respond =
  (status: number): FetchLike =>
  async () => ({ status });

/** Never answers, so `performCheck` aborts it after `timeoutMs`. */
const hang: FetchLike = (_url, init) =>
  new Promise((_, reject) =>
    init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
  );

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

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

  it('opens an incident only after two failed checks in a row, starting at the first', async () => {
    const repo = new UptimeRepository(openDatabase(':memory:'));
    repo.upsertMonitor(monitor);
    const start = Date.parse('2026-06-10T12:00:00Z');
    let now = start;
    const ok = respond(200);
    const down = respond(500);
    const answers = [ok, hang, ok, down, down, down, ok];
    let i = 0;
    const service = new UptimeService({
      repo,
      now: () => now,
      fetch: (u, r) => answers[i++]!(u, r),
    });
    const stored = repo.getMonitor('api')!;
    expect(stored.failureThreshold).toBe(2);

    await service.runCheck(stored);
    now += MINUTE;
    expect(await service.runCheck(stored)).toMatchObject({
      ok: false,
      error: 'Timeout after 0.05s',
    });
    now += MINUTE;
    await service.runCheck(stored);
    expect(repo.incidents('api')).toEqual([]);

    for (let n = 3; n < answers.length; n++) {
      now += MINUTE;
      await service.runCheck(stored);
    }
    expect(repo.incidents('api')).toEqual([
      {
        id: expect.any(String),
        monitorId: 'api',
        startedAt: start + 3 * MINUTE,
        resolvedAt: start + 6 * MINUTE,
        cause: 'HTTP 500',
        failures: 3,
      },
    ]);
    // The timeout still counts against uptime.
    expect(repo.checks('api', 0)).toHaveLength(7);
    expect(repo.daily('api', 0)[0]).toMatchObject({ checks: 7, failures: 4 });
    expect(service.overview(stored).uptime24h).toBeCloseTo(3 / 7);
  });

  it('keeps counting failed checks across a restart', () => {
    dir = mkdtempSync(join(tmpdir(), 'pulse-uptime-'));
    const path = join(dir, 'pulse.db');
    const start = Date.parse('2026-06-10T12:00:00Z');
    const at = (n: number, ok: boolean): CheckResult => ({
      monitorId: 'api',
      ts: start + n * MINUTE,
      ok,
      status: ok ? 200 : 503,
      latencyMs: 20,
      error: ok ? null : 'HTTP 503',
    });
    /** Opens the database file the way a fresh process would. */
    const boot = () => {
      const db = openDatabase(path);
      const repo = new UptimeRepository(db);
      return { db, repo, service: new UptimeService({ repo }) };
    };

    const first = boot();
    first.repo.upsertMonitor({ ...monitor, failureThreshold: 3 });
    for (const [n, ok] of [
      [0, false],
      [1, true],
      [2, false],
      [3, false],
    ] as const) {
      first.service.record(at(n, ok));
    }
    expect(first.repo.incidents('api')).toEqual([]);
    first.db.close();

    const second = boot();
    second.service.record(at(4, false));
    expect(second.repo.incidents('api')).toEqual([
      expect.objectContaining({ startedAt: start + 2 * MINUTE, resolvedAt: null, failures: 3 }),
    ]);
    second.db.close();

    const third = boot();
    third.service.record(at(5, false));
    third.service.record(at(6, true));
    expect(third.repo.incidents('api')).toEqual([
      expect.objectContaining({
        startedAt: start + 2 * MINUTE,
        resolvedAt: start + 6 * MINUTE,
        failures: 4,
      }),
    ]);
    third.db.close();
  });

  it('takes failureThreshold from the admin API, and 1 opens an incident on the first failure', async () => {
    const t = await createTestApp();
    const post = (body: object) =>
      t.app.inject({
        method: 'POST',
        url: '/api/admin/monitors',
        headers: { authorization: 'Bearer secret' },
        payload: { id: 'site', name: 'Site', url: 'https://demo.example/', ...body },
      });
    for (const failureThreshold of [0, 11, 1.5]) {
      expect((await post({ failureThreshold })).statusCode).toBe(400);
    }
    const res = await post({ failureThreshold: 1 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ failureThreshold: 1 });
    expect(t.ctx.uptimeRepo.getMonitor('site')).toMatchObject({ failureThreshold: 1 });

    t.ctx.uptime.record({
      monitorId: 'site',
      ts: NOW,
      ok: false,
      status: null,
      latencyMs: 10_000,
      error: 'Timeout after 10s',
    });
    expect(t.ctx.uptimeRepo.incidents('site')).toEqual([
      expect.objectContaining({ startedAt: NOW, resolvedAt: null, failures: 1 }),
    ]);
    const list = (await t.app.inject('/api/monitors')).json<{ monitor: Monitor }[]>();
    expect(list[0]!.monitor.failureThreshold).toBe(1);
    await t.app.close();
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

describe('UptimeRepository', () => {
  /** A database file with the monitors table as the first version of the schema created it. */
  function versionOneDatabase(): string {
    dir = mkdtempSync(join(tmpdir(), 'pulse-uptime-'));
    const path = join(dir, 'pulse.db');
    const old = new DatabaseSync(path);
    old.exec(`PRAGMA journal_mode = WAL;
     CREATE TABLE monitors (
       id                 TEXT PRIMARY KEY,
       name               TEXT NOT NULL,
       url                TEXT NOT NULL,
       method             TEXT NOT NULL DEFAULT 'GET',
       interval_sec       INTEGER NOT NULL,
       timeout_ms         INTEGER NOT NULL,
       degraded_after_ms  INTEGER NOT NULL,
       paused             INTEGER NOT NULL DEFAULT 0,
       created_at         INTEGER NOT NULL
     );
     INSERT INTO monitors (id, name, url, interval_sec, timeout_ms, degraded_after_ms, created_at)
       VALUES ('api', 'API', 'https://api.example/health', 60, 5000, 500, 0);
     PRAGMA user_version = 1;`);
    old.close();
    return path;
  }

  it('gives the monitors of an existing database a failure threshold of 2 on start', () => {
    const db = openDatabase(versionOneDatabase());
    expect(new UptimeRepository(db).getMonitor('api')).toMatchObject({
      intervalSec: 60,
      failureThreshold: 2,
    });
    db.close();
  });

  it('migrates once when the API and the uptime worker open an old database together', async () => {
    const path = versionOneDatabase();
    const results = await Promise.all(openTogether(path, 2));
    expect(results).toEqual([
      { code: 0, out: '2', err: '' },
      { code: 0, out: '2', err: '' },
    ]);
    const db = openDatabase(path);
    expect(new UptimeRepository(db).getMonitor('api')).toMatchObject({ failureThreshold: 2 });
    db.close();
  }, 30_000);
});

const DATABASE_MODULE = new URL('../src/db/database.ts', import.meta.url).href;

/** Waits for a byte on stdin, then opens the database and prints its schema version. */
const OPEN_ON_SIGNAL = `
import { readSync } from 'node:fs';
const { openDatabase } = await import(process.argv[1]);
process.stdout.write('ready');
readSync(0, Buffer.alloc(1));
const db = openDatabase(process.argv[2]);
const out = String(db.prepare('PRAGMA user_version').get().user_version);
db.close();
process.stdout.write(out);
`;

/** Starts `n` processes and lets them call `openDatabase` on `path` at the same moment. */
function openTogether(path: string, n: number) {
  const children = Array.from({ length: n }, () => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      '--no-warnings',
      '--input-type=module',
      '-e',
      OPEN_ON_SIGNAL,
      DATABASE_MODULE,
      path,
    ]);
    let out = '';
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const done = new Promise<{ code: number | null; out: string; err: string }>((resolve) =>
      child.on('close', (code) => resolve({ code, out: out.replace(/^ready/, ''), err })),
    );
    const ready = new Promise<void>((resolve) => {
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString();
        if (out.startsWith('ready')) resolve();
      });
      void done.then(() => resolve());
    });
    return { child, ready, done };
  });
  void Promise.all(children.map((c) => c.ready)).then(() => {
    for (const c of children) c.child.stdin.end('go');
  });
  return children.map((c) => c.done);
}
