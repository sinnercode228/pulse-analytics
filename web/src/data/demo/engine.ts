import {
  ActiveVisitors,
  DAY,
  MINUTE,
  MemoryRollupStore,
  RollupBuilder,
  buildOverview,
  bucketStart,
  chooseInterval,
  queryPreviousSummary,
  queryBreakdown,
  querySummary,
  queryTimeseries,
  type BreakdownResponse,
  type Granularity,
  type LiveEvent,
  type LiveMessage,
  type Monitor,
  type MonitorDetail,
  type MonitorOverview,
  type PageviewEvent,
  type RealtimeResponse,
  type Retention,
  type Site,
  type SummaryResponse,
  type TimeseriesResponse,
} from '@pulse/core';
import {
  MONITOR_PROFILES,
  MonitorSimulator,
  SITE_PROFILES,
  TrafficSimulator,
  type MonitorProfile,
} from '@pulse/core/synth';
import type { BreakdownParams, Range } from '../source';

export interface DemoEngineOptions {
  now?: () => number;
  historyDays?: number;
  timeZone?: string;
  seed?: number;
}

/** The demo keeps 30 days: minute tier for 2 days, hour tier for the whole window. */
export const DEMO_RETENTION: Retention = {
  minute: 2 * DAY,
  hour: 35 * DAY,
  day: Number.POSITIVE_INFINITY,
};

interface SiteState {
  site: Site;
  sim: TrafficSimulator;
  store: MemoryRollupStore;
  builder: RollupBuilder;
  active: ActiveVisitors;
  recent: LiveEvent[];
  seq: number;
}

const RECENT_LIMIT = 50;

/**
 * Everything the backend does, in the browser: synthetic traffic flows through
 * the same RollupBuilder → rollup store → query functions that the Fastify
 * server uses, so the Pages demo exercises the real engine end to end.
 * Runs inside a Web Worker (see `worker.ts`); plain class so it is unit-testable.
 */
export class DemoEngine {
  private readonly now: () => number;
  private readonly historyDays: number;
  private readonly tz: string;
  private readonly seed: number;
  private readonly states = new Map<string, SiteState>();
  private monitorSims: MonitorSimulator[] | null = null;

  constructor(opts: DemoEngineOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.historyDays = opts.historyDays ?? 30;
    this.tz = opts.timeZone ?? 'UTC';
    this.seed = opts.seed ?? 42;
  }

