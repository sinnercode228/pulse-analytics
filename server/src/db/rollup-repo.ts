import {
  HOUR,
  Hll,
  SERVER_RETENTION,
  mergeRow,
  type Granularity,
  type Retention,
  type RollupDimension,
  type RollupRepository,
  type RollupRow,
  type RollupScan,
} from '@pulse/core';
import { transaction, type Db } from './database.js';

interface DbRow {
  site_id: string;
  granularity: Granularity;
  dimension: RollupDimension;
  bucket: number;
  value: string;
  pageviews: number;
  visitors: Uint8Array;
  load_sum: number;
  load_count: number;
}

const toRow = (r: DbRow): RollupRow => ({
  siteId: r.site_id,
  granularity: r.granularity,
  dimension: r.dimension,
  bucket: r.bucket,
  value: r.value,
  pageviews: r.pageviews,
  visitors: Hll.fromBytes(r.visitors),
  loadSum: r.load_sum,
  loadCount: r.load_count,
});

/**
 * SQLite-backed rollup storage. `upsert` merges HyperLogLog sketches in JS
 * (read-merge-write inside one transaction), so the table behaves like an
 * AggregatingMergeTree: re-ingesting partial aggregates just adds up.
 */
export class SqliteRollupRepository implements RollupRepository {
  private readonly select;
  private readonly write;
  private readonly scanStmt;

  constructor(
    private readonly db: Db,
    readonly retention: Retention = SERVER_RETENTION,
  ) {
    this.select = db.prepare(
      `SELECT * FROM rollups WHERE site_id = ? AND granularity = ? AND dimension = ? AND bucket = ? AND value = ?`,
    );
    this.write = db.prepare(
      `INSERT OR REPLACE INTO rollups
         (site_id, granularity, dimension, bucket, value, pageviews, visitors, load_sum, load_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.scanStmt = db.prepare(
      `SELECT * FROM rollups
        WHERE site_id = ? AND granularity = ? AND dimension = ? AND bucket >= ? AND bucket < ?
        ORDER BY bucket`,
    );
  }

  upsert(rows: readonly RollupRow[]): void {
    if (rows.length === 0) return;
    transaction(this.db, () => {
      for (const row of rows) {
        const existing = this.select.get(
          row.siteId,
          row.granularity,
          row.dimension,
          row.bucket,
          row.value,
        ) as DbRow | undefined;
        const merged = existing ? mergeRow(toRow(existing), row) : row;
        this.write.run(
          merged.siteId,
          merged.granularity,
          merged.dimension,
          merged.bucket,
          merged.value,
          merged.pageviews,
          merged.visitors.toBytes(),
          merged.loadSum,
          merged.loadCount,
        );
      }
    });
  }

  *scan(q: RollupScan): Iterable<RollupRow> {
    const from = Number.isFinite(q.from) ? q.from : Number.MIN_SAFE_INTEGER;
    const to = Number.isFinite(q.to) ? q.to : Number.MAX_SAFE_INTEGER;
    for (const r of this.scanStmt.iterate(q.siteId, q.granularity, q.dimension, from, to)) {
      yield toRow(r as unknown as DbRow);
    }
  }

  prune(now: number): number {
    let removed = 0;
    for (const [granularity, ttl] of Object.entries(this.retention) as [Granularity, number][]) {
      if (!Number.isFinite(ttl)) continue;
      const res = this.db
        .prepare('DELETE FROM rollups WHERE granularity = ? AND bucket < ?')
        .run(granularity, now - ttl - HOUR);
      removed += Number(res.changes);
    }
    return removed;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM rollups').get() as { n: number }).n;
  }
}
