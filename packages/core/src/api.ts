/**
 * Wire contracts shared by the Fastify API, the demo Web Worker and the
 * dashboard. Both data sources return exactly these shapes.
 */
import type { BreakdownResult, Summary, TimeseriesResult } from './query.js';
import type { Granularity } from './time.js';
import type { CheckResult } from './uptime.js';
import type { Device, Dimension } from './types.js';

export interface SummaryResponse {
  interval: Granularity;
  current: Summary;
  previous: Summary;
}

export type BreakdownResponse = BreakdownResult;
export type TimeseriesResponse = TimeseriesResult;

export interface LiveEvent {
  id: string;
  ts: number;
  path: string;
  referrer: string;
  country: string;
  device: Device;
  browser: string;
}

export interface RealtimeResponse {
  active: number;
  /** Pageviews per minute for the last 30 minutes. */
  perMinute: { t: number; pageviews: number; visitors: number }[];
  recent: LiveEvent[];
}

export type LiveMessage =
  | { type: 'hello'; siteId: string; active: number }
  | { type: 'pageview'; siteId: string; active: number; event: LiveEvent }
  | { type: 'active'; siteId: string; active: number }
  | { type: 'check'; check: CheckResult };

export interface StatsQueryParams {
  from: number;
  to: number;
}

export interface BreakdownQueryParams extends StatsQueryParams {
  dimension: Dimension;
  limit?: number;
  search?: string;
}

/** Wire format of the tracker beacon (kept terse to keep the script tiny). */
export interface TrackerPayload {
  /** site id */
  s: string;
  /** page URL */
  u: string;
  /** document.referrer */
  r?: string;
  /** viewport width */
  w?: number;
  /** page load duration, ms */
  l?: number;
  /** event name, defaults to "pageview" */
  n?: string;
}
