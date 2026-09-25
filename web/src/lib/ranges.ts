import { DAY, HOUR, MINUTE } from '@pulse/core';
import type { Range } from '../data/source';

export type PresetId = '30m' | 'today' | '24h' | '7d' | '30d' | 'custom';

export interface Preset {
  id: Exclude<PresetId, 'custom'>;
  label: string;
  short: string;
  key: string;
}

export const PRESETS: readonly Preset[] = [
  { id: '30m', label: 'Last 30 minutes', short: '30m', key: '1' },
  { id: 'today', label: 'Today', short: 'Today', key: '2' },
  { id: '24h', label: 'Last 24 hours', short: '24h', key: '3' },
  { id: '7d', label: 'Last 7 days', short: '7d', key: '4' },
  { id: '30d', label: 'Last 30 days', short: '30d', key: '5' },
];

/** Data retained by the demo (and default server tiers for the hourly view). */
export const MAX_HISTORY_MS = 30 * DAY;

export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Live presets end "now"; the query layer keeps the in-progress bucket for them. */
export function presetRange(id: Exclude<PresetId, 'custom'>, now: number): Range {
  switch (id) {
    case '30m':
      return { from: now - 30 * MINUTE, to: now };
    case 'today':
      return { from: startOfLocalDay(now), to: now };
    case '24h':
      return { from: now - 24 * HOUR, to: now };
    case '7d':
      return { from: startOfLocalDay(now - 6 * DAY), to: now };
    case '30d':
      return { from: startOfLocalDay(now - 29 * DAY), to: now };
  }
}

/** Moves a window by its own length, never past `now` or the retained history. */
export function shiftRange(r: Range, direction: -1 | 1, now: number): Range {
  const span = r.to - r.from;
  let from = r.from + direction * span;
  let to = r.to + direction * span;
  if (to > now) {
    to = now;
    from = now - span;
  }
  if (from < now - MAX_HISTORY_MS) {
    from = now - MAX_HISTORY_MS;
    to = from + span;
  }
  return { from, to };
}

export function isLive(r: Range, now: number): boolean {
  return r.to >= now - MINUTE;
}

/** `<input type="datetime-local">` value for a timestamp in local time. */
export function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * MINUTE);
  return d.toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): number {
  return new Date(value).getTime();
}
