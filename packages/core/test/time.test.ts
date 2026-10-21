import { describe, expect, it } from 'vitest';
import {
  DAY,
  HOUR,
  MINUTE,
  bucketStart,
  bucketsBetween,
  isValidTimeZone,
  nextBucket,
  startOfDay,
  tzOffsetMinutes,
} from '../src/index.js';

const at = (iso: string) => Date.parse(iso);

describe('time buckets', () => {
  it('floors minute and hour buckets in UTC', () => {
    const ts = at('2026-05-10T13:47:31.500Z');
    expect(bucketStart(ts, 'minute')).toBe(at('2026-05-10T13:47:00Z'));
    expect(bucketStart(ts, 'hour')).toBe(at('2026-05-10T13:00:00Z'));
  });

  it('aligns hour buckets to a half-offset zone', () => {
    // 13:47 UTC is 19:17 in Kolkata (+5:30); the local hour starts at 19:00 IST = 13:30 UTC.
    const ts = at('2026-05-10T13:47:31.500Z');
    expect(bucketStart(ts, 'hour', 'Asia/Kolkata')).toBe(at('2026-05-10T13:30:00Z'));
    // Minute buckets are unaffected: every zone offset is a whole number of minutes.
    expect(bucketStart(ts, 'minute', 'Asia/Kolkata')).toBe(at('2026-05-10T13:47:00Z'));
    expect(bucketsBetween(ts, ts + 2 * HOUR, 'hour', 'Asia/Kolkata')).toEqual([
      at('2026-05-10T13:30:00Z'),
      at('2026-05-10T14:30:00Z'),
      at('2026-05-10T15:30:00Z'),
    ]);
  });

  it('keeps hour buckets an hour apart across a whole-hour DST change', () => {
    const tz = 'America/New_York';
    // The fall-back hour (EDT -> EST) still steps by one real hour per local hour.
    const b = bucketStart(at('2026-11-01T05:30:00Z'), 'hour', tz);
    expect(b).toBe(at('2026-11-01T05:00:00Z'));
    expect(nextBucket(b, 'hour', tz) - b).toBe(HOUR);
  });

  it('computes local midnight for fixed-offset zones', () => {
    expect(tzOffsetMinutes(at('2026-05-10T12:00:00Z'), 'Europe/Moscow')).toBe(180);
    expect(startOfDay(at('2026-05-10T22:30:00Z'), 'Europe/Moscow')).toBe(
      at('2026-05-10T21:00:00Z'),
    );
    expect(startOfDay(at('2026-05-10T20:59:59Z'), 'Europe/Moscow')).toBe(
      at('2026-05-09T21:00:00Z'),
    );
  });

  it('handles DST days that are 23 and 25 hours long', () => {
    const tz = 'America/New_York';
    const springForward = startOfDay(at('2026-03-08T12:00:00Z'), tz);
    expect(springForward).toBe(at('2026-03-08T05:00:00Z'));
    expect(nextBucket(springForward, 'day', tz) - springForward).toBe(23 * HOUR);
    const fallBack = startOfDay(at('2026-11-01T12:00:00Z'), tz);
    expect(nextBucket(fallBack, 'day', tz) - fallBack).toBe(25 * HOUR);
  });

  it('enumerates buckets for half-open ranges', () => {
    const from = at('2026-05-10T10:15:00Z');
    expect(bucketsBetween(from, from + 30 * MINUTE, 'minute')).toHaveLength(30);
    expect(bucketsBetween(from, from + 3 * HOUR, 'hour')).toEqual([
      at('2026-05-10T10:00:00Z'),
      at('2026-05-10T11:00:00Z'),
      at('2026-05-10T12:00:00Z'),
      at('2026-05-10T13:00:00Z'),
    ]);
    expect(bucketsBetween(from, from + 7 * DAY, 'day', 'Asia/Tokyo')).toHaveLength(8);
  });

  it('validates IANA zone names', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});
