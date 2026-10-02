import {
  DAY,
  HOUR,
  MINUTE,
  SECOND,
  type BreakdownResponse,
  type RealtimeResponse,
  type SummaryResponse,
  type TimeseriesResponse,
} from '@pulse/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IPHONE, NOW, createTestApp, pageview, type TestApp } from './helpers.js';

let t: TestApp;

beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
});

describe('POST /api/event', () => {
  it('accepts tracker beacons sent as text/plain', async () => {
    const res = await pageview(t.app, { path: '/pricing?utm_x=1' });
    expect(res.statusCode).toBe(202);
    expect(t.ctx.pipeline.accepted).toBe(1);
  });

  it('rejects malformed payloads, unknown sites and foreign domains', async () => {
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/event',
      headers: { 'content-type': 'text/plain' },
      payload: '{nope',
    });
    expect(bad.statusCode).toBe(400);
    expect((await pageview(t.app, { site: 'missing' })).statusCode).toBe(404);
    const foreign = await t.app.inject({
      method: 'POST',
      url: '/api/event',
      headers: { 'content-type': 'text/plain', 'user-agent': IPHONE },
      payload: JSON.stringify({ s: 'demo', u: 'https://evil.example/' }),
    });
    expect(foreign.statusCode).toBe(422);
  });

  it('drops bots without counting them', async () => {
    const res = await pageview(t.app, { ua: 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ dropped: 'bot' });
    expect(t.ctx.pipeline.accepted).toBe(0);
  });
});

