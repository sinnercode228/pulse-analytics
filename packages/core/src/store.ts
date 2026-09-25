import { mergeRow } from './rollup.js';
import { DAY, HOUR, type Granularity } from './time.js';
import type { RollupDimension, RollupRow } from './types.js';

/** How long each rollup tier is kept, in ms (TTL-style downsampling). */
export type Retention = Record<Granularity, number>;

export const SERVER_RETENTION: Retention = {
  minute: 2 * DAY,
  hour: 35 * DAY,
  day: Number.POSITIVE_INFINITY,
};

export interface RollupScan {
  siteId: string;
  granularity: Granularity;
  dimension: RollupDimension;
  /** Inclusive bucket lower bound. */
  from: number;
  /** Exclusive bucket upper bound. */
  to: number;
}

/**
 * Storage for aggregate rows. `upsert` has merge semantics, so repositories
 * behave like an AggregatingMergeTree: writing a partial row twice sums it.
 */
export interface RollupRepository {
  readonly retention: Retention;
  upsert(rows: readonly RollupRow[]): void;
  scan(query: RollupScan): Iterable<RollupRow>;
  /** Drops rows older than the retention of each tier. Returns removed row count. */
  prune(now: number): number;
}

interface Series {
  /** Sorted bucket starts. */
  buckets: number[];
  rows: Map<number, Map<string, RollupRow>>;
}

function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** In-memory repository used by the browser demo and by unit tests. */
export class MemoryRollupStore implements RollupRepository {
  private series = new Map<string, Series>();

  constructor(readonly retention: Retention = SERVER_RETENTION) {}

  get rowCount(): number {
    let n = 0;
    for (const s of this.series.values()) for (const m of s.rows.values()) n += m.size;
    return n;
  }

  upsert(rows: readonly RollupRow[]): void {
    for (const row of rows) {
      const key = `${row.siteId}|${row.granularity}|${row.dimension}`;
      let series = this.series.get(key);
      if (!series) {
        series = { buckets: [], rows: new Map() };
        this.series.set(key, series);
      }
      let byValue = series.rows.get(row.bucket);
      if (!byValue) {
        byValue = new Map();
        series.rows.set(row.bucket, byValue);
        const b = series.buckets;
        if (b.length === 0 || b[b.length - 1]! < row.bucket) b.push(row.bucket);
        else b.splice(lowerBound(b, row.bucket), 0, row.bucket);
      }
      const existing = byValue.get(row.value);
      if (existing) mergeRow(existing, row);
      else byValue.set(row.value, row);
    }
  }

  *scan(q: RollupScan): Iterable<RollupRow> {
    const series = this.series.get(`${q.siteId}|${q.granularity}|${q.dimension}`);
    if (!series) return;
    const { buckets } = series;
    for (let i = lowerBound(buckets, q.from); i < buckets.length && buckets[i]! < q.to; i++) {
      yield* series.rows.get(buckets[i]!)!.values();
    }
  }

  prune(now: number): number {
    let removed = 0;
    for (const [key, series] of this.series) {
      const granularity = key.split('|')[1] as Granularity;
      // Keep one extra hour so a query window that starts exactly at the cutoff stays complete.
      const cutoff = now - this.retention[granularity] - HOUR;
      const idx = lowerBound(series.buckets, cutoff);
      if (idx === 0) continue;
      for (const bucket of series.buckets.slice(0, idx)) {
        removed += series.rows.get(bucket)!.size;
        series.rows.delete(bucket);
      }
      series.buckets.splice(0, idx);
    }
    return removed;
  }
}
