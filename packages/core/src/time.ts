export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type Granularity = 'minute' | 'hour' | 'day';
export const GRANULARITIES: readonly Granularity[] = ['minute', 'hour', 'day'];

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();
const OFFSET_SLOT = 15 * MINUTE; // offsets only ever change on quarter-hour boundaries

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** UTC offset of `timeZone` at instant `ts`, in minutes (e.g. +180 for Europe/Moscow). */
export function tzOffsetMinutes(ts: number, timeZone: string): number {
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return 0;
  const slot = Math.floor(ts / OFFSET_SLOT);
  const key = `${timeZone}|${slot}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const at = slot * OFFSET_SLOT;
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(at)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  const offset = Math.round((wall - at) / MINUTE);
  if (offsetCache.size > 50_000) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

/** Local midnight (in `timeZone`) of the day containing `ts`, as epoch ms. */
export function startOfDay(ts: number, timeZone = 'UTC'): number {
  const offset = tzOffsetMinutes(ts, timeZone) * MINUTE;
  const localMidnight = Math.floor((ts + offset) / DAY) * DAY;
  const offsetAtMidnight = tzOffsetMinutes(localMidnight - offset, timeZone) * MINUTE;
  return localMidnight - offsetAtMidnight;
}

export function bucketStart(ts: number, granularity: Granularity, timeZone = 'UTC'): number {
  switch (granularity) {
    case 'minute':
      return Math.floor(ts / MINUTE) * MINUTE;
    case 'hour':
      return Math.floor(ts / HOUR) * HOUR;
    case 'day':
      return startOfDay(ts, timeZone);
  }
}

export function nextBucket(bucket: number, granularity: Granularity, timeZone = 'UTC'): number {
  switch (granularity) {
    case 'minute':
      return bucket + MINUTE;
    case 'hour':
      return bucket + HOUR;
    case 'day':
      // +26h always lands inside the next local day, even across DST changes.
      return startOfDay(bucket + DAY + 2 * HOUR, timeZone);
  }
}

/** Bucket starts covering the half-open interval [from, to). */
export function bucketsBetween(
  from: number,
  to: number,
  granularity: Granularity,
  timeZone = 'UTC',
): number[] {
  const out: number[] = [];
  for (
    let b = bucketStart(from, granularity, timeZone);
    b < to;
    b = nextBucket(b, granularity, timeZone)
  ) {
    out.push(b);
    if (out.length > 10_000) throw new RangeError('Range too large for the chosen granularity');
  }
  return out;
}
