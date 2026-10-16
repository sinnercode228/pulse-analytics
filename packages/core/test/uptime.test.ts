import { describe, expect, it } from 'vitest';
import {
  DAY,
  DEFAULT_FAILURE_THRESHOLD,
  HOUR,
  MINUTE,
  applyCheckToIncident,
  buildOverview,
  currentStatus,
  dayLevel,
  hourlyFromChecks,
  latencyStats,
  percentile,
  sparkline,
  uptimeRatio,
  type CheckResult,
  type Incident,
  type IncidentState,
  type Monitor,
} from '../src/index.js';

const monitor: Monitor = {
  id: 'm1',
  name: 'API',
  url: 'https://api.acme.example/health',
  method: 'GET',
  intervalSec: 60,
  timeoutMs: 5_000,
  degradedAfterMs: 500,
  failureThreshold: 2,
};
const NOW = Date.parse('2026-06-10T12:00:00Z');
const check = (ts: number, ok: boolean, latencyMs = 100): CheckResult => ({
  monitorId: 'm1',
  ts,
  ok,
  status: ok ? 200 : 503,
  latencyMs,
  error: ok ? null : 'HTTP 503',
});

describe('uptime math', () => {
  it('computes percentiles with linear interpolation', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10], 95)).toBe(10);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it('computes latency stats over successful checks only', () => {
    const stats = latencyStats([check(0, true, 100), check(1, true, 300), check(2, false, 5000)]);
    expect(stats).toEqual({ avg: 200, p50: 200, p95: 290, max: 300 });
    expect(latencyStats([check(0, false)])).toBeNull();
  });

  it('classifies days like a status page', () => {
    expect(dayLevel({ checks: 0, failures: 0 })).toBe('none');
    expect(dayLevel({ checks: 1440, failures: 0 })).toBe('operational');
    expect(dayLevel({ checks: 1440, failures: 10 })).toBe('minor');
    expect(dayLevel({ checks: 1440, failures: 60 })).toBe('partial');
    expect(dayLevel({ checks: 1440, failures: 400 })).toBe('major');
    expect(uptimeRatio([])).toBeNull();
  });

  it('derives the current status from the latest check', () => {
    expect(currentStatus(monitor, [])).toBe('unknown');
    expect(currentStatus(monitor, [check(0, true, 90)])).toBe('up');
    expect(currentStatus(monitor, [check(0, true, 900)])).toBe('degraded');
    expect(currentStatus(monitor, [check(0, true), check(1, false)])).toBe('down');
  });

  /** Feeds checks one minute apart, `false` for a failure; returns the final state and every incident. */
  function feed(seq: readonly (boolean | CheckResult)[], threshold: number) {
    let state: IncidentState = { open: null, pending: [] };
    const incidents = new Map<string, Incident>();
    seq.forEach((c, i) => {
      const next = applyCheckToIncident(
        state,
        typeof c === 'boolean' ? check(i * MINUTE, c) : c,
        threshold,
        () => `inc-${incidents.size + 1}`,
      );
      state = next.state;
      if (next.changed) incidents.set(next.changed.id, next.changed);
    });
    return { state, incidents: [...incidents.values()] };
  }

  it('does not open an incident for a single failed check by default', () => {
    expect(DEFAULT_FAILURE_THRESHOLD).toBe(2);
    const { state, incidents } = feed([true, false, true, true], DEFAULT_FAILURE_THRESHOLD);
    expect(incidents).toEqual([]);
    expect(state).toEqual({ open: null, pending: [] });
  });

  it('opens an incident at the first of two failed checks in a row and resolves it', () => {
    const ongoing = feed([true, false, false], 2);
    expect(ongoing.incidents).toEqual([
      {
        id: 'inc-1',
        monitorId: 'm1',
        startedAt: MINUTE,
        resolvedAt: null,
        cause: 'HTTP 503',
        failures: 2,
      },
    ]);
    expect(ongoing.state.open).toEqual(ongoing.incidents[0]);

    const resolved = feed([true, false, false, false, true, true], 2);
    expect(resolved.incidents).toHaveLength(1);
    expect(resolved.incidents[0]).toMatchObject({
      startedAt: MINUTE,
      resolvedAt: 4 * MINUTE,
      failures: 3,
    });
    expect(resolved.state).toEqual({ open: null, pending: [] });
  });

  it('takes the cause from the first failed check of the run', () => {
    const timeout: CheckResult = {
      ...check(0, false),
      status: null,
      error: 'Timeout after 5s',
    };
    const { incidents } = feed([timeout, false], 2);
    expect(incidents[0]).toMatchObject({ startedAt: 0, cause: 'Timeout after 5s', failures: 2 });
  });

  it('starts counting again after a successful check', () => {
    const { state, incidents } = feed([false, true, false, true, false, false, true, false], 3);
    expect(incidents).toEqual([]);
    expect(state.pending.map((c) => c.ts)).toEqual([7 * MINUTE]);

    const opened = feed([false, false, true, false, false, false], 3);
    expect(opened.incidents).toHaveLength(1);
    expect(opened.incidents[0]).toMatchObject({ startedAt: 3 * MINUTE, failures: 3 });
  });

  it('continues a run of failed checks passed in as state', () => {
    const restored: IncidentState = { open: null, pending: [check(0, false)] };
    const { state, changed } = applyCheckToIncident(restored, check(MINUTE, false), 2, () => 'x');
    expect(changed).toMatchObject({ id: 'x', startedAt: 0, failures: 2, resolvedAt: null });
    expect(state).toEqual({ open: changed, pending: [] });
  });

  it('opens an incident on the first failed check when the threshold is 1', () => {
    const { incidents } = feed([true, false, true, false, false, false, true, true], 1);
    expect(incidents).toEqual([
      {
        id: 'inc-1',
        monitorId: 'm1',
        startedAt: MINUTE,
        resolvedAt: 2 * MINUTE,
        cause: 'HTTP 503',
        failures: 1,
      },
      {
        id: 'inc-2',
        monitorId: 'm1',
        startedAt: 3 * MINUTE,
        resolvedAt: 6 * MINUTE,
        cause: 'HTTP 503',
        failures: 3,
      },
    ]);
  });

  it('buckets checks for sparklines and hourly heatmaps', () => {
    const checks = Array.from({ length: 120 }, (_, i) =>
      check(NOW - 2 * HOUR + i * MINUTE, i !== 70, 100 + (i % 2) * 100),
    );
    const spark = sparkline(checks, NOW - 2 * HOUR, NOW, 30 * MINUTE);
    expect(spark).toHaveLength(4);
    expect(spark[0]).toMatchObject({ latencyMs: 150, failures: 0 });
    expect(spark[2]!.failures).toBe(1);
    const hourly = hourlyFromChecks(checks, NOW - 2 * HOUR, NOW);
    expect(hourly.map((h) => h.checks)).toEqual([60, 60]);
  });

  it('builds a monitor overview with a 90-day heatmap', () => {
    const recent = Array.from({ length: 24 * 60 }, (_, i) =>
      check(NOW - DAY + (i + 1) * MINUTE, i < 1430),
    );
    const overview = buildOverview({
      monitor,
      now: NOW,
      recent,
      incidents: [],
      daily: [
        {
          day: Date.parse('2026-06-10T00:00:00Z'),
          checks: 720,
          failures: 10,
          latencySum: 72_000,
          latencyMax: 200,
        },
      ],
    });
    expect(overview.daily).toHaveLength(90);
    expect(overview.daily.at(-1)!.checks).toBe(720);
    expect(overview.status).toBe('down');
    expect(overview.uptime24h).toBeCloseTo(1430 / 1440, 5);
    expect(overview.sparkline).toHaveLength(96);
  });
});
