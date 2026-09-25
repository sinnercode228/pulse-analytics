import { DAY, HOUR, MINUTE, bucketStart } from '../time.js';
import {
  addToDaily,
  applyCheckToIncident,
  type CheckResult,
  type DailyUptime,
  type HourlyUptime,
  type Incident,
  type Monitor,
} from '../uptime.js';
import { Rng } from './prng.js';

export interface IncidentPlan {
  /** Minutes before the anchor when the incident starts (negative = in the future). */
  startsAgoMin: number;
  durationMin: number;
  kind: 'down' | 'slow';
  cause: string;
  status?: number | null;
}

export interface MonitorProfile extends Monitor {
  baseLatencyMs: number;
  /** Log-normal sigma of latency jitter. */
  jitter: number;
  /** Probability of a random single failed check. */
  blipRate: number;
  incidents: readonly IncidentPlan[];
}

export const MONITOR_PROFILES: readonly MonitorProfile[] = [
  {
    id: 'orbitly-api',
    name: 'Orbitly API',
    url: 'https://api.orbitly.example/health',
    method: 'GET',
    intervalSec: 60,
    timeoutMs: 10_000,
    degradedAfterMs: 800,
    baseLatencyMs: 118,
    jitter: 0.22,
    blipRate: 0.00004,
    incidents: [
      {
        startsAgoMin: 60 * 24 * 41 + 130,
        durationMin: 23,
        kind: 'down',
        cause: 'HTTP 502',
        status: 502,
      },
      {
        startsAgoMin: 60 * 24 * 12 + 610,
        durationMin: 6,
        kind: 'down',
        cause: 'Timeout after 10s',
        status: null,
      },
    ],
  },
  {
    id: 'orbitly-docs',
    name: 'Orbitly Docs',
    url: 'https://docs.orbitly.example',
    method: 'HEAD',
    intervalSec: 60,
    timeoutMs: 10_000,
    degradedAfterMs: 600,
    baseLatencyMs: 46,
    jitter: 0.3,
    blipRate: 0.00002,
    incidents: [],
  },
  {
    id: 'kestrel-checkout',
    name: 'Kestrel Checkout',
    url: 'https://shop.kestrel.example/api/checkout/health',
    method: 'GET',
    intervalSec: 60,
    timeoutMs: 10_000,
    degradedAfterMs: 1200,
    baseLatencyMs: 284,
    jitter: 0.25,
    blipRate: 0.00006,
    incidents: [
      {
        startsAgoMin: 60 * 24 * 67 + 45,
        durationMin: 94,
        kind: 'down',
        cause: 'HTTP 503 Service Unavailable',
        status: 503,
      },
      {
        startsAgoMin: 60 * 24 * 12 + 200,
        durationMin: 38,
        kind: 'down',
        cause: 'Payment provider timeout',
        status: 504,
      },
      {
        startsAgoMin: 60 * 24 * 3 + 300,
        durationMin: 180,
        kind: 'slow',
        cause: 'Slow database queries',
      },
    ],
  },
  {
    id: 'kestrel-search',
    name: 'Kestrel Search',
    url: 'https://search.kestrel.example/ping',
    method: 'GET',
    intervalSec: 30,
    timeoutMs: 5_000,
    degradedAfterMs: 450,
    baseLatencyMs: 92,
    jitter: 0.35,
    blipRate: 0.00008,
    incidents: [
      {
        startsAgoMin: 60 * 24 * 29 + 80,
        durationMin: 12,
        kind: 'down',
        cause: 'Connection refused',
        status: null,
      },
      // Ongoing slowdown: the monitor shows "Degraded" when the demo opens.
      { startsAgoMin: 34, durationMin: 150, kind: 'slow', cause: 'Index rebuild in progress' },
    ],
  },
  {
    id: 'fernwood-web',
    name: 'Fernwood Journal',
    url: 'https://fernwood.example',
    method: 'GET',
    intervalSec: 60,
    timeoutMs: 10_000,
    degradedAfterMs: 900,
    baseLatencyMs: 162,
    jitter: 0.28,
    blipRate: 0.00003,
    incidents: [
      {
        startsAgoMin: 60 * 24 * 55 + 700,
        durationMin: 240,
        kind: 'down',
        cause: 'TLS certificate expired',
        status: null,
      },
    ],
  },
  {
    id: 'pulse-webhooks',
    name: 'Webhook relay',
    url: 'https://hooks.pulse-demo.example/healthz',
    method: 'GET',
    intervalSec: 30,
    timeoutMs: 5_000,
    degradedAfterMs: 500,
    baseLatencyMs: 64,
    jitter: 0.25,
    blipRate: 0.00005,
    incidents: [
      // Goes down a minute after the demo opens and recovers ~6 minutes later.
      {
        startsAgoMin: -1,
        durationMin: 6,
        kind: 'down',
        cause: 'HTTP 500 Internal Server Error',
        status: 500,
      },
      {
        startsAgoMin: 60 * 24 * 80 + 20,
        durationMin: 17,
        kind: 'down',
        cause: 'DNS resolution failed',
        status: null,
      },
    ],
  },
];

