import { describe, expect, it } from 'vitest';
import { DAY, HOUR, MINUTE, type PageviewEvent } from '../src/index.js';
import {
  MONITOR_PROFILES,
  MonitorSimulator,
  Rng,
  SITE_PROFILES,
  TrafficSimulator,
  WeightedTable,
} from '../src/synth/index.js';

const ANCHOR = Date.parse('2026-06-10T12:00:00Z');
const docs = SITE_PROFILES[0]!;

function run(seed: number, days: number): PageviewEvent[] {
  const sim = new TrafficSimulator({
    profile: docs,
    start: ANCHOR - days * DAY,
    anchor: ANCHOR,
    seed,
  });
  const out: PageviewEvent[] = [];
  sim.advance(ANCHOR, (e) => out.push(e));
  return out;
}

describe('synthetic traffic', () => {
  it('is deterministic for a given seed', () => {
    expect(run(1, 1)).toEqual(run(1, 1));
    expect(run(1, 1)).not.toEqual(run(2, 1));
  });

  it('emits events in chronological order and never in the future', () => {
    const events = run(3, 2);
    expect(events.length).toBeGreaterThan(1000);
    for (let i = 1; i < events.length; i++)
      expect(events[i]!.ts).toBeGreaterThanOrEqual(events[i - 1]!.ts);
    expect(events.at(-1)!.ts).toBeLessThan(ANCHOR);
  });

  it('continues seamlessly when advanced in small live steps', () => {
    const sim = new TrafficSimulator({
      profile: docs,
      start: ANCHOR - HOUR,
      anchor: ANCHOR,
      seed: 9,
    });
    const out: PageviewEvent[] = [];
    for (let t = ANCHOR - HOUR; t <= ANCHOR; t += 5_000) sim.advance(t, (e) => out.push(e));
    expect(out.length).toBeGreaterThan(100);
    expect(new Set(out.map((e) => e.visitorId)).size).toBeLessThan(out.length);
  });

  it('models weekly seasonality (docs traffic dips at weekends)', () => {
    const sim = new TrafficSimulator({ profile: docs, start: ANCHOR, anchor: ANCHOR });
    const weekday = sim.sessionsPerHour(Date.parse('2026-06-10T14:00:00Z')); // Wednesday
    const sunday = sim.sessionsPerHour(Date.parse('2026-06-14T14:00:00Z'));
    expect(weekday).toBeGreaterThan(sunday * 1.5);
  });

  it('samples weighted tables proportionally', () => {
    const table = new WeightedTable([
      ['a', 3],
      ['b', 1],
    ] as const);
    const rng = new Rng(5);
    let a = 0;
    for (let i = 0; i < 10_000; i++) if (table.sample(rng) === 'a') a++;
    expect(a / 10_000).toBeCloseTo(0.75, 1);
  });
});

describe('synthetic monitors', () => {
  it('reproduces planned incidents and 90 days of daily rollups', () => {
    const profile = MONITOR_PROFILES.find((m) => m.id === 'kestrel-checkout')!;
    const sim = new MonitorSimulator(profile, ANCHOR, ANCHOR - 90 * DAY);
    sim.advance(ANCHOR);
    expect(sim.daily.size).toBeGreaterThanOrEqual(90);
    const causes = sim.incidents.map((i) => i.cause);
    expect(causes).toContain('Payment provider timeout');
    expect(sim.recent.at(-1)!.ts).toBeLessThanOrEqual(ANCHOR);
    expect(sim.recent[0]!.ts).toBeGreaterThanOrEqual(ANCHOR - DAY - HOUR);
    const next = sim.nextCheckAt;
    const emitted: number[] = [];
    sim.advance(next + 2 * MINUTE, (c) => emitted.push(c.ts));
    expect(emitted).toEqual([next, next + MINUTE, next + 2 * MINUTE]);
  });
});
