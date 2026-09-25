import { emptyRow, mergeRow } from './rollup.js';
import type { RollupRepository } from './store.js';
import { DAY, HOUR, MINUTE, bucketStart, bucketsBetween, type Granularity } from './time.js';
import type { Dimension, RollupRow } from './types.js';

export interface RangeQuery {
  siteId: string;
  /** Inclusive, epoch ms. */
  from: number;
  /** Exclusive, epoch ms. */
  to: number;
  timeZone?: string;
  /** Force an interval instead of picking one from the range length. */
  interval?: Granularity;
  now?: number;
}

export interface Summary {
  visitors: number;
  pageviews: number;
  viewsPerVisitor: number;
  avgLoadMs: number | null;
}

export interface TimeseriesPoint {
  t: number;
  visitors: number;
  pageviews: number;
  avgLoadMs: number | null;
}

export interface TimeseriesResult {
  interval: Granularity;
  points: TimeseriesPoint[];
}

export interface BreakdownRow {
  value: string;
  visitors: number;
  pageviews: number;
  avgLoadMs: number | null;
}

export interface BreakdownResult {
  dimension: Dimension;
  /** Number of distinct values before `limit`/`offset`. */
  total: number;
  rows: BreakdownRow[];
}

export interface BreakdownOptions {
  limit?: number;
  offset?: number;
  search?: string;
}

/**
 * Picks the finest tier that keeps the point count reasonable (≤ ~200)
 * and is still retained for the requested window.
 */
export function chooseInterval(
  from: number,
  to: number,
  retention: RollupRepository['retention'],
  now = Date.now(),
): Granularity {
  const span = to - from;
  if (span <= 3 * HOUR + MINUTE && from >= now - retention.minute) return 'minute';
  if (span <= 8 * DAY + HOUR && from >= now - retention.hour) return 'hour';
  return 'day';
}

export function previousRange<T extends { from: number; to: number }>(q: T): T {
  const span = q.to - q.from;
  return { ...q, from: q.from - span, to: q.from };
}

/**
 * Snaps a range onto bucket boundaries. Both ends snap down, so adjacent
 * ranges (current vs previous period) never share a bucket — except that a
 * window reaching "now" keeps the in-progress bucket, so live data shows up.
 */
function resolve(
  repo: RollupRepository,
  q: RangeQuery,
): { interval: Granularity; tz: string; from: number; to: number } {
  const tz = q.timeZone ?? 'UTC';
  const now = q.now ?? Date.now();
  const interval = q.interval ?? chooseInterval(q.from, q.to, repo.retention, now);
  const from = bucketStart(q.from, interval, tz);
  const to = q.to >= now ? q.to : bucketStart(q.to, interval, tz);
  return { interval, tz, from, to: Math.max(from, to) };
}

const avg = (r: RollupRow): number | null =>
  r.loadCount > 0 ? Math.round(r.loadSum / r.loadCount) : null;

export function queryTimeseries(repo: RollupRepository, q: RangeQuery): TimeseriesResult {
  const { interval, tz, from, to } = resolve(repo, q);
  const buckets = bucketsBetween(from, to, interval, tz);
  const byBucket = new Map<number, RollupRow>();
  for (const row of repo.scan({
    siteId: q.siteId,
    granularity: interval,
    dimension: 'total',
    from,
    to,
  })) {
    const acc = byBucket.get(row.bucket);
    if (acc) mergeRow(acc, row);
    else
      byBucket.set(
        row.bucket,
        mergeRow(emptyRow(q.siteId, interval, row.bucket, 'total', ''), row),
      );
  }
  const points = buckets.map((t): TimeseriesPoint => {
    const r = byBucket.get(t);
    return r
      ? { t, visitors: r.visitors.count(), pageviews: r.pageviews, avgLoadMs: avg(r) }
      : { t, visitors: 0, pageviews: 0, avgLoadMs: null };
  });
  return { interval, points };
}

export function querySummary(repo: RollupRepository, q: RangeQuery): Summary {
  const { interval, from, to } = resolve(repo, q);
  const acc = emptyRow(q.siteId, interval, from, 'total', '');
  for (const row of repo.scan({
    siteId: q.siteId,
    granularity: interval,
    dimension: 'total',
    from,
    to,
  })) {
    mergeRow(acc, row);
  }
  const visitors = acc.visitors.count();
  return {
    visitors,
    pageviews: acc.pageviews,
    viewsPerVisitor: visitors > 0 ? Math.round((acc.pageviews / visitors) * 100) / 100 : 0,
    avgLoadMs: avg(acc),
  };
}

/** Summary with no data: the dashboard renders it as "no previous data". */
export const EMPTY_SUMMARY: Summary = {
  visitors: 0,
  pageviews: 0,
  viewsPerVisitor: 0,
  avgLoadMs: null,
};

/**
 * The previous period's summary, or {@link EMPTY_SUMMARY} when history does not
 * reach back far enough to cover it. Without this, a 30-day view over a site
 * with 31 days of data compares against a single day and reports +3000%.
 * Coverage is judged by traffic in the first tenth of the previous window, and
 * only for spans of a day or more (shorter windows are always covered by any
 * site that has been live for a day).
 */
export function queryPreviousSummary(repo: RollupRepository, q: RangeQuery): Summary {
  const prev = previousRange(q);
  const span = prev.to - prev.from;
  if (span >= DAY) {
    const head = querySummary(repo, { ...prev, to: prev.from + Math.floor(span / 10) });
    if (head.pageviews === 0) return EMPTY_SUMMARY;
  }
  return querySummary(repo, prev);
}

export function queryBreakdown(
  repo: RollupRepository,
  q: RangeQuery,
  dimension: Dimension,
  opts: BreakdownOptions = {},
): BreakdownResult {
  const { interval, from, to } = resolve(repo, q);
  const groups = new Map<string, RollupRow>();
  for (const row of repo.scan({ siteId: q.siteId, granularity: interval, dimension, from, to })) {
    let acc = groups.get(row.value);
    if (!acc) {
      acc = emptyRow(q.siteId, interval, from, dimension, row.value);
      groups.set(row.value, acc);
    }
    mergeRow(acc, row);
  }
  const needle = opts.search?.trim().toLowerCase();
  const rows: BreakdownRow[] = [];
  for (const acc of groups.values()) {
    if (needle && !acc.value.toLowerCase().includes(needle)) continue;
    rows.push({
      value: acc.value,
      visitors: acc.visitors.count(),
      pageviews: acc.pageviews,
      avgLoadMs: avg(acc),
    });
  }
  rows.sort(
    (a, b) =>
      b.visitors - a.visitors || b.pageviews - a.pageviews || a.value.localeCompare(b.value),
  );
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 5_000));
  return { dimension, total: rows.length, rows: rows.slice(offset, offset + limit) };
}
