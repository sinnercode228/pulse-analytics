import type {
  BreakdownResponse,
  Dimension,
  Granularity,
  LiveMessage,
  MonitorDetail,
  MonitorOverview,
  RealtimeResponse,
  Site,
  SummaryResponse,
  TimeseriesResponse,
} from '@pulse/core';

export interface Range {
  from: number;
  to: number;
}

export interface BreakdownParams {
  dimension: Dimension;
  limit?: number;
  search?: string;
}

/**
 * The dashboard talks only to this interface. Two implementations exist:
 * {@link ApiDataSource} (Fastify backend over HTTP + WebSocket) and
 * {@link DemoDataSource} (the same query engine running in a Web Worker).
 */
export interface DataSource {
  readonly kind: 'api' | 'demo';
  sites(): Promise<Site[]>;
  summary(siteId: string, range: Range): Promise<SummaryResponse>;
  timeseries(siteId: string, range: Range, interval?: Granularity): Promise<TimeseriesResponse>;
  breakdown(siteId: string, range: Range, params: BreakdownParams): Promise<BreakdownResponse>;
  realtime(siteId: string): Promise<RealtimeResponse>;
  monitors(): Promise<MonitorOverview[]>;
  monitor(id: string): Promise<MonitorDetail>;
  /** Streams live messages for a site. Returns an unsubscribe function. */
  subscribe(siteId: string, listener: (message: LiveMessage) => void): () => void;
  /** Returns a CSV export URL when the backend can serve one directly. */
  exportUrl?(siteId: string, range: Range, dimension: Dimension): string;
}
