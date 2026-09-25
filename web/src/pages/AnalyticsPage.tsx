import { forwardRef, useImperativeHandle, useRef } from 'react';
import { BreakdownCard, type BreakdownCardHandle, type Tab } from '../components/BreakdownCard';
import { KpiRow } from '../components/KpiRow';
import { RealtimePanel } from '../components/RealtimePanel';
import { TimeseriesChart } from '../components/TimeseriesChart';
import { useDataSource } from '../hooks/useDataSource';
import { useQuery } from '../hooks/useQuery';
import { formatDateTime } from '../lib/format';
import { useLive } from '../state/live';
import { presetLabel, selectRange, useDashboard } from '../state/store';

const PAGE_TABS: Tab[] = [{ dimension: 'page', label: 'Pages' }];
const SOURCE_TABS: Tab[] = [{ dimension: 'referrer', label: 'Referrers' }];
const GEO_TABS: Tab[] = [{ dimension: 'country', label: 'Countries' }];
const TECH_TABS: Tab[] = [
  { dimension: 'device', label: 'Devices' },
  { dimension: 'browser', label: 'Browsers' },
];

export interface AnalyticsPageHandle {
  focusSearch(): void;
  exportCsv(): void;
}

export const AnalyticsPage = forwardRef<AnalyticsPageHandle, { siteId: string }>(
  function AnalyticsPage({ siteId }, ref) {
    const ds = useDataSource();
    const preset = useDashboard((s) => s.preset);
    const custom = useDashboard((s) => s.custom);
    const refreshKey = useDashboard((s) => s.refreshKey);
    const metric = useDashboard((s) => s.metric);
    const setMetric = useDashboard((s) => s.setMetric);
    const active = useLive((s) => s.active);
    const pagesRef = useRef<BreakdownCardHandle>(null);

    // Presets are re-evaluated on each refresh tick, so live windows slide forward.
    const range = selectRange({ preset, custom });
    const key = `${siteId}|${preset}|${custom?.from}|${custom?.to}|${refreshKey}`;
    const summary = useQuery(key, () => ds.summary(siteId, range));
    const series = useQuery(key, () => ds.timeseries(siteId, range));
    const realtime = useQuery(`${siteId}|${refreshKey}`, () => ds.realtime(siteId));

    useImperativeHandle(ref, () => ({
      focusSearch: () => pagesRef.current?.focusSearch(),
      exportCsv: () => pagesRef.current?.exportCsv(),
    }));

    const common = { siteId, range, refreshKey };
    return (
      <main className="page" id="main">
        <KpiRow
          summary={summary.data}
          active={active ?? realtime.data?.active ?? null}
          metric={metric}
          onMetric={setMetric}
          loading={summary.loading}
        />

        <div className="grid grid--main">
          <section className="card chart-card" aria-labelledby="chart-title">
            <header className="card__head">
              <h2 id="chart-title">Traffic</h2>
              <span className="muted small">
                {presetLabel({ preset })} · {formatDateTime(range.from)} –{' '}
                {formatDateTime(range.to)}
                {series.data ? ` · per ${series.data.interval}` : ''}
              </span>
            </header>
            {series.error ? (
              <div className="error">Failed to load: {series.error.message}</div>
            ) : series.data ? (
              <div className={series.fetching ? 'is-refreshing' : undefined}>
                <TimeseriesChart data={series.data} metric={metric} />
              </div>
            ) : (
              <div className="skeleton skeleton--msg" style={{ height: 392 }} role="status">
                {ds.kind === 'demo'
                  ? 'Generating 30 days of synthetic traffic in a Web Worker…'
                  : 'Loading…'}
              </div>
            )}
          </section>
          <RealtimePanel realtime={realtime.data} />
        </div>

        <div className="grid grid--two">
          <BreakdownCard ref={pagesRef} title="Top pages" tabs={PAGE_TABS} {...common} />
          <BreakdownCard title="Top sources" tabs={SOURCE_TABS} {...common} />
        </div>
        <div className="grid grid--two">
          <BreakdownCard title="Locations" tabs={GEO_TABS} {...common} height={280} />
          <BreakdownCard title="Technology" tabs={TECH_TABS} {...common} height={280} />
        </div>
      </main>
    );
  },
);
