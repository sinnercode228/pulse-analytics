import { DAY, HOUR, MINUTE } from '@pulse/core';
import { describe, expect, it } from 'vitest';
import { countryFlag, countryName } from '../src/lib/countries';
import { toCsv } from '../src/lib/csv';
import { delta, formatMs, formatNumber, formatUptime, timeAgo } from '../src/lib/format';
import { MAX_HISTORY_MS, isLive, presetRange, shiftRange } from '../src/lib/ranges';
import { readHash, selectRange, writeHash } from '../src/state/store';

describe('formatting', () => {
  it('formats numbers, durations and uptime', () => {
    expect(formatNumber(9876)).toBe('9,876');
    expect(formatNumber(12_345)).toBe('12.3K');
    expect(formatMs(840)).toBe('840 ms');
    expect(formatMs(1330)).toBe('1.33 s');
    expect(formatMs(null)).toBe('—');
    expect(formatUptime(1)).toBe('100%');
    expect(formatUptime(0.99975)).toBe('99.975%');
    expect(formatUptime(0.9812)).toBe('98.12%');
    expect(delta(110, 100)).toBeCloseTo(0.1);
    expect(delta(5, 0)).toBeNull();
    expect(timeAgo(1_000_000 - 90_000, 1_000_000)).toBe('1m ago');
  });

  it('maps countries to names and flags', () => {
    expect(countryName('DE')).toBe('Germany');
    expect(countryName('ZZ')).toBe('Unknown');
    expect(countryFlag('DE')).toBe('🇩🇪');
    expect(countryFlag('ZZ')).toBe('🌐');
  });

  it('builds safe CSV', () => {
    expect(
      toCsv(
        ['page', 'n'],
        [
          ['/a,b', 1],
          ['=HYPERLINK()', 2],
        ],
      ),
    ).toBe('page,n\r\n"/a,b",1\r\n\'=HYPERLINK(),2\r\n');
  });
});

describe('ranges', () => {
  const now = Date.parse('2026-06-10T12:00:00Z');

  it('computes presets that end now', () => {
    expect(presetRange('24h', now)).toEqual({ from: now - DAY, to: now });
    expect(presetRange('30m', now)).toEqual({ from: now - 30 * MINUTE, to: now });
    expect(isLive(presetRange('7d', now), now)).toBe(true);
  });

  it('shifts windows without leaving the retained history', () => {
    const r = { from: now - 2 * HOUR, to: now };
    expect(shiftRange(r, -1, now)).toEqual({ from: now - 4 * HOUR, to: now - 2 * HOUR });
    expect(shiftRange(r, 1, now)).toEqual(r);
    const old = shiftRange({ from: now - MAX_HISTORY_MS, to: now - MAX_HISTORY_MS + DAY }, -1, now);
    expect(old.from).toBe(now - MAX_HISTORY_MS);
  });

  it('selects the custom range only when active', () => {
    const custom = { from: 1, to: 2 };
    expect(selectRange({ preset: 'custom', custom }, now)).toBe(custom);
    expect(selectRange({ preset: '24h', custom }, now)).toEqual({ from: now - DAY, to: now });
  });

  it('round-trips view state through the URL hash', () => {
    expect(readHash('#/uptime/kestrel-api')).toEqual({ view: 'uptime', monitorId: 'kestrel-api' });
    expect(readHash('')).toEqual({});
    expect(writeHash({ view: 'uptime', monitorId: 'a b' })).toBe('#/uptime/a%20b');
    expect(writeHash({ view: 'analytics', monitorId: null })).toBe('#/analytics');
  });
});
