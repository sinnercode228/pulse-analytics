import {
  addToDaily,
  bucketStart,
  type CheckResult,
  type DailyUptime,
  type Incident,
  type Monitor,
} from '@pulse/core';
import { transaction, type Db } from './database.js';

export interface StoredMonitor extends Monitor {
  paused: boolean;
}

interface MonitorRow {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  interval_sec: number;
  timeout_ms: number;
  degraded_after_ms: number;
  paused: number;
}

interface CheckRow {
  monitor_id: string;
  ts: number;
  ok: number;
  status: number | null;
  latency_ms: number;
  error: string | null;
}

interface IncidentRow {
  id: string;
  monitor_id: string;
  started_at: number;
  resolved_at: number | null;
  cause: string;
  failures: number;
}

const toMonitor = (r: MonitorRow): StoredMonitor => ({
  id: r.id,
  name: r.name,
  url: r.url,
  method: r.method,
  intervalSec: r.interval_sec,
  timeoutMs: r.timeout_ms,
  degradedAfterMs: r.degraded_after_ms,
  paused: r.paused === 1,
});

const toCheck = (r: CheckRow): CheckResult => ({
  monitorId: r.monitor_id,
  ts: r.ts,
  ok: r.ok === 1,
  status: r.status,
  latencyMs: r.latency_ms,
  error: r.error,
});

const toIncident = (r: IncidentRow): Incident => ({
  id: r.id,
  monitorId: r.monitor_id,
  startedAt: r.started_at,
  resolvedAt: r.resolved_at,
  cause: r.cause,
  failures: r.failures,
});

/** Raw checks are kept for a short window; daily rollups keep the 90-day heatmap cheap. */
export const RAW_CHECK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class UptimeRepository {
  constructor(private readonly db: Db) {}

  listMonitors(): StoredMonitor[] {
    return (
      this.db
        .prepare('SELECT * FROM monitors ORDER BY created_at, id')
        .all() as unknown as MonitorRow[]
    ).map(toMonitor);
  }

  getMonitor(id: string): StoredMonitor | undefined {
    const row = this.db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as
      MonitorRow | undefined;
    return row ? toMonitor(row) : undefined;
  }

  upsertMonitor(m: Monitor, paused = false, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO monitors (id, name, url, method, interval_sec, timeout_ms, degraded_after_ms, paused, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, url = excluded.url, method = excluded.method,
           interval_sec = excluded.interval_sec, timeout_ms = excluded.timeout_ms,
           degraded_after_ms = excluded.degraded_after_ms, paused = excluded.paused`,
      )
      .run(
        m.id,
        m.name,
        m.url,
        m.method,
        m.intervalSec,
        m.timeoutMs,
        m.degradedAfterMs,
        paused ? 1 : 0,
        now,
      );
  }

  openIncident(monitorId: string): Incident | null {
    const row = this.db
      .prepare(
        'SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1',
      )
      .get(monitorId) as IncidentRow | undefined;
    return row ? toIncident(row) : null;
  }

  /** Persists one check: raw row, daily rollup and (optionally) the incident it changed. */
  recordCheck(check: CheckResult, incident: Incident | null, timeZone = 'UTC'): void {
    transaction(this.db, () => {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO checks (monitor_id, ts, ok, status, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          check.monitorId,
          check.ts,
          check.ok ? 1 : 0,
          check.status,
          Math.round(check.latencyMs),
          check.error,
        );
      const day = bucketStart(check.ts, 'day', timeZone);
      const current =
        this.daily(check.monitorId, day, day + 1)[0] ??
        ({ day, checks: 0, failures: 0, latencySum: 0, latencyMax: 0 } satisfies DailyUptime);
      this.writeDaily(check.monitorId, addToDaily(current, check));
      if (incident) this.writeIncident(incident);
    });
  }

  writeDaily(monitorId: string, d: DailyUptime): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO uptime_daily (monitor_id, day, checks, failures, latency_sum, latency_max)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(monitorId, d.day, d.checks, d.failures, d.latencySum, d.latencyMax);
  }

  writeIncident(i: Incident): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO incidents (id, monitor_id, started_at, resolved_at, cause, failures)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(i.id, i.monitorId, i.startedAt, i.resolvedAt, i.cause, i.failures);
  }

  insertChecks(checks: readonly CheckResult[]): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO checks (monitor_id, ts, ok, status, latency_ms, error) VALUES (?, ?, ?, ?, ?, ?)',
    );
    transaction(this.db, () => {
      for (const c of checks)
        stmt.run(c.monitorId, c.ts, c.ok ? 1 : 0, c.status, Math.round(c.latencyMs), c.error);
    });
  }

  checks(monitorId: string, from: number, to = Number.MAX_SAFE_INTEGER): CheckResult[] {
    return (
      this.db
        .prepare('SELECT * FROM checks WHERE monitor_id = ? AND ts >= ? AND ts <= ? ORDER BY ts')
        .all(monitorId, from, to) as unknown as CheckRow[]
    ).map(toCheck);
  }

  daily(monitorId: string, from: number, to = Number.MAX_SAFE_INTEGER): DailyUptime[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM uptime_daily WHERE monitor_id = ? AND day >= ? AND day < ? ORDER BY day',
        )
        .all(monitorId, from, to) as unknown as {
        day: number;
        checks: number;
        failures: number;
        latency_sum: number;
        latency_max: number;
      }[]
    ).map((r) => ({
      day: r.day,
      checks: r.checks,
      failures: r.failures,
      latencySum: r.latency_sum,
      latencyMax: r.latency_max,
    }));
  }

  incidents(monitorId: string, limit = 20): Incident[] {
    return (
      this.db
        .prepare('SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(monitorId, limit) as unknown as IncidentRow[]
    ).map(toIncident);
  }

  pruneChecks(now: number): number {
    return Number(
      this.db.prepare('DELETE FROM checks WHERE ts < ?').run(now - RAW_CHECK_RETENTION_MS).changes,
    );
  }
}
