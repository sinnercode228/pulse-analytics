import { describe, expect, it } from 'vitest';
import {
  ActiveVisitors,
  DIRECT,
  MINUTE,
  countryFromHeaders,
  isBot,
  isDimension,
  normalizePath,
  normalizeReferrer,
  parseBrowser,
  parseDevice,
  urlMatchesDomain,
} from '../src/index.js';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const EDGE_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';

describe('user agent parsing', () => {
  it('detects browsers, most specific first', () => {
    expect(parseBrowser(CHROME_MAC)).toBe('Chrome');
    expect(parseBrowser(SAFARI_IPHONE)).toBe('Safari');
    expect(parseBrowser(EDGE_WIN)).toBe('Edge');
    expect(parseBrowser(FIREFOX)).toBe('Firefox');
    expect(parseBrowser('Mozilla/5.0 something')).toBe('Other');
  });

  it('prefers viewport width for device class', () => {
    expect(parseDevice(CHROME_MAC, 1440)).toBe('desktop');
    expect(parseDevice(CHROME_MAC, 900)).toBe('tablet');
    expect(parseDevice(SAFARI_IPHONE, 390)).toBe('mobile');
    expect(parseDevice(SAFARI_IPHONE)).toBe('mobile');
    expect(parseDevice(CHROME_MAC)).toBe('desktop');
  });

  it('filters bots, monitors and CLI clients', () => {
    expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(isBot('PulseUptime/1.0 (+monitor)')).toBe(true);
    expect(isBot('curl/8.7.1')).toBe(true);
    expect(isBot(undefined)).toBe(true);
    expect(isBot(CHROME_MAC)).toBe(false);
  });
});

describe('URL normalisation', () => {
  it('strips query, hash and trailing slashes', () => {
    expect(normalizePath('https://a.example/Docs/Intro/?q=1#top')).toBe('/Docs/Intro');
    expect(normalizePath('https://a.example/')).toBe('/');
    expect(normalizePath('/relative/path/')).toBe('/relative/path');
    expect(normalizePath(`https://a.example/${'x'.repeat(400)}`)).toHaveLength(256);
  });

  it('normalises referrers and ignores self-referrals', () => {
    const page = 'https://docs.acme.example/start';
    expect(normalizeReferrer('https://www.google.com/search?q=x', page)).toBe('google.com');
    expect(normalizeReferrer('https://docs.acme.example/other', page)).toBe(DIRECT);
    expect(normalizeReferrer('https://blog.acme.example/', page, 'acme.example')).toBe(DIRECT);
    expect(normalizeReferrer('', page)).toBe(DIRECT);
    expect(normalizeReferrer('not a url', page)).toBe(DIRECT);
  });

  it('lets utm_source / ref override the Referer header', () => {
    expect(normalizeReferrer('https://t.co/abc', 'https://x.example/?utm_source=Newsletter')).toBe(
      'newsletter',
    );
    expect(normalizeReferrer(undefined, 'https://x.example/?ref=producthunt')).toBe('producthunt');
  });

  it('matches domains and subdomains only', () => {
    expect(urlMatchesDomain('https://www.acme.example/a', 'acme.example')).toBe(true);
    expect(urlMatchesDomain('https://docs.acme.example/a', 'acme.example')).toBe(true);
    expect(urlMatchesDomain('https://acme.example.evil.test/a', 'acme.example')).toBe(false);
    expect(urlMatchesDomain('garbage', 'acme.example')).toBe(false);
  });

  it('reads country codes from CDN headers', () => {
    expect(countryFromHeaders({ 'cf-ipcountry': 'de' })).toBe('DE');
    expect(countryFromHeaders({ 'x-vercel-ip-country': ['JP'] })).toBe('JP');
    expect(countryFromHeaders({ 'cf-ipcountry': 'XX' })).toBe('ZZ');
    expect(countryFromHeaders({})).toBe('ZZ');
  });

  it('validates dimensions', () => {
    expect(isDimension('page')).toBe(true);
    expect(isDimension('total')).toBe(false);
  });
});

describe('ActiveVisitors', () => {
  it('counts distinct visitors inside a sliding window', () => {
    const active = new ActiveVisitors(5 * MINUTE);
    active.touch('a', 0);
    active.touch('b', 1 * MINUTE);
    active.touch('a', 2 * MINUTE);
    active.touch('c', 3 * MINUTE);
    expect(active.count(3 * MINUTE)).toBe(3);
    expect(active.count(6.5 * MINUTE)).toBe(2); // b expired, a refreshed at 2m
    expect(active.count(20 * MINUTE)).toBe(0);
  });
});
