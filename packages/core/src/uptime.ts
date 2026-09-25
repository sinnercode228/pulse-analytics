import { DAY, HOUR, MINUTE, bucketStart, bucketsBetween } from './time.js';

export interface Monitor {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'HEAD';
  intervalSec: number;
  timeoutMs: number;
  /** Responses slower than this are "degraded" even when successful. */
  degradedAfterMs: number;
}

export interface CheckResult {
  monitorId: string;
  ts: number;
  ok: boolean;
  /** HTTP status, `null` for network errors / timeouts. */
  status: number | null;
  latencyMs: number;
  error: string | null;
}

export type MonitorStatus = 'up' | 'degraded' | 'down' | 'unknown';
export type DayLevel = 'none' | 'operational' | 'minor' | 'partial' | 'major';

export interface DailyUptime {
  /** Local-midnight bucket, epoch ms. */
  day: number;
  checks: number;
  failures: number;
  latencySum: number;
  latencyMax: number;
}

export interface HourlyUptime {
  t: number;
  checks: number;
  failures: number;
  avgLatencyMs: number | null;
}

export interface Incident {
  id: string;
  monitorId: string;
  startedAt: number;
  /** `null` while ongoing. */
  resolvedAt: number | null;
  cause: string;
  failures: number;
}

export interface LatencyStats {
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

export interface SparkPoint {
  t: number;
  latencyMs: number | null;
  failures: number;
}

export interface MonitorOverview {
  monitor: Monitor;
  status: MonitorStatus;
  lastCheck: CheckResult | null;
  uptime24h: number | null;
  uptime30d: number | null;
  uptime90d: number | null;
  latency24h: LatencyStats | null;
  sparkline: SparkPoint[];
  daily: DailyUptime[];
  incidents: Incident[];
}

export interface MonitorDetail extends MonitorOverview {
  hourly: HourlyUptime[];
  recentChecks: CheckResult[];
}

/** Classifies an HTTP outcome. Anything < 400 counts as up. */
export function isSuccessStatus(status: number | null): boolean {
  return status !== null && status >= 200 && status < 400;
}

export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sortedAsc[lo]!;
  const b = sortedAsc[hi]!;
  return a + (b - a) * (rank - lo);
}

export function latencyStats(checks: readonly CheckResult[]): LatencyStats | null {
  const values = checks.filter((c) => c.ok).map((c) => c.latencyMs);
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    avg: Math.round(sum / values.length),
    p50: Math.round(percentile(values, 50)),
    p95: Math.round(percentile(values, 95)),
    max: Math.round(values[values.length - 1]!),
  };
}

export function uptimeRatio(rows: readonly { checks: number; failures: number }[]): number | null {
  let checks = 0;
  let failures = 0;
  for (const r of rows) {
    checks += r.checks;
    failures += r.failures;
  }
  return checks === 0 ? null : (checks - failures) / checks;
}

/** Status-page style colour level for one day. */
export function dayLevel(day: Pick<DailyUptime, 'checks' | 'failures'>): DayLevel {
  const ratio = uptimeRatio([day]);
  if (ratio === null) return 'none';
  if (ratio >= 0.9999) return 'operational';
  if (ratio >= 0.99) return 'minor';
  if (ratio >= 0.95) return 'partial';
  return 'major';
}

export function currentStatus(monitor: Monitor, recent: readonly CheckResult[]): MonitorStatus {
  const last = recent[recent.length - 1];
  if (!last) return 'unknown';
  if (!last.ok) return 'down';
  return last.latencyMs > monitor.degradedAfterMs ? 'degraded' : 'up';
}

export function addToDaily(daily: DailyUptime, check: CheckResult): DailyUptime {
  daily.checks += 1;
  if (!check.ok) daily.failures += 1;
  else {
    daily.latencySum += check.latencyMs;
    daily.latencyMax = Math.max(daily.latencyMax, check.latencyMs);
  }
  return daily;
}

/**
 * Incident state machine: returns what to persist after a check.
 * - failure with no open incident → open one
 * - success with an open incident → resolve it
 */
