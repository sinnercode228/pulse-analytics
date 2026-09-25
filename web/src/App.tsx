import type { Site } from '@pulse/core';
import { useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import type { DataSource } from './data/source';
import { DataSourceContext } from './hooks/useDataSource';
import { useHotkeys } from './hooks/useHotkeys';
import { PRESETS, isLive } from './lib/ranges';
import { AnalyticsPage, type AnalyticsPageHandle } from './pages/AnalyticsPage';
import { UptimePage } from './pages/UptimePage';
import { useLive } from './state/live';
import { readHash, selectRange, useDashboard, writeHash } from './state/store';

const REFRESH_MS = 10_000;

export function App({ dataSource }: { dataSource: DataSource }) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const s = useDashboard();
  const analyticsRef = useRef<AnalyticsPageHandle>(null);

  useEffect(() => {
    dataSource
      .sites()
      .then((list) => {
        setSites(list);
        const st = useDashboard.getState();
        if (!st.siteId || !list.some((x) => x.id === st.siteId)) st.setSite(list[0]?.id ?? '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [dataSource]);

  // Two-way sync between the URL hash and the current view / open monitor.
  useEffect(() => {
    const apply = () => useDashboard.setState(readHash(location.hash));
    apply();
    window.addEventListener('hashchange', apply);
    const unsub = useDashboard.subscribe((st) => {
      const next = writeHash(st);
      if (location.hash !== next) history.replaceState(null, '', next);
    });
    return () => {
      window.removeEventListener('hashchange', apply);
      unsub();
    };
  }, []);

  // Live stream for the selected site.
  useEffect(() => {
    if (!s.siteId) return;
    const live = useLive.getState();
    live.reset(s.siteId);
    const siteId = s.siteId;
    dataSource
      .realtime(siteId)
      .then((rt) => useLive.getState().seed(siteId, rt.active, rt.recent))
      .catch(() => undefined);
    return dataSource.subscribe(siteId, (m) => {
      if (!useDashboard.getState().paused) useLive.getState().apply(m);
    });
  }, [dataSource, s.siteId]);

  // Auto-refresh while the window reaches "now".
  useEffect(() => {
    const t = setInterval(() => {
      const st = useDashboard.getState();
      if (st.paused || document.hidden) return;
      if (st.view === 'uptime' || isLive(selectRange(st), Date.now())) st.refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  useHotkeys({
    a: () => s.setView('analytics'),
    u: () => s.setView('uptime'),
    ...Object.fromEntries(PRESETS.map((p) => [p.key, () => s.setPreset(p.id)])),
    c: () => s.setRangeOpen(true),
    ArrowLeft: () => s.shift(-1),
    ArrowRight: () => s.shift(1),
    s: () => {
      if (!sites?.length) return;
      const i = sites.findIndex((x) => x.id === s.siteId);
      s.setSite(sites[(i + 1) % sites.length]!.id);
    },
    v: () => s.setMetric(s.metric === 'visitors' ? 'pageviews' : 'visitors'),
    '/': () => {
      s.setView('analytics');
      requestAnimationFrame(() => analyticsRef.current?.focusSearch());
    },
    e: () => analyticsRef.current?.exportCsv(),
    l: () => s.togglePaused(),
    '?': () => s.setHelpOpen(true),
    Escape: () => {
      if (s.helpOpen) s.setHelpOpen(false);
      else if (s.rangeOpen) s.setRangeOpen(false);
      else if (s.monitorId) s.openMonitor(null);
    },
  });

  return (
    <DataSourceContext.Provider value={dataSource}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app">
        <Header sites={sites ?? []} sourceKind={dataSource.kind} />
        {error ? (
          <main className="page">
            <div className="error">
              Could not reach the Pulse API: {error}. Start the server (<code>npm run dev:api</code>
              ) or open the demo mode (<code>?source=demo</code>).
            </div>
          </main>
        ) : s.view === 'uptime' ? (
          <ErrorBoundary label="Uptime view failed">
            <UptimePage />
          </ErrorBoundary>
        ) : s.siteId ? (
          <ErrorBoundary label="Analytics view failed">
            <AnalyticsPage ref={analyticsRef} siteId={s.siteId} />
          </ErrorBoundary>
        ) : (
          <main className="page">
            <div className="skeleton" style={{ height: 480 }} aria-label="Loading" />
          </main>
        )}
        <Footer sourceKind={dataSource.kind} />
      </div>
      <ShortcutsDialog open={s.helpOpen} onClose={() => s.setHelpOpen(false)} />
    </DataSourceContext.Provider>
  );
}