  sites(): Site[] {
    return SITE_PROFILES.map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      timeZone: this.tz,
    }));
  }

  /** Lazily backfills a site's history the first time it is queried. */
  private state(siteId: string): SiteState {
    const existing = this.states.get(siteId);
    if (existing) {
      this.advance(existing, this.now());
      return existing;
    }
    const profile = SITE_PROFILES.find((p) => p.id === siteId);
    if (!profile) throw new Error(`Unknown site: ${siteId}`);
    const now = this.now();
    const start = now - this.historyDays * DAY;
    const tz = this.tz;
    const state: SiteState = {
      site: { id: profile.id, name: profile.name, domain: profile.domain, timeZone: tz },
      sim: new TrafficSimulator({ profile, start, anchor: now, seed: this.seed }),
      store: new MemoryRollupStore(DEMO_RETENTION),
      builder: new RollupBuilder({
        timeZone: () => tz,
        granularities: (e): Granularity[] =>
          this.now() - e.ts < DEMO_RETENTION.minute ? ['minute', 'hour', 'day'] : ['hour', 'day'],
      }),
      active: new ActiveVisitors(),
      recent: [],
      seq: 0,
    };
    this.states.set(siteId, state);
    this.advance(state, now);
    return state;
  }

  private advance(s: SiteState, to: number, emit?: (m: LiveMessage) => void): void {
    const activeFrom = to - s.active.windowMs;
    s.sim.advance(to, (e) => {
      s.builder.add(e);
      if (s.builder.size > 50_000) s.store.upsert(s.builder.drain());
      if (e.ts < activeFrom - 30 * MINUTE) return;
      s.active.touch(e.visitorId, e.ts);
      const live = this.toLive(s, e);
      s.recent.push(live);
      if (s.recent.length > RECENT_LIMIT * 2) s.recent.splice(0, s.recent.length - RECENT_LIMIT);
      emit?.({ type: 'pageview', siteId: s.site.id, active: s.active.count(e.ts), event: live });
    });
    s.store.upsert(s.builder.drain());
  }

  private toLive(s: SiteState, e: PageviewEvent): LiveEvent {
    return {
      id: `${e.ts.toString(36)}-${(++s.seq).toString(36)}`,
      ts: e.ts,
      path: e.path,
      referrer: e.referrer,
      country: e.country,
      device: e.device,
      browser: e.browser,
    };
  }

  /** Advances the live simulation for `siteId` and all monitors; returns messages to stream. */
  tick(siteId: string | null): LiveMessage[] {
    const out: LiveMessage[] = [];
    const now = this.now();
    if (siteId && this.states.has(siteId))
      this.advance(this.states.get(siteId)!, now, (m) => out.push(m));
    if (this.monitorSims) {
      for (const sim of this.monitorSims)
        sim.advance(now, (check) => out.push({ type: 'check', check }));
    }
    if (siteId && this.states.has(siteId)) {
      out.push({ type: 'active', siteId, active: this.states.get(siteId)!.active.count(now) });
    }
    return out;
  }

  private range(siteId: string, r: Range, interval?: Granularity) {
    return {
      siteId,
      from: r.from,
      to: r.to,
      timeZone: this.tz,
      now: this.now(),
      ...(interval ? { interval } : {}),
    };
  }

  summary(siteId: string, r: Range): SummaryResponse {
    const { store } = this.state(siteId);
    const q = this.range(siteId, r);
    return {
      interval: chooseInterval(q.from, q.to, store.retention, q.now),
      current: querySummary(store, q),
      previous: queryPreviousSummary(store, q),
    };
  }

  timeseries(siteId: string, r: Range, interval?: Granularity): TimeseriesResponse {
    return queryTimeseries(this.state(siteId).store, this.range(siteId, r, interval));
  }

  breakdown(siteId: string, r: Range, p: BreakdownParams): BreakdownResponse {
    return queryBreakdown(this.state(siteId).store, this.range(siteId, r), p.dimension, {
      ...(p.limit !== undefined ? { limit: p.limit } : {}),
      ...(p.search !== undefined ? { search: p.search } : {}),
    });
  }

  realtime(siteId: string): RealtimeResponse {
    const s = this.state(siteId);
    const now = this.now();
    const to = bucketStart(now, 'minute', this.tz) + MINUTE;
    const ts = queryTimeseries(
      s.store,
      this.range(siteId, { from: to - 30 * MINUTE, to }, 'minute'),
    );
    return {
      active: s.active.count(now),
      perMinute: ts.points.map((p) => ({ t: p.t, pageviews: p.pageviews, visitors: p.visitors })),
      recent: s.recent.slice(-RECENT_LIMIT).reverse(),
    };
  }

  private monitorsSims(): MonitorSimulator[] {
    if (!this.monitorSims) {
      const now = this.now();
      this.monitorSims = MONITOR_PROFILES.map(
        (p) => new MonitorSimulator(p, now, now - 90 * DAY, this.tz),
      );
    }
    const now = this.now();
    for (const sim of this.monitorSims) sim.advance(now);
    return this.monitorSims;
  }

  private overview(sim: MonitorSimulator): MonitorOverview {
    return buildOverview({
      monitor: plainMonitor(sim.profile),
      daily: [...sim.daily.values()],
      recent: sim.recent,
      incidents: sim.incidents,
      now: this.now(),
      timeZone: this.tz,
    });
  }

  monitors(): MonitorOverview[] {
    return this.monitorsSims().map((sim) => this.overview(sim));
  }

  monitor(id: string): MonitorDetail {
    const sim = this.monitorsSims().find((s) => s.profile.id === id);
    if (!sim) throw new Error(`Unknown monitor: ${id}`);
    const now = this.now();
    return {
      ...this.overview(sim),
      hourly: sim.hourlySeries().filter((h) => h.t >= now - 7 * DAY),
      recentChecks: sim.recent.slice(-50).reverse(),
    };
  }
}

function plainMonitor(p: MonitorProfile): Monitor {
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    method: p.method,
    intervalSec: p.intervalSec,
    timeoutMs: p.timeoutMs,
    degradedAfterMs: p.degradedAfterMs,
  };
}
