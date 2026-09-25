import {
  MINUTE,
  bucketStart,
  chooseInterval,
  queryPreviousSummary,
  queryBreakdown,
  querySummary,
  queryTimeseries,
  type BreakdownOptions,
  type BreakdownResponse,
  type Dimension,
  type Granularity,
  type RealtimeResponse,
  type RollupRepository,
  type SummaryResponse,
  type TimeseriesResponse,
} from '@pulse/core';
import type { SiteRegistry } from '../db/sites-repo.js';
import type { IngestPipeline } from '../ingest/pipeline.js';

export interface Range {
  from: number;
  to: number;
}

/** Read path shared by the REST API and the CSV export. */
export class StatsService {
  constructor(
    private readonly repo: RollupRepository,
    private readonly sites: SiteRegistry,
    private readonly pipeline: IngestPipeline,
    private readonly now: () => number = Date.now,
  ) {}

  private query(siteId: string, range: Range, interval?: Granularity) {
    this.pipeline.flush();
    return {
      siteId,
      from: range.from,
      to: range.to,
      timeZone: this.sites.timeZone(siteId),
      now: this.now(),
      ...(interval ? { interval } : {}),
    };
  }

  summary(siteId: string, range: Range): SummaryResponse {
    const q = this.query(siteId, range);
    return {
      interval: chooseInterval(q.from, q.to, this.repo.retention, q.now),
      current: querySummary(this.repo, q),
      previous: queryPreviousSummary(this.repo, q),
    };
  }

  timeseries(siteId: string, range: Range, interval?: Granularity): TimeseriesResponse {
    return queryTimeseries(this.repo, this.query(siteId, range, interval));
  }

  breakdown(
    siteId: string,
    range: Range,
    dimension: Dimension,
    opts: BreakdownOptions,
  ): BreakdownResponse {
    return queryBreakdown(this.repo, this.query(siteId, range), dimension, opts);
  }

  realtime(siteId: string): RealtimeResponse {
    const now = this.now();
    const to = bucketStart(now, 'minute') + MINUTE;
    const ts = queryTimeseries(
      this.repo,
      this.query(siteId, { from: to - 30 * MINUTE, to }, 'minute'),
    );
    return {
      active: this.pipeline.activeVisitors(siteId),
      perMinute: ts.points.map((p) => ({ t: p.t, pageviews: p.pageviews, visitors: p.visitors })),
      recent: this.pipeline.recentEvents(siteId),
    };
  }
}
