import {
  countryFromHeaders,
  hash32,
  isBot,
  normalizePath,
  normalizeReferrer,
  parseBrowser,
  parseDevice,
  urlMatchesDomain,
  type PageviewEvent,
  type Site,
  type TrackerPayload,
} from '@pulse/core';

export type RejectReason = 'invalid' | 'unknown-site' | 'domain-mismatch' | 'bot';

export type ParseResult = { ok: true; event: PageviewEvent } | { ok: false; reason: RejectReason };

export interface RequestMeta {
  ip: string;
  userAgent: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  now: number;
}

export function decodePayload(body: unknown): TrackerPayload | null {
  let data = body;
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;
  const p = data as Record<string, unknown>;
  if (typeof p.s !== 'string' || typeof p.u !== 'string' || p.s.length > 64 || p.u.length > 2048)
    return null;
  return {
    s: p.s,
    u: p.u,
    r: typeof p.r === 'string' ? p.r.slice(0, 2048) : undefined,
    w: typeof p.w === 'number' && Number.isFinite(p.w) ? p.w : undefined,
    l:
      typeof p.l === 'number' && Number.isFinite(p.l) && p.l >= 0 && p.l < 120_000
        ? p.l
        : undefined,
    n: typeof p.n === 'string' ? p.n.slice(0, 64) : undefined,
  };
}

/** Anonymous visitor id: hash(daily salt, site, IP, UA). Nothing reversible is stored. */
export function visitorId(salt: string, siteId: string, ip: string, userAgent: string): string {
  const input = `${salt}|${siteId}|${ip}|${userAgent}`;
  return hash32(input, 1).toString(36) + hash32(input, 2).toString(36);
}

export function toPageview(
  payload: TrackerPayload,
  meta: RequestMeta,
  lookupSite: (id: string) => Site | undefined,
  salt: string,
): ParseResult {
  const site = lookupSite(payload.s);
  if (!site) return { ok: false, reason: 'unknown-site' };
  if (!urlMatchesDomain(payload.u, site.domain)) return { ok: false, reason: 'domain-mismatch' };
  if (isBot(meta.userAgent)) return { ok: false, reason: 'bot' };
  const ua = meta.userAgent!;
  return {
    ok: true,
    event: {
      siteId: site.id,
      ts: meta.now,
      visitorId: visitorId(salt, site.id, meta.ip, ua),
      path: normalizePath(payload.u),
      referrer: normalizeReferrer(payload.r, payload.u, site.domain),
      country: countryFromHeaders(meta.headers),
      device: parseDevice(ua, payload.w),
      browser: parseBrowser(ua),
      loadMs: payload.l === undefined ? undefined : Math.round(payload.l),
    },
  };
}
