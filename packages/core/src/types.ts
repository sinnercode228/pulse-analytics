import type { Granularity } from './time.js';
import type { Hll } from './hll.js';

export type Device = 'desktop' | 'mobile' | 'tablet';

export const DIMENSIONS = ['page', 'referrer', 'country', 'device', 'browser'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type RollupDimension = 'total' | Dimension;

export function isDimension(value: unknown): value is Dimension {
  return typeof value === 'string' && (DIMENSIONS as readonly string[]).includes(value);
}

/** A normalized, anonymised pageview — the unit of ingestion. */
export interface PageviewEvent {
  siteId: string;
  /** Epoch milliseconds. */
  ts: number;
  /** Anonymous visitor id (daily-rotating salted hash on the server). */
  visitorId: string;
  path: string;
  /** Referrer host, or `(direct)`. */
  referrer: string;
  /** ISO 3166-1 alpha-2, `ZZ` when unknown. */
  country: string;
  device: Device;
  browser: string;
  /** Full page-load duration in ms (only for hard navigations). */
  loadMs?: number | undefined;
}

export interface RollupKey {
  siteId: string;
  granularity: Granularity;
  /** Bucket start, epoch ms. */
  bucket: number;
  dimension: RollupDimension;
  /** Dimension value, `''` for the `total` dimension. */
  value: string;
}

/** Mergeable aggregate state for one (site, granularity, bucket, dimension, value). */
export interface RollupRow extends RollupKey {
  pageviews: number;
  visitors: Hll;
  loadSum: number;
  loadCount: number;
}

export interface Site {
  id: string;
  name: string;
  domain: string;
  timeZone: string;
}
