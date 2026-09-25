export const DIRECT = '(direct)';
const MAX_PATH = 256;

function tryUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function stripWww(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/** `/Docs/Intro/?q=1#x` → `/Docs/Intro`. Keeps case (paths are case-sensitive). */
export function normalizePath(pageUrl: string): string {
  const parsed = tryUrl(pageUrl);
  let path = parsed ? parsed.pathname : (pageUrl.split(/[?#]/)[0] ?? '/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '') || '/';
  return path.slice(0, MAX_PATH);
}

/**
 * Referrer host without `www.`; `(direct)` for empty or same-site referrers.
 * `utm_source` / `ref` on the landing URL win over the Referer header.
 */
export function normalizeReferrer(
  referrer: string | undefined,
  pageUrl: string,
  siteDomain?: string,
): string {
  const page = tryUrl(pageUrl);
  const tagged = page?.searchParams.get('utm_source') ?? page?.searchParams.get('ref');
  if (tagged) return tagged.trim().toLowerCase().slice(0, 64) || DIRECT;
  if (!referrer) return DIRECT;
  const ref = tryUrl(referrer);
  if (!ref || !ref.hostname) return DIRECT;
  const host = stripWww(ref.hostname);
  const own = siteDomain ? stripWww(siteDomain) : page ? stripWww(page.hostname) : '';
  if (own && (host === own || host.endsWith(`.${own}`))) return DIRECT;
  return host;
}

/** True when `pageUrl` belongs to `domain` or one of its subdomains. */
export function urlMatchesDomain(pageUrl: string, domain: string): boolean {
  const page = tryUrl(pageUrl);
  if (!page) return false;
  const host = stripWww(page.hostname);
  const own = stripWww(domain);
  return host === own || host.endsWith(`.${own}`);
}

const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'cloudfront-viewer-country',
  'x-country-code',
];

/** Country from common CDN/proxy headers. Pulse never does IP geolocation itself. */
export function countryFromHeaders(headers: Record<string, string | string[] | undefined>): string {
  for (const name of COUNTRY_HEADERS) {
    const raw = headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1') return value;
  }
  return 'ZZ';
}
