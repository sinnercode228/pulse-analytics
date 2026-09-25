import {
  ActiveVisitors,
  RollupBuilder,
  type Granularity,
  type LiveEvent,
  type PageviewEvent,
  type RollupRepository,
} from '@pulse/core';
import type { LiveHub } from '../live/hub.js';

export interface PipelineOptions {
  repo: RollupRepository;
  hub: LiveHub;
  timeZone: (siteId: string) => string;
  /** Flush buffered aggregates at least this often. */
  flushIntervalMs?: number;
  /** ...or as soon as this many distinct rows are buffered. */
  maxBufferedRows?: number;
  recentLimit?: number;
  now?: () => number;
}

const LIVE_TIERS: readonly Granularity[] = ['minute', 'hour', 'day'];

/**
 * Write path: events are folded into an in-memory {@link RollupBuilder}
 * (thousands of pageviews collapse into a few hundred rows) and flushed to
 * storage in one transaction. Reads call `flush()` first, so queries always
 * see every accepted event.
 */
export class IngestPipeline {
  private builder: RollupBuilder;
  private readonly active = new Map<string, ActiveVisitors>();
  private readonly recent = new Map<string, LiveEvent[]>();
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private readonly now: () => number;
  private readonly recentLimit: number;
  private readonly maxBufferedRows: number;
  accepted = 0;

  constructor(private readonly opts: PipelineOptions) {
    this.now = opts.now ?? Date.now;
    this.recentLimit = opts.recentLimit ?? 50;
    this.maxBufferedRows = opts.maxBufferedRows ?? 5_000;
    this.builder = new RollupBuilder({ timeZone: opts.timeZone, granularities: () => LIVE_TIERS });
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.opts.flushIntervalMs ?? 2_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flush();
  }

  ingest(event: PageviewEvent): void {
    this.accepted++;
    this.builder.add(event);
    let counter = this.active.get(event.siteId);
    if (!counter) {
      counter = new ActiveVisitors();
      this.active.set(event.siteId, counter);
    }
    // Server-stamped events arrive in time order; skip anything already outside the window.
    if (event.ts > this.now() - counter.windowMs) counter.touch(event.visitorId, event.ts);

    const live: LiveEvent = {
      id: `${event.ts.toString(36)}-${(++this.seq).toString(36)}`,
      ts: event.ts,
      path: event.path,
      referrer: event.referrer,
      country: event.country,
      device: event.device,
      browser: event.browser,
    };
    let list = this.recent.get(event.siteId);
    if (!list) {
      list = [];
      this.recent.set(event.siteId, list);
    }
    list.push(live);
    if (list.length > this.recentLimit) list.splice(0, list.length - this.recentLimit);

    this.opts.hub.publish({
      type: 'pageview',
      siteId: event.siteId,
      active: counter.count(this.now()),
      event: live,
    });
    if (this.builder.size >= this.maxBufferedRows) this.flush();
  }

  /** Writes buffered aggregates. Returns the number of rows written. */
  flush(): number {
    if (this.builder.size === 0) return 0;
    const rows = this.builder.drain();
    this.opts.repo.upsert(rows);
    return rows.length;
  }

  activeVisitors(siteId: string): number {
    return this.active.get(siteId)?.count(this.now()) ?? 0;
  }

  recentEvents(siteId: string): LiveEvent[] {
    return [...(this.recent.get(siteId) ?? [])].reverse();
  }
}
