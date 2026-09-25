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
import type { BreakdownParams, DataSource, Range } from '../source';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined>;

/** HTTP + WebSocket client for the Fastify backend in `/server`. */
export class ApiDataSource implements DataSource {
  readonly kind = 'api' as const;

  constructor(
    private readonly baseUrl = '',
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  private url(path: string, query: Query = {}): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return `${this.baseUrl}${path}${s ? `?${s}` : ''}`;
  }

  private async get<T>(path: string, query?: Query): Promise<T> {
    const res = await this.fetchImpl(this.url(path, query));
    if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText} — ${path}`);
    return (await res.json()) as T;
  }

  sites(): Promise<Site[]> {
    return this.get('/api/sites');
  }

  summary(siteId: string, r: Range): Promise<SummaryResponse> {
    return this.get(`/api/sites/${encodeURIComponent(siteId)}/summary`, { from: r.from, to: r.to });
  }

  timeseries(siteId: string, r: Range, interval?: Granularity): Promise<TimeseriesResponse> {
    return this.get(`/api/sites/${encodeURIComponent(siteId)}/timeseries`, {
      from: r.from,
      to: r.to,
      interval,
    });
  }

  breakdown(siteId: string, r: Range, p: BreakdownParams): Promise<BreakdownResponse> {
    return this.get(`/api/sites/${encodeURIComponent(siteId)}/breakdown`, {
      from: r.from,
      to: r.to,
      dimension: p.dimension,
      limit: p.limit,
      search: p.search,
    });
  }

  realtime(siteId: string): Promise<RealtimeResponse> {
    return this.get(`/api/sites/${encodeURIComponent(siteId)}/realtime`);
  }

  monitors(): Promise<MonitorOverview[]> {
    return this.get('/api/monitors');
  }

  monitor(id: string): Promise<MonitorDetail> {
    return this.get(`/api/monitors/${encodeURIComponent(id)}`);
  }

  exportUrl(siteId: string, r: Range, dimension: Dimension): string {
    return this.url(`/api/sites/${encodeURIComponent(siteId)}/export.csv`, {
      from: r.from,
      to: r.to,
      dimension,
    });
  }

  /** WebSocket with exponential-backoff reconnect. */
  subscribe(siteId: string, listener: (m: LiveMessage) => void): () => void {
    let socket: WebSocket | null = null;
    let closed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const base = this.baseUrl || location.origin;
    const wsUrl = `${base.replace(/^http/, 'ws')}/api/live?site=${encodeURIComponent(siteId)}`;

    const connect = () => {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (e) => listener(JSON.parse(String(e.data)) as LiveMessage);
      socket.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }
}