export function applyCheckToIncident(
  open: Incident | null,
  check: CheckResult,
  newId: () => string,
): { open: Incident | null; changed: Incident | null } {
  if (!check.ok) {
    if (open) {
      const next = { ...open, failures: open.failures + 1 };
      return { open: next, changed: next };
    }
    const created: Incident = {
      id: newId(),
      monitorId: check.monitorId,
      startedAt: check.ts,
      resolvedAt: null,
      cause: check.error ?? (check.status !== null ? `HTTP ${check.status}` : 'Unknown error'),
      failures: 1,
    };
    return { open: created, changed: created };
  }
  if (open) {
    const resolved = { ...open, resolvedAt: check.ts };
    return { open: null, changed: resolved };
  }
  return { open: null, changed: null };
}

interface CheckBucket {
  t: number;
  ok: number;
  failures: number;
  latencySum: number;
}

function bucketize(
  checks: readonly CheckResult[],
  from: number,
  to: number,
  bucketMs: number,
): CheckBucket[] {
  const start = Math.floor(from / bucketMs) * bucketMs;
  const n = Math.max(0, Math.ceil((to - start) / bucketMs));
  const out: CheckBucket[] = Array.from({ length: n }, (_, i) => ({
    t: start + i * bucketMs,
    ok: 0,
    failures: 0,
    latencySum: 0,
  }));
  for (const c of checks) {
    const b = out[Math.floor((c.ts - start) / bucketMs)];
    if (!b) continue;
    if (c.ok) {
      b.ok += 1;
      b.latencySum += c.latencyMs;
    } else b.failures += 1;
  }
  return out;
}

/** Average latency per bucket for a sparkline; failures are counted separately. */
export function sparkline(
  checks: readonly CheckResult[],
  from: number,
  to: number,
  bucketMs = 15 * MINUTE,
): SparkPoint[] {
  return bucketize(checks, from, to, bucketMs).map((b) => ({
    t: b.t,
    latencyMs: b.ok > 0 ? Math.round(b.latencySum / b.ok) : null,
    failures: b.failures,
  }));
}

/** Pads daily rows so the heatmap always renders exactly `days` cells. */
export function fillDaily(
  rows: readonly DailyUptime[],
  now: number,
  days: number,
  timeZone = 'UTC',
): DailyUptime[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const from = bucketStart(now - (days - 1) * DAY, 'day', timeZone);
  return bucketsBetween(from, now + 1, 'day', timeZone)
    .slice(-days)
    .map((day) => byDay.get(day) ?? { day, checks: 0, failures: 0, latencySum: 0, latencyMax: 0 });
}

export interface OverviewInput {
  monitor: Monitor;
  daily: readonly DailyUptime[];
  /** Raw checks for (at least) the last 24 hours, ascending. */
  recent: readonly CheckResult[];
  incidents: readonly Incident[];
  now: number;
  timeZone?: string;
}

/** Single source of truth for the monitor card — used by the API and the demo worker. */
export function buildOverview(input: OverviewInput): MonitorOverview {
  const { monitor, now } = input;
  const tz = input.timeZone ?? 'UTC';
  const dayAgo = now - DAY;
  const last24 = input.recent.filter((c) => c.ts > dayAgo);
  const daily = fillDaily(input.daily, now, 90, tz);
  return {
    monitor,
    status: currentStatus(monitor, input.recent),
    lastCheck: input.recent[input.recent.length - 1] ?? null,
    uptime24h: uptimeRatio(last24.map((c) => ({ checks: 1, failures: c.ok ? 0 : 1 }))),
    uptime30d: uptimeRatio(daily.slice(-30)),
    uptime90d: uptimeRatio(daily),
    latency24h: latencyStats(last24),
    sparkline: sparkline(last24, dayAgo, now),
    daily,
    incidents: [...input.incidents].sort((a, b) => b.startedAt - a.startedAt).slice(0, 20),
  };
}

export function hourlyFromChecks(
  checks: readonly CheckResult[],
  from: number,
  to: number,
): HourlyUptime[] {
  return bucketize(checks, from, to, HOUR).map((b) => ({
    t: b.t,
    checks: b.ok + b.failures,
    failures: b.failures,
    avgLatencyMs: b.ok > 0 ? Math.round(b.latencySum / b.ok) : null,
  }));
}
