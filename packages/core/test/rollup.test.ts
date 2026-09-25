import { describe, expect, it } from 'vitest';
import {
  DAY,
  HOUR,
  MINUTE,
  MemoryRollupStore,
  RollupBuilder,
  type PageviewEvent,
} from '../src/index.js';

const T0 = Date.parse('2026-06-01T10:00:00Z');

function ev(partial: Partial<PageviewEvent> & { ts: number; visitorId: string }): PageviewEvent {
  return {
    siteId: 'site',
    path: '/',
    referrer: '(direct)',
    country: 'DE',
    device: 'desktop',
    browser: 'Firefox',
    ...partial,
  };
}

const events: PageviewEvent[] = [
  ev({ ts: T0 + 1 * MINUTE, visitorId: 'a', path: '/', loadMs: 800 }),
  ev({ ts: T0 + 2 * MINUTE, visitorId: 'a', path: '/pricing' }),
  ev({ ts: T0 + 3 * MINUTE, visitorId: 'b', path: '/', country: 'US', loadMs: 1200 }),
  ev({
    ts: T0 + 65 * MINUTE,
    visitorId: 'c',
    path: '/docs',
    referrer: 'github.com',
    device: 'mobile',
    browser: 'Safari',
  }),
];

describe('RollupBuilder', () => {
  it('emits one row per granularity × bucket × dimension value', () => {
    const rows = new RollupBuilder().addAll(events).drain();
    const hourTotals = rows.filter((r) => r.granularity === 'hour' && r.dimension === 'total');
    expect(hourTotals.map((r) => [r.bucket, r.pageviews, r.visitors.count()])).toEqual([
      [T0, 3, 2],
      [T0 + HOUR, 1, 1],
    ]);
    const dayPages = rows.filter((r) => r.granularity === 'day' && r.dimension === 'page');
    expect(Object.fromEntries(dayPages.map((r) => [r.value, r.pageviews]))).toEqual({
      '/': 2,
      '/pricing': 1,
      '/docs': 1,
    });
    const loadRow = rows.find((r) => r.granularity === 'day' && r.dimension === 'total')!;
    expect(loadRow.loadSum / loadRow.loadCount).toBe(1000);
  });

  it('respects per-event granularity selection (tiered retention)', () => {
    const b = new RollupBuilder({ granularities: () => ['day'] });
    const rows = b.addAll(events).drain();
    expect(new Set(rows.map((r) => r.granularity))).toEqual(new Set(['day']));
    expect(b.size).toBe(0);
  });

  it('produces identical aggregates whether events arrive in one batch or many', () => {
    const one = new MemoryRollupStore();
    one.upsert(new RollupBuilder().addAll(events).drain());
    const many = new MemoryRollupStore();
    for (const e of [...events].reverse()) many.upsert(new RollupBuilder().addAll([e]).drain());
    const snapshot = (s: MemoryRollupStore) =>
      [
        ...s.scan({
          siteId: 'site',
          granularity: 'minute',
          dimension: 'country',
          from: 0,
          to: Infinity,
        }),
      ]
        .map((r) => `${r.bucket}:${r.value}:${r.pageviews}:${r.visitors.count()}`)
        .sort();
    expect(snapshot(many)).toEqual(snapshot(one));
    expect(many.rowCount).toBe(one.rowCount);
  });
});

describe('MemoryRollupStore', () => {
  it('scans half-open bucket ranges in order', () => {
    const store = new MemoryRollupStore();
    store.upsert(new RollupBuilder().addAll(events).drain());
    const hours = [
      ...store.scan({
        siteId: 'site',
        granularity: 'hour',
        dimension: 'total',
        from: T0,
        to: T0 + HOUR,
      }),
    ];
    expect(hours).toHaveLength(1);
    expect([
      ...store.scan({
        siteId: 'other',
        granularity: 'hour',
        dimension: 'total',
        from: 0,
        to: Infinity,
      }),
    ]).toEqual([]);
  });

  it('prunes each tier according to its retention', () => {
    const store = new MemoryRollupStore({ minute: HOUR, hour: DAY, day: Infinity });
    store.upsert(new RollupBuilder().addAll(events).drain());
    const before = store.rowCount;
    const removed = store.prune(T0 + 10 * DAY);
    expect(removed).toBeGreaterThan(0);
    expect(store.rowCount).toBe(before - removed);
    const tiers = new Set<string>();
    for (const g of ['minute', 'hour', 'day'] as const) {
      if (
        [
          ...store.scan({
            siteId: 'site',
            granularity: g,
            dimension: 'total',
            from: 0,
            to: Infinity,
          }),
        ].length
      )
        tiers.add(g);
    }
    expect(tiers).toEqual(new Set(['day']));
  });
});
