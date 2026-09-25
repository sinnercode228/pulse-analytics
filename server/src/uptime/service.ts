import {
  DAY,
  applyCheckToIncident,
  buildOverview,
  hourlyFromChecks,
  type CheckResult,
  type MonitorDetail,
  type MonitorOverview,
} from '@pulse/core';
import { randomUUID } from 'node:crypto';
import type { StoredMonitor, UptimeRepository } from '../db/uptime-repo.js';
import type { LiveHub } from '../live/hub.js';
import { performCheck, type FetchLike } from './checker.js';

export interface UptimeServiceOptions {
  repo: UptimeRepository;
  hub?: LiveHub;
  fetch?: FetchLike;
  now?: () => number;
  timeZone?: string;
  log?: (msg: string) => void;
}

/**
 * Schedules probes per monitor, persists results (raw check + daily rollup +
 * incident state machine) and publishes them to the live feed.
 */
export class UptimeService {
  private timers = new Map<string, NodeJS.Timeout>();
  private readonly now: () => number;
  private readonly tz: string;

  constructor(private readonly opts: UptimeServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.tz = opts.timeZone ?? 'UTC';
  }

  async runCheck(monitor: StoredMonitor): Promise<CheckResult> {
    const check = await performCheck(monitor, this.opts.fetch, this.now);
    this.record(check);
    return check;
  }

  record(check: CheckResult): void {
    const { repo } = this.opts;
    const { changed } = applyCheckToIncident(repo.openIncident(check.monitorId), check, () =>
      randomUUID(),
    );
    repo.recordCheck(check, changed, this.tz);
    this.opts.hub?.publish({ type: 'check', check });
  }

  start(): void {
    this.stop();
    for (const monitor of this.opts.repo.listMonitors()) {
      if (monitor.paused) continue;
      const tick = () => {
        this.runCheck(monitor).catch((err: unknown) =>
          this.opts.log?.(`check ${monitor.id} failed: ${String(err)}`),
        );
      };
      tick();
      const timer = setInterval(tick, monitor.intervalSec * 1000);
      timer.unref();
      this.timers.set(monitor.id, timer);
    }
    const pruner = setInterval(() => this.opts.repo.pruneChecks(this.now()), 60 * 60 * 1000);
    pruner.unref();
    this.timers.set('__prune', pruner);
  }

  stop(): void {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }

  get running(): boolean {
    return this.timers.size > 0;
  }

  overviews(): MonitorOverview[] {
    return this.opts.repo.listMonitors().map((m) => this.overview(m));
  }

  overview(monitor: StoredMonitor): MonitorOverview {
    const now = this.now();
    const { repo } = this.opts;
    const { paused: _paused, ...plain } = monitor;
    return buildOverview({
      monitor: plain,
      daily: repo.daily(monitor.id, now - 91 * DAY),
      recent: repo.checks(monitor.id, now - DAY - 60_000),
      incidents: repo.incidents(monitor.id),
      now,
      timeZone: this.tz,
    });
  }

  detail(id: string): MonitorDetail | null {
    const monitor = this.opts.repo.getMonitor(id);
    if (!monitor) return null;
    const now = this.now();
    const overview = this.overview(monitor);
    const week = this.opts.repo.checks(id, now - 7 * DAY);
    return {
      ...overview,
      hourly: hourlyFromChecks(week, now - 7 * DAY, now),
      recentChecks: week.slice(-50).reverse(),
    };
  }
}
