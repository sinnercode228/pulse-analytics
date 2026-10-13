import { DAY, HOUR } from '@pulse/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { SaltStore } from '../src/ingest/salt.js';

const DAY1 = Date.parse('2026-06-10T00:00:00Z');
const storedDays = (db: Db) =>
  (db.prepare('SELECT day FROM salts ORDER BY day').all() as { day: number }[]).map(
    (r) => r.day * DAY,
  );

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('SaltStore', () => {
  it("keeps today's and yesterday's salt and deletes older ones", () => {
    const db = openDatabase(':memory:');
    const salts = new SaltStore(db);
    const first = salts.forTime(DAY1 + HOUR);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(salts.forTime(DAY1 + 23 * HOUR)).toBe(first);

    const second = salts.forTime(DAY1 + DAY + HOUR);
    expect(second).not.toBe(first);
    expect(storedDays(db)).toEqual([DAY1, DAY1 + DAY]);
    expect(salts.forTime(DAY1 + 2 * HOUR)).toBe(first);

    const third = salts.forTime(DAY1 + 2 * DAY + HOUR);
    expect(new Set([first, second, third]).size).toBe(3);
    expect(storedDays(db)).toEqual([DAY1 + DAY, DAY1 + 2 * DAY]);
  });

  it('survives a restart: the same day gets the same salt from the database', () => {
    dir = mkdtempSync(join(tmpdir(), 'pulse-salt-'));
    const path = join(dir, 'pulse.db');
    const before = openDatabase(path);
    const yesterday = new SaltStore(before).forTime(DAY1 + HOUR);
    const today = new SaltStore(before).forTime(DAY1 + DAY + HOUR);
    before.close();

    const after = openDatabase(path);
    const salts = new SaltStore(after);
    expect(salts.forTime(DAY1 + DAY + 20 * HOUR)).toBe(today);
    expect(salts.forTime(DAY1 + 5 * HOUR)).toBe(yesterday);
    after.close();
  });
});
