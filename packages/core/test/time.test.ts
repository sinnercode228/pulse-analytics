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
