import { describe, expect, it } from 'vitest';
import {
  DAY,
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

  it('opens, extends and resolves incidents', () => {
    let open: Incident | null = null;
    const changes: Incident[] = [];
    const seq = [true, false, false, false, true, true];
    seq.forEach((ok, i) => {
      const res = applyCheckToIncident(open, check(i * MINUTE, ok), () => 'inc-1');
      open = res.open;
      if (res.changed) changes.push(res.changed);
    });
    expect(open).toBeNull();
    const last = changes.at(-1)!;
    expect(last).toMatchObject({
      id: 'inc-1',
      startedAt: MINUTE,
      resolvedAt: 4 * MINUTE,
      failures: 3,
      cause: 'HTTP 503',
    });
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
