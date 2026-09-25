/**
 * Pulse tracker — cookieless, < 2 KB minified.
 *
 *   <script defer src="https://pulse.example/p.js" data-site="my-site"></script>
 *
 * Optional: `data-api` overrides the ingestion endpoint. Set
 * `localStorage.pulse_ignore = 1` to exclude your own visits.
 * Tracks the first load and SPA navigations (pushState / popstate).
 */
((w: Window & { pulse?: () => void }, d: Document, l: Location, h: History) => {
  const script = d.currentScript as HTMLScriptElement | null;
  const site = script?.dataset.site;
  if (!script || !site) return;
  const endpoint = script.dataset.api || new URL(script.src).origin + '/api/event';
  let last = '';
  let first = true;

  const send = (): void => {
    const url = l.href;
    if (url === last) return;
    last = url;
    try {
      if (
        w.localStorage.getItem('pulse_ignore') ||
        (navigator as { webdriver?: boolean }).webdriver
      )
        return;
    } catch {
      /* storage blocked: still track */
    }
    const nav = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    const body = JSON.stringify({
      s: site,
      u: url,
      r: d.referrer || undefined,
      w: w.innerWidth,
      l: first && nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : undefined,
    });
    first = false;
    if (!navigator.sendBeacon?.(endpoint, body)) {
      void fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => undefined);
    }
  };

  const wrap = (method: 'pushState' | 'replaceState'): void => {
    const original = h[method];
    h[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      original.apply(this, args);
      send();
    };
  };
  wrap('pushState');
  wrap('replaceState');
  w.addEventListener('popstate', send);
  w.pulse = send;
  if (d.readyState === 'complete') send();
  else w.addEventListener('load', () => setTimeout(send));
})(window, document, location, history);