describe('stats API', () => {
  beforeEach(async () => {
    // visitor C yesterday, then visitor A: 3 pages from google, visitor B: 1 page direct on mobile.
    t.clock.now = NOW - 20 * HOUR;
    await pageview(t.app, { ip: '3.3.3.3', path: '/blog', country: 'FR' });
    t.clock.now = NOW;
    await pageview(t.app, {
      ip: '1.1.1.1',
      path: '/',
      ref: 'https://www.google.com/',
      country: 'DE',
      l: 900,
    });
    await pageview(t.app, {
      ip: '1.1.1.1',
      path: '/pricing',
      ref: 'https://demo.example/',
      country: 'DE',
    });
    await pageview(t.app, { ip: '1.1.1.1', path: '/docs/', country: 'DE' });
    await pageview(t.app, {
      ip: '2.2.2.2',
      path: '/pricing',
      ua: IPHONE,
      w: 390,
      country: 'US',
      l: 1500,
    });
  });

  it('summarises the range and compares with the previous period', async () => {
    const res = await t.app.inject(
      `/api/sites/demo/summary?from=${NOW - 12 * HOUR}&to=${NOW + MINUTE}`,
    );
    expect(res.statusCode).toBe(200);
    const body = res.json<SummaryResponse>();
    expect(body.current).toEqual({
      visitors: 2,
      pageviews: 4,
      viewsPerVisitor: 2,
      avgLoadMs: 1200,
    });
    expect(body.previous.pageviews).toBe(1);
    expect(body.interval).toBe('hour');
  });

  it('returns a dense timeseries', async () => {
    const res = await t.app.inject(
      `/api/sites/demo/timeseries?from=${NOW - 24 * HOUR}&to=${NOW + MINUTE}`,
    );
    const body = res.json<TimeseriesResponse>();
    expect(body.interval).toBe('hour');
    expect(body.points).toHaveLength(25);
    expect(body.points.reduce((s, p) => s + p.pageviews, 0)).toBe(5);
    const minute = await t.app.inject(
      `/api/sites/demo/timeseries?from=${NOW - 10 * MINUTE}&to=${NOW + MINUTE}&interval=minute`,
    );
    expect(minute.json<TimeseriesResponse>().points.at(-2)?.pageviews ?? 0).toBeGreaterThanOrEqual(
      0,
    );
  });

  it('answers 400 when a forced interval needs too many buckets', async () => {
    const minute = (from: number, to: number) =>
      t.app.inject(`/api/sites/demo/timeseries?from=${from}&to=${to}&interval=minute`);
    // The ranges from issue #1: 6 days worked, 8 days answered 500.
    expect((await minute(NOW - 6 * DAY, NOW)).statusCode).toBe(200);
    const tooLong = await minute(NOW - 8 * DAY, NOW);
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual({ error: expect.stringContaining('interval=minute') });
    // Exact boundary. `from` is off the minute grid and `to` is past now, so the
    // series gets an extra partial bucket at the front and nothing is trimmed at the end.
    const to = NOW + 30 * SECOND;
    const longest = await minute(to - 9_999 * MINUTE, to);
    expect(longest.statusCode).toBe(200);
    expect(longest.json<TimeseriesResponse>().points).toHaveLength(10_000);
    expect((await minute(to - 10_000 * MINUTE, to)).statusCode).toBe(400);
  });

  it('breaks down by page, referrer, country and device', async () => {
    const range = `from=${NOW - 24 * HOUR}&to=${NOW + MINUTE}`;
    const pages = (
      await t.app.inject(`/api/sites/demo/breakdown?dimension=page&${range}`)
    ).json<BreakdownResponse>();
    expect(pages.rows[0]).toMatchObject({ value: '/pricing', visitors: 2, pageviews: 2 });
    expect(pages.rows.map((r) => r.value)).toContain('/docs');
    const refs = (
      await t.app.inject(`/api/sites/demo/breakdown?dimension=referrer&${range}`)
    ).json<BreakdownResponse>();
    expect(Object.fromEntries(refs.rows.map((r) => [r.value, r.pageviews]))).toEqual({
      '(direct)': 4,
      'google.com': 1,
    });
    const devices = (
      await t.app.inject(`/api/sites/demo/breakdown?dimension=device&${range}`)
    ).json<BreakdownResponse>();
    expect(devices.rows.map((r) => r.value).sort()).toEqual(['desktop', 'mobile']);
    const search = (
      await t.app.inject(`/api/sites/demo/breakdown?dimension=country&search=u&${range}`)
    ).json<BreakdownResponse>();
    expect(search.rows).toEqual([{ value: 'US', visitors: 1, pageviews: 1, avgLoadMs: 1500 }]);
  });

  it('validates query parameters', async () => {
    expect((await t.app.inject('/api/sites/demo/breakdown?dimension=nope')).statusCode).toBe(400);
    expect((await t.app.inject('/api/sites/demo/timeseries?from=abc')).statusCode).toBe(400);
    expect((await t.app.inject('/api/sites/missing/summary')).statusCode).toBe(404);
  });

  it('exports a breakdown as CSV', async () => {
    const res = await t.app.inject(
      `/api/sites/demo/export.csv?dimension=page&from=${NOW - HOUR}&to=${NOW + MINUTE}`,
    );
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body.split('\r\n')[0]).toBe('page,visitors,pageviews,avg_load_ms');
    expect(res.body).toContain('/pricing,2,2,1500');
  });

  it('reports realtime visitors and a per-minute series', async () => {
    const body = (await t.app.inject('/api/sites/demo/realtime')).json<RealtimeResponse>();
    expect(body.active).toBe(2);
    expect(body.perMinute).toHaveLength(30);
    expect(body.perMinute.reduce((s, p) => s + p.pageviews, 0)).toBe(4);
    expect(body.recent[0]).toMatchObject({ path: '/pricing', device: 'mobile' });
    t.clock.now = NOW + 10 * MINUTE;
    expect((await t.app.inject('/api/sites/demo/realtime')).json<RealtimeResponse>().active).toBe(
      0,
    );
  });

  it('lists sites and exposes health', async () => {
    expect((await t.app.inject('/api/sites')).json()).toEqual([
      { id: 'demo', name: 'Demo Site', domain: 'demo.example', timeZone: 'UTC' },
    ]);
    const health = (await t.app.inject('/api/health')).json<{
      ok: boolean;
      accepted: number;
      rollupRows: number;
    }>();
    expect(health.ok).toBe(true);
    expect(health.accepted).toBe(5);
  });
});

describe('admin API', () => {
  it('requires the bearer token', async () => {
    const payload = { id: 'blog', name: 'Blog', domain: 'blog.example' };
    expect(
      (await t.app.inject({ method: 'POST', url: '/api/admin/sites', payload })).statusCode,
    ).toBe(401);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/sites',
      headers: { authorization: 'Bearer secret' },
      payload: { ...payload, timeZone: 'Europe/Berlin' },
    });
    expect(res.statusCode).toBe(201);
    expect(t.ctx.sites.get('blog')?.timeZone).toBe('Europe/Berlin');
  });

  it('creates monitors with defaults', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/monitors',
      headers: { authorization: 'Bearer secret' },
      payload: { id: 'site', name: 'Site', url: 'https://demo.example/' },
    });
    expect(res.statusCode).toBe(201);
    expect(t.ctx.uptimeRepo.getMonitor('site')).toMatchObject({ intervalSec: 60, paused: false });
  });
});