const RAW_RETENTION = DAY + HOUR;
const HOURLY_RETENTION = 14 * DAY;

/**
 * Deterministic synthetic checker: produces the same `CheckResult` stream a
 * real checker would, and folds it into daily/hourly rollups + incidents with
 * the exact functions the server uses.
 */
export class MonitorSimulator {
  readonly daily = new Map<number, DailyUptime>();
  readonly hourly = new Map<number, HourlyUptime & { latencySum: number; ok: number }>();
  readonly recent: CheckResult[] = [];
  readonly incidents: Incident[] = [];
  private openIncident: Incident | null = null;
  private cursor: number;
  private readonly rng: Rng;
  private incidentSeq = 0;
  private dayBucket = Number.NaN;
  private dayEnd = Number.NEGATIVE_INFINITY;

  constructor(
    readonly profile: MonitorProfile,
    private readonly anchor: number,
    start: number,
    private readonly timeZone = 'UTC',
    seed = 7,
  ) {
    const step = profile.intervalSec * 1000;
    this.cursor = Math.ceil(start / step) * step;
    this.rng = new Rng(seed ^ (profile.id.length * 7919));
  }

  get nextCheckAt(): number {
    return this.cursor;
  }

  advance(to: number, emit?: (check: CheckResult) => void): void {
    const step = this.profile.intervalSec * 1000;
    while (this.cursor <= to) {
      const check = this.check(this.cursor);
      this.record(check);
      emit?.(check);
      this.cursor += step;
    }
    this.trim(to);
  }

  private check(ts: number): CheckResult {
    const p = this.profile;
    const minutesAgo = (this.anchor - ts) / MINUTE;
    const incident = p.incidents.find(
      (i) => minutesAgo <= i.startsAgoMin && minutesAgo > i.startsAgoMin - i.durationMin,
    );
    const hour = new Date(ts).getUTCHours();
    const load = 1 + 0.22 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
    let latency = this.rng.logNormal(p.baseLatencyMs * load, p.jitter);
    if (incident?.kind === 'down' || (!incident && this.rng.chance(p.blipRate))) {
      const status = incident ? (incident.status ?? null) : null;
      return {
        monitorId: p.id,
        ts,
        ok: false,
        status,
        latencyMs: status === null ? p.timeoutMs : Math.round(latency * 0.6),
        error: incident?.cause ?? 'Timeout after ' + p.timeoutMs / 1000 + 's',
      };
    }
    if (incident?.kind === 'slow') latency *= 5 + this.rng.next() * 3;
    return {
      monitorId: p.id,
      ts,
      ok: true,
      status: 200,
      latencyMs: Math.round(latency),
      error: null,
    };
  }

  private record(check: CheckResult): void {
    if (check.ts >= this.dayEnd) {
      this.dayBucket = bucketStart(check.ts, 'day', this.timeZone);
      this.dayEnd = bucketStart(this.dayBucket + DAY + 2 * HOUR, 'day', this.timeZone);
    }
    let day = this.daily.get(this.dayBucket);
    if (!day) {
      day = { day: this.dayBucket, checks: 0, failures: 0, latencySum: 0, latencyMax: 0 };
      this.daily.set(this.dayBucket, day);
    }
    addToDaily(day, check);

    if (check.ts >= this.anchor - HOURLY_RETENTION) {
      const t = Math.floor(check.ts / HOUR) * HOUR;
      let h = this.hourly.get(t);
      if (!h) {
        h = { t, checks: 0, failures: 0, avgLatencyMs: null, latencySum: 0, ok: 0 };
        this.hourly.set(t, h);
      }
      h.checks += 1;
      if (check.ok) {
        h.ok += 1;
        h.latencySum += check.latencyMs;
        h.avgLatencyMs = Math.round(h.latencySum / h.ok);
      } else h.failures += 1;
    }
    if (check.ts >= this.anchor - RAW_RETENTION) this.recent.push(check);

    const { open, changed } = applyCheckToIncident(
      this.openIncident,
      check,
      () => `${this.profile.id}-inc-${++this.incidentSeq}`,
    );
    if (changed) {
      const idx = this.incidents.findIndex((i) => i.id === changed.id);
      if (idx >= 0) this.incidents[idx] = changed;
      else this.incidents.push(changed);
    }
    this.openIncident = open;
  }

  private trim(now: number): void {
    const cutoff = now - RAW_RETENTION;
    let drop = 0;
    while (drop < this.recent.length && this.recent[drop]!.ts < cutoff) drop++;
    if (drop > 0) this.recent.splice(0, drop);
  }

  hourlySeries(): HourlyUptime[] {
    return [...this.hourly.values()]
      .sort((a, b) => a.t - b.t)
      .map(({ t, checks, failures, avgLatencyMs }) => ({ t, checks, failures, avgLatencyMs }));
  }
}
