import type { MonitorOverview } from '@pulse/core';
import { MonitorDetailPanel } from '../components/MonitorDetailPanel';
import { Sparkline } from '../components/Sparkline';
import { StatusBadge } from '../components/StatusBadge';
import { UptimeHeatmap } from '../components/UptimeHeatmap';
import { useDataSource } from '../hooks/useDataSource';
import { useNow } from '../hooks/useNow';
import { useQuery } from '../hooks/useQuery';
import { formatMs, formatUptime, timeAgo } from '../lib/format';
import { useLive } from '../state/live';
import { useDashboard } from '../state/store';

function Banner({ monitors }: { monitors: MonitorOverview[] }) {
  const down = monitors.filter((m) => m.status === 'down');
  const degraded = monitors.filter((m) => m.status === 'degraded');
  const tone = down.length ? 'down' : degraded.length ? 'degraded' : 'up';
  const text = down.length
    ? `${down.map((m) => m.monitor.name).join(', ')} ${down.length === 1 ? 'is' : 'are'} down`
    : degraded.length
      ? `${degraded.map((m) => m.monitor.name).join(', ')} responding slowly`
      : 'All systems operational';
  const open = monitors.flatMap((m) => m.incidents.filter((i) => !i.resolvedAt)).length;
  return (
    <div className={`banner banner--${tone}`} role="status">
      <span className="status__dot" aria-hidden="true" />
      <strong>{text}</strong>
      <span className="muted small">
        {monitors.length} monitors · {open} open incident{open === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export function UptimePage() {
  const ds = useDataSource();
  const refreshKey = useDashboard((s) => s.refreshKey);
  const monitorId = useDashboard((s) => s.monitorId);
  const openMonitor = useDashboard((s) => s.openMonitor);
  const checksSeen = useLive((s) => s.checksSeen);
  const now = useNow(5000);
  // Re-query on refresh ticks and whenever a batch of live checks has arrived.
  const bucket = Math.floor(checksSeen / 6);
  const { data, error, loading } = useQuery(`monitors|${refreshKey}|${bucket}`, () =>
    ds.monitors(),
  );

  return (
    <main className="page" id="main">
      {error && <div className="error">Failed to load monitors: {error.message}</div>}
      {loading && (
        <div className="skeleton" style={{ height: 420 }} aria-label="Loading monitors" />
      )}
      {data && (
        <>
          <Banner monitors={data} />
          <section className="card" aria-labelledby="monitors-title">
            <header className="card__head">
              <h2 id="monitors-title">Monitors</h2>
              <span className="muted small">24h response time · 90-day uptime</span>
            </header>
            <ul className="monitors">
              {data.map((m) => (
                <li key={m.monitor.id}>
                  <button
                    type="button"
                    className={`monitor${monitorId === m.monitor.id ? ' is-active' : ''}`}
                    onClick={() => openMonitor(m.monitor.id)}
                    aria-label={`${m.monitor.name}: ${m.status}, ${formatUptime(m.uptime90d)} uptime over 90 days`}
                  >
                    <div className="monitor__name">
                      <StatusBadge status={m.status} />
                      <strong>{m.monitor.name}</strong>
                      <span className="muted small mono monitor__url">
                        {m.monitor.url.replace(/^https?:\/\//, '')}
                      </span>
                    </div>
                    <div className="monitor__latency">
                      <Sparkline points={m.sparkline} degradedAfterMs={m.monitor.degradedAfterMs} />
                      <span className="small">
                        {formatMs(m.lastCheck?.latencyMs)}
                        <span className="muted"> · p95 {formatMs(m.latency24h?.p95)}</span>
                      </span>
                    </div>
                    <div className="monitor__history">
                      <UptimeHeatmap days={m.daily} />
                      <span className="small monitor__uptime">
                        <strong>{formatUptime(m.uptime90d)}</strong>
                        <span className="muted">
                          {' '}
                          90d · checked {m.lastCheck ? timeAgo(m.lastCheck.ts, now) : 'never'}
                        </span>
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {monitorId && (
        <MonitorDetailPanel
          id={monitorId}
          refreshKey={refreshKey}
          onClose={() => openMonitor(null)}
        />
      )}
    </main>
  );
}
