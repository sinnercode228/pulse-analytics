import {
  DAY,
  HOUR,
  MINUTE,
  MemoryRollupStore,
  RollupBuilder,
  queryBreakdown,
  querySummary,
  queryTimeseries,
  type PageviewEvent,
} from '@pulse/core';
import { SITE_PROFILES, TrafficSimulator } from '@pulse/core/synth';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { SqliteRollupRepository } from '../src/db/rollup-repo.js';

const NOW = Date.parse('2026-06-10T12:00:00Z');

function events(): PageviewEvent[] {
  const out: PageviewEvent[] = [];
  const sim = new TrafficSimulator({
    profile: SITE_PROFILES[1]!,
    start: NOW - 2 * DAY,
    anchor: NOW,
    seed: 3,
  });
  sim.advance(NOW, (e) => out.push(e));
  return out;
}

describe('SqliteRollupRepository', () => {
  it('answers queries exactly like the in-memory store (same engine, different storage)', () => {
    const evs = events();
    const memory = new MemoryRollupStore();
    const sqlite = new SqliteRollupRepository(openDatabase(':memory:'));
    // Write to SQLite in several partial batches to exercise merge-on-upsert.
    memory.upsert(new RollupBuilder().addAll(evs).drain());
    for (let i = 0; i < evs.length; i += 1500)
      sqlite.upsert(new RollupBuilder().addAll(evs.slice(i, i + 1500)).drain());

    const q = { siteId: evs[0]!.siteId, from: NOW - DAY, to: NOW, now: NOW };
    expect(querySummary(sqlite, q)).toEqual(querySummary(memory, q));
    expect(queryTimeseries(sqlite, q)).toEqual(queryTimeseries(memory, q));
    expect(queryBreakdown(sqlite, q, 'page', { limit: 20 })).toEqual(
      queryBreakdown(memory, q, 'page', { limit: 20 }),
    );
    expect(queryBreakdown(sqlite, q, 'country')).toEqual(queryBreakdown(memory, q, 'country'));
  });

  it('persists HyperLogLog sketches across upserts', () => {
    const repo = new SqliteRollupRepository(openDatabase(':memory:'));
    const base = {
      siteId: 's',
      ts: NOW,
      path: '/',
      referrer: '(direct)',
      country: 'DE',
      device: 'desktop' as const,
      browser: 'Chrome',
    };
    repo.upsert(
      new RollupBuilder()
        .addAll([
          { ...base, visitorId: 'a' },
          { ...base, visitorId: 'b' },
        ])
        .drain(),
    );
    repo.upsert(
      new RollupBuilder()
        .addAll([
          { ...base, visitorId: 'b' },
          { ...base, visitorId: 'c' },
        ])
        .drain(),
    );
    const s = querySummary(repo, {
      siteId: 's',
      from: NOW - HOUR,
      to: NOW + MINUTE,
      now: NOW + MINUTE,
    });
    expect(s).toMatchObject({ pageviews: 4, visitors: 3 });
  });

  it('prunes each tier by its retention', () => {
    const repo = new SqliteRollupRepository(openDatabase(':memory:'));
    const e = {
      siteId: 's',
      visitorId: 'v',
      path: '/',
      referrer: '(direct)',
      country: 'DE',
      device: 'desktop' as const,
      browser: 'Chrome',
    };
    repo.upsert(
      new RollupBuilder()
        .addAll([
          { ...e, ts: NOW - 10 * DAY },
          { ...e, ts: NOW },
        ])
        .drain(),
    );
    const before = repo.count();
    const removed = repo.prune(NOW);
    // The 10-day-old minute rows (1 total + 5 dimensions) go; hour/day rows stay.
    expect(removed).toBe(6);
    expect(repo.count()).toBe(before - 6);
  });
});
