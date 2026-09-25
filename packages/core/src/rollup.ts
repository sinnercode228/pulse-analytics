import { hash32 } from './hash.js';
import { Hll } from './hll.js';
import { bucketStart, nextBucket, type Granularity } from './time.js';
import { DIMENSIONS, type PageviewEvent, type RollupDimension, type RollupRow } from './types.js';

export interface RollupBuilderOptions {
  /** Which granularities an event contributes to (lets callers skip expired tiers). */
  granularities: (event: PageviewEvent) => readonly Granularity[];
  /** Time zone used for `day` buckets of a site. */
  timeZone: (siteId: string) => string;
}

const ALL: readonly Granularity[] = ['minute', 'hour', 'day'];

export function rowKey(
  r: Pick<RollupRow, 'siteId' | 'granularity' | 'bucket' | 'dimension' | 'value'>,
): string {
  return `${r.siteId}\u0000${r.granularity}\u0000${r.bucket}\u0000${r.dimension}\u0000${r.value}`;
}

export function emptyRow(
  siteId: string,
  granularity: Granularity,
  bucket: number,
  dimension: RollupDimension,
  value: string,
): RollupRow {
  return {
    siteId,
    granularity,
    bucket,
    dimension,
    value,
    pageviews: 0,
    visitors: new Hll(),
    loadSum: 0,
    loadCount: 0,
  };
}

/** Merge `from` into `into` (associative & commutative — safe to apply in any order). */
export function mergeRow(into: RollupRow, from: RollupRow): RollupRow {
  into.pageviews += from.pageviews;
  into.visitors.merge(from.visitors);
  into.loadSum += from.loadSum;
  into.loadCount += from.loadCount;
  return into;
}

type DimensionIndex = Map<RollupDimension, Map<string, RollupRow>>;

/**
 * Folds raw events into partial aggregate rows — the equivalent of a
 * ClickHouse materialized view feeding an AggregatingMergeTree. Rows are
 * later merged into a {@link RollupRepository}.
 *
 * Hot path: one string key per (site, granularity, bucket) and then plain
 * Map lookups by dimension value, so the per-event cost stays tiny.
 */
export class RollupBuilder {
  private groups = new Map<string, DimensionIndex>();
  private count = 0;
  private readonly opts: RollupBuilderOptions;
  /** Memo of the last local day, because day buckets need a time-zone lookup. */
  private day = { tz: '', start: 0, end: -1 };

  constructor(opts: Partial<RollupBuilderOptions> = {}) {
    this.opts = {
      granularities: opts.granularities ?? (() => ALL),
      timeZone: opts.timeZone ?? (() => 'UTC'),
    };
  }

  /** Number of distinct rows accumulated so far. */
  get size(): number {
    return this.count;
  }

  add(event: PageviewEvent): void {
    const visitorHash = hash32(event.visitorId);
    const tz = this.opts.timeZone(event.siteId);
    const hasLoad =
      typeof event.loadMs === 'number' && Number.isFinite(event.loadMs) && event.loadMs >= 0;
    const load = hasLoad ? event.loadMs! : 0;
    for (const granularity of this.opts.granularities(event)) {
      const bucket =
        granularity === 'day'
          ? this.dayBucket(event.ts, tz)
          : bucketStart(event.ts, granularity, tz);
      const groupKey = `${event.siteId}\u0000${granularity}\u0000${bucket}`;
      let group = this.groups.get(groupKey);
      if (!group) {
        group = new Map();
        this.groups.set(groupKey, group);
      }
      this.bump(group, event.siteId, granularity, bucket, 'total', '', visitorHash, hasLoad, load);
      for (const dim of DIMENSIONS) {
        this.bump(
          group,
          event.siteId,
          granularity,
          bucket,
          dim,
          valueOf(event, dim),
          visitorHash,
          hasLoad,
          load,
        );
      }
    }
  }

  addAll(events: Iterable<PageviewEvent>): this {
    for (const e of events) this.add(e);
    return this;
  }

  /** Returns accumulated rows and resets the builder. */
  drain(): RollupRow[] {
    const out: RollupRow[] = [];
    for (const group of this.groups.values())
      for (const rows of group.values()) for (const row of rows.values()) out.push(row);
    this.groups = new Map();
    this.count = 0;
    return out;
  }

  private dayBucket(ts: number, tz: string): number {
    const d = this.day;
    if (d.tz === tz && ts >= d.start && ts < d.end) return d.start;
    const start = bucketStart(ts, 'day', tz);
    this.day = { tz, start, end: nextBucket(start, 'day', tz) };
    return start;
  }

  private bump(
    group: DimensionIndex,
    siteId: string,
    granularity: Granularity,
    bucket: number,
    dimension: RollupDimension,
    value: string,
    visitorHash: number,
    hasLoad: boolean,
    load: number,
  ): void {
    let rows = group.get(dimension);
    if (!rows) {
      rows = new Map();
      group.set(dimension, rows);
    }
    let row = rows.get(value);
    if (!row) {
      row = emptyRow(siteId, granularity, bucket, dimension, value);
      rows.set(value, row);
      this.count++;
    }
    row.pageviews += 1;
    row.visitors.addHash(visitorHash);
    if (hasLoad) {
      row.loadSum += load;
      row.loadCount += 1;
    }
  }
}

export function valueOf(event: PageviewEvent, dimension: RollupDimension): string {
  switch (dimension) {
    case 'total':
      return '';
    case 'page':
      return event.path;
    case 'referrer':
      return event.referrer;
    case 'country':
      return event.country;
    case 'device':
      return event.device;
    case 'browser':
      return event.browser;
  }
}
