import type { Device } from './types.js';

const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|go-http-client|axios|node-fetch|httpclient|preview/i;

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || userAgent.length < 10 || BOT_RE.test(userAgent);
}

export function parseBrowser(userAgent: string): string {
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return 'Edge';
  if (/OPR\/|Opera/.test(userAgent)) return 'Opera';
  if (/SamsungBrowser/.test(userAgent)) return 'Samsung Internet';
  if (/YaBrowser/.test(userAgent)) return 'Yandex Browser';
  if (/Firefox\/|FxiOS/.test(userAgent)) return 'Firefox';
  if (/Chrome\/|CriOS/.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'Other';
}

/** Prefer the reported viewport width; fall back to UA sniffing. */
export function parseDevice(userAgent: string, viewportWidth?: number): Device {
  if (typeof viewportWidth === 'number' && viewportWidth > 0) {
    if (viewportWidth < 768) return 'mobile';
    if (viewportWidth < 1100)
      return /Mobi|iPhone|Android.*Mobile/.test(userAgent) ? 'mobile' : 'tablet';
    return 'desktop';
  }
  if (/iPad|Tablet|Android(?!.*Mobile)/.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|Android/.test(userAgent)) return 'mobile';
  return 'desktop';
}
