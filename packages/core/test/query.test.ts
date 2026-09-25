import { describe, expect, it } from 'vitest';
import {
  DAY,
  HOUR,
  MINUTE,
  MemoryRollupStore,
  RollupBuilder,
  SERVER_RETENTION,
  chooseInterval,
  EMPTY_SUMMARY,
  previousRange,
  queryPreviousSummary,
  queryBreakdown,
  querySummary,
  queryTimeseries,
  type PageviewEvent,
} from '../src/index.js';

const NOW = Date.parse('2026-06-10T12:30:00Z');

function seed(): MemoryRollupStore {
  const events: PageviewEvent[] = [];
  const pages = ['/', '/pricing', '/docs', '/docs/api', '/blog/launch'];
  // 3 visitors per hour over the last 48h; visitor "loyal" appears every hour.
  for (let h = 48; h >= 1; h--) {
    const ts = NOW - h * HOUR;
    for (const [i, v] of ['loyal', `a${h}`, `b${h}`].entries()) {
      events.push({
        siteId: 's1',
        ts: ts + i * MINUTE,
        visitorId: v,
        path: pages[(h + i) % pages.length]!,
        referrer: i === 0 ? '(direct)' : 'google.com',
        country: i === 2 ? 'US' : 'DE',
        device: 'desktop',
        browser: 'Chrome',
        loadMs: 1000 + i * 100,
      });
    }
  }
  const store = new MemoryRollupStore();
  store.upsert(new RollupBuilder().addAll(events).drain());
  return store;
}

describe('chooseInterval', () => {
  it('picks the finest retained tier that keeps charts readable', () => {
    expect(chooseInterval(NOW - 30 * MINUTE, NOW, SERVER_RETENTION, NOW)).toBe('minute');
    expect(chooseInterval(NOW - 24 * HOUR, NOW, SERVER_RETENTION, NOW)).toBe('hour');
    expect(chooseInterval(NOW - 7 * DAY, NOW, SERVER_RETENTION, NOW)).toBe('hour');
    expect(chooseInterval(NOW - 30 * DAY, NOW, SERVER_RETENTION, NOW)).toBe('day');
  });

  it('falls back to a coarser tier when the fine one has expired', () => {
    const old = NOW - 5 * DAY;
    expect(chooseInterval(old, old + HOUR, SERVER_RETENTION, NOW)).toBe('hour');
    const older = NOW - 60 * DAY;
    expect(chooseInterval(older, older + DAY, SERVER_RETENTION, NOW)).toBe('day');
  });
});

describe('queries', () => {
  const store = seed();
  const q = { siteId: 's1', from: NOW - 24 * HOUR, to: NOW, now: NOW };

  it('summary de-duplicates visitors across buckets', () => {
    const s = querySummary(store, q);
    expect(s.pageviews).toBe(72);
    expect(s.visitors).toBe(1 + 24 * 2); // loyal counted once
    expect(s.viewsPerVisitor).toBeCloseTo(72 / 49, 2);
    expect(s.avgLoadMs).toBe(1100);
  });

  it('timeseries returns a dense, zero-filled series', () => {
    const { interval, points } = queryTimeseries(store, {
      ...q,
      from: NOW - 72 * HOUR,
      interval: 'day',
    });
    expect(interval).toBe('day');
    const hourly = queryTimeseries(store, q);
    expect(hourly.interval).toBe('hour');
    expect(hourly.points).toHaveLength(25);
    expect(hourly.points.at(-1)).toMatchObject({ visitors: 0, pageviews: 0, avgLoadMs: null });
    expect(hourly.points.slice(0, -1).every((p) => p.pageviews === 3 && p.visitors === 3)).toBe(
      true,
    );
    expect(points.reduce((s, p) => s + p.pageviews, 0)).toBe(144);
  });

  it('breakdown sorts by visitors and supports search, limit and offset', () => {
    const countries = queryBreakdown(store, q, 'country');
    expect(countries.rows.map((r) => [r.value, r.visitors])).toEqual([
      ['DE', 25],
      ['US', 24],
    ]);
    const docs = queryBreakdown(store, q, 'page', { search: 'DOCS' });
    expect(docs.rows.every((r) => r.value.startsWith('/docs'))).toBe(true);
    const paged = queryBreakdown(store, q, 'page', { limit: 2, offset: 1 });
    expect(paged.total).toBe(5);
    expect(paged.rows).toHaveLength(2);
  });

  it('previousRange shifts the window back by its own length', () => {
    expect(previousRange(q)).toMatchObject({ from: NOW - 48 * HOUR, to: NOW - 24 * HOUR });
    expect(querySummary(store, previousRange(q)).pageviews).toBe(72);
  });
});

describe('queryPreviousSummary', () => {
  it('compares against the previous period when history covers it', () => {
    const q = { siteId: 's1', from: NOW - DAY, to: NOW, now: NOW };
    const prev = queryPreviousSummary(seed(), q);
    expect(prev).toEqual(querySummary(seed(), previousRange(q)));
    expect(prev.pageviews).toBeGreaterThan(0);
  });

  it('reports no previous data when history starts inside the previous period', () => {
    // 48h of data: the 30-day window before "last 30 days" is essentially empty.
    const q = { siteId: 's1', from: NOW - 30 * DAY, to: NOW, now: NOW };
    expect(queryPreviousSummary(seed(), q)).toEqual(EMPTY_SUMMARY);
    // Last 36h: the previous 36h are only partly covered (data begins 48h ago).
    const partial = { siteId: 's1', from: NOW - 36 * HOUR, to: NOW, now: NOW };
    expect(queryPreviousSummary(seed(), partial)).toEqual(EMPTY_SUMMARY);
  });
});
