import {
  DAY,
  DIMENSIONS,
  HOUR,
  MAX_BUCKETS,
  MINUTE,
  type Dimension,
  type Granularity,
} from '@pulse/core';

export const rangeQuerySchema = {
  type: 'object',
  properties: {
    from: { type: 'integer', minimum: 0 },
    to: { type: 'integer', minimum: 0 },
  },
} as const;

export interface RangeQuerystring {
  from?: number;
  to?: number;
}

export const timeseriesQuerySchema = {
  type: 'object',
  properties: {
    ...rangeQuerySchema.properties,
    interval: { type: 'string', enum: ['minute', 'hour', 'day'] },
  },
} as const;

export interface TimeseriesQuerystring extends RangeQuerystring {
  interval?: Granularity;
}

export const breakdownQuerySchema = {
  type: 'object',
  required: ['dimension'],
  properties: {
    ...rangeQuerySchema.properties,
    dimension: { type: 'string', enum: [...DIMENSIONS] },
    limit: { type: 'integer', minimum: 1, maximum: 5000 },
    offset: { type: 'integer', minimum: 0 },
    search: { type: 'string', maxLength: 200 },
  },
} as const;

export interface BreakdownQuerystring extends RangeQuerystring {
  dimension: Dimension;
  limit?: number;
  offset?: number;
  search?: string;
}

export const siteParamsSchema = {
  type: 'object',
  required: ['siteId'],
  properties: { siteId: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

export interface SiteParams {
  siteId: string;
}

/** Defaults to the last 24 hours; clamps obviously invalid ranges. */
export function resolveRange(q: RangeQuerystring, now: number): { from: number; to: number } {
  const to = q.to ?? now;
  const from = q.from ?? to - DAY;
  if (from >= to) return { from: to - DAY, to };
  return { from: Math.max(from, to - 400 * DAY), to };
}

const BUCKET_MS: Record<Granularity, number> = { minute: MINUTE, hour: HOUR, day: DAY };

/**
 * Longest range, in buckets, that a forced `interval` may cover. One less than
 * MAX_BUCKETS because `from` snaps down to a bucket start, so a range n buckets
 * long can touch n + 1 of them. With the 400-day clamp above, only `minute` can
 * hit it.
 */
export const MAX_INTERVAL_SPAN = MAX_BUCKETS - 1;

export function fitsInterval(range: { from: number; to: number }, interval: Granularity): boolean {
  return range.to - range.from <= MAX_INTERVAL_SPAN * BUCKET_MS[interval];
}
