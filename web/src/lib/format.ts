import type { Granularity } from '@pulse/core';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

/** 1234 → "1.2K" (full number below 10 000). */
export function formatNumber(n: number): string {
  return Math.abs(n) < 10_000 ? full.format(Math.round(n)) : compact.format(n);
}

export function formatExact(n: number): string {
  return full.format(Math.round(n));
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** Uptime ratio → "99.95%" with enough precision to tell nines apart. */
export function formatUptime(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return '—';
  const pct = ratio * 100;
  if (pct === 100) return '100%';
  return `${pct >= 99.9 ? pct.toFixed(3).replace(/0$/, '') : pct.toFixed(2)}%`;
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Relative change; `null` when there is no baseline. */
export function delta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${formatDuration(now - ts)} ago`;
}

const dateFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const timeFmt = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatBucket(ts: number, interval: Granularity): string {
  if (interval === 'day') return dateFmt.format(ts);
  if (interval === 'minute') return timeFmt.format(ts);
  return dateTimeFmt.format(ts);
}

export function formatDate(ts: number): string {
  return dateFmt.format(ts);
}

export function formatDateTime(ts: number): string {
  return dateTimeFmt.format(ts);
}

export function formatTime(ts: number): string {
  return timeFmt.format(ts);
}
