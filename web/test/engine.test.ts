// @vitest-environment node
import { DAY, HOUR, MINUTE, SECOND } from '@pulse/core';
import { describe, expect, it } from 'vitest';
import { DemoEngine } from '../src/data/demo/engine';

const NOW = Date.parse('2026-06-10T12:00:00Z');

describe('DemoEngine (the in-browser backend used by the Pages demo)', () => {
  const clock = { now: NOW };
  const engine = new DemoEngine({ now: () => clock.now, historyDays: 3 });
  const site = engine.sites()[0]!.id;

  it('lists fictional sites', () => {
    expect(engine.sites().map((s) => s.domain)).toEqual(
      expect.arrayContaining([expect.stringMatching(/\.example$/)]),
    );
  });

  it('backfills history lazily and answers summary / timeseries / breakdown', () => {
    const range = { from: NOW - DAY, to: NOW };
    const summary = engine.summary(site, range);
    expect(summary.current.pageviews).toBeGreaterThan(1000);
    expect(summary.current.visitors).toBeLessThan(summary.current.pageviews);
    expect(summary.previous.pageviews).toBeGreaterThan(0);
    const ts = engine.timeseries(site, range);
    expect(ts.interval).toBe('hour');
    expect(ts.points.length).toBeGreaterThanOrEqual(24);
    const pages = engine.breakdown(site, range, { dimension: 'page', limit: 5 });
    expect(pages.rows).toHaveLength(5);
    expect(pages.total).toBeGreaterThan(5);
    const sum = engine
      .breakdown(site, range, { dimension: 'device' })
      .rows.reduce((s, r) => s + r.pageviews, 0);
    expect(sum).toBe(summary.current.pageviews);
  });

  it('streams live pageviews as the clock advances', () => {
    engine.realtime(site);
    clock.now += 2 * MINUTE;
    const messages = engine.tick(site);
    expect(messages.some((m) => m.type === 'pageview')).toBe(true);
    expect(messages.at(-1)).toMatchObject({ type: 'active', siteId: site });
    const rt = engine.realtime(site);
    expect(rt.perMinute).toHaveLength(30);
    expect(rt.active).toBeGreaterThan(0);
    expect(rt.recent[0]!.ts).toBeGreaterThanOrEqual(rt.recent.at(-1)!.ts);
  });

  it('simulates monitors with a 90-day heatmap and emits checks live', () => {
    const monitors = engine.monitors();
    expect(monitors.length).toBeGreaterThanOrEqual(5);
    for (const m of monitors) {
      expect(m.daily).toHaveLength(90);
      // Same rule as the server: a single failed check does not open an incident.
      expect(m.monitor.failureThreshold).toBe(2);
      for (const i of m.incidents) expect(i.failures).toBeGreaterThanOrEqual(2);
    }
    const detail = engine.monitor(monitors[0]!.monitor.id);
    expect(detail.hourly.length).toBeGreaterThan(100);
    clock.now += 3 * MINUTE;
    expect(engine.tick(null).filter((m) => m.type === 'check').length).toBeGreaterThanOrEqual(
      monitors.length,
    );
    expect(() => engine.monitor('nope')).toThrow();
  });

  it('falls back to the hour tier once minute rollups have expired', () => {
    const r = engine.timeseries(site, { from: NOW - 2 * DAY - 6 * HOUR, to: NOW - 2 * DAY });
    expect(r.interval).toBe('hour');
    expect(r.points).toHaveLength(6);
    expect(r.points.reduce((s, p) => s + p.pageviews, 0)).toBeGreaterThan(0);
  });
});

describe('DemoEngine live windows', () => {
  // The page stamps `to`; the worker reads its clock a little later.
  const clock = { now: Date.parse('2026-06-10T15:20:40Z') };
  const engine = new DemoEngine({ now: () => clock.now, historyDays: 3 });
  const site = engine.sites()[0]!.id;

  it.each([5, 3 * SECOND])('keeps today when `to` is %i ms behind the clock', (lag) => {
    const exact = { from: clock.now - 30 * DAY, to: clock.now };
    const late = { from: exact.from - lag, to: exact.to - lag };
    const series = engine.timeseries(site, late);
    expect(series.interval).toBe('day');
    expect(series.points.at(-1)!.t).toBe(Date.parse('2026-06-10'));
    expect(series.points.at(-1)!.pageviews).toBeGreaterThan(0);
    expect(series).toEqual(engine.timeseries(site, exact));
    expect(engine.summary(site, late).current).toEqual(engine.summary(site, exact).current);
  });
});
