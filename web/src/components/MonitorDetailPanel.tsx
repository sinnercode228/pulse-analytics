import type { HourlyUptime } from '@pulse/core';
import { useEffect, useMemo, useRef } from 'react';
import type uPlot from 'uplot';
import { useDataSource } from '../hooks/useDataSource';
import { useQuery } from '../hooks/useQuery';
import { formatDateTime, formatDuration, formatMs, formatUptime } from '../lib/format';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';
import { AXIS_STYLE, gradientFill } from '../lib/chart';
import { UPlotChart } from './UPlotChart';
import { UptimeHeatmap } from './UptimeHeatmap';

interface Props {
  id: string;
  refreshKey: number;
  onClose: () => void;
}

function LatencyChart({ hourly }: { hourly: HourlyUptime[] }) {
  const data = useMemo<uPlot.AlignedData>(
    () => [
      hourly.map((h) => h.t / 1000),
      hourly.map((h) => h.avgLatencyMs),
      hourly.map((h) => (h.failures > 0 ? h.failures : null)),
    ],
    [hourly],
  );
  return (
    <UPlotChart
      className="chart"
      optionsKey="latency"
      height={200}
      data={data}
      ariaLabel="Hourly average response time, last 7 days"
      options={(width) => ({
        width,
        height: 200,
        legend: { live: true },
        cursor: { drag: { x: false, y: false } },
        scales: { x: { time: true }, f: { range: [0, 60] } },
        series: [
          {},
          {
            label: 'Avg response',
            stroke: '#7c9cff',
            width: 1.5,
            fill: gradientFill('#7c9cff', 0.2),
            value: (_u, v) => formatMs(v),
            points: { show: false },
          },
          {
            label: 'Failed checks',
            stroke: '#f06464',
            scale: 'f',
            width: 0,
            paths: () => null,
            points: { show: true, size: 6, fill: '#f06464', stroke: '#f06464' },
            value: (_u, v) => (v == null ? '0' : String(v)),
          },
        ],
        axes: [
          { ...AXIS_STYLE },
          { ...AXIS_STYLE, size: 56, values: (_u, vals) => vals.map((v) => formatMs(v)) },
        ],
      })}
    />
  );
}

/** Slide-over with 7-day latency, uptime windows, incidents and the raw check log. */
export function MonitorDetailPanel({ id, refreshKey, onClose }: Props) {
  const ds = useDataSource();
  const { data, error } = useQuery(`${id}|${refreshKey}`, () => ds.monitor(id));
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), [id]);

  return (
    <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby="monitor-title">
      <header className="drawer__head">
        <div>
          <h2 id="monitor-title">{data?.monitor.name ?? 'Monitor'}</h2>
          {data && (
            <p className="muted small mono">
              {data.monitor.method} {data.monitor.url} · every {data.monitor.intervalSec}s
            </p>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label="Close (Esc)"
        >
          <Icon name="close" />
        </button>
      </header>
      {error && <div className="error">{error.message}</div>}
      {data && (
        <div className="drawer__body">
          <div className="stats-grid">
            <div>
              <span className="muted small">Status</span>
              <StatusBadge status={data.status} />
            </div>
            <div>
              <span className="muted small">Uptime 24h</span>
              <strong>{formatUptime(data.uptime24h)}</strong>
            </div>
            <div>
              <span className="muted small">Uptime 30d</span>
              <strong>{formatUptime(data.uptime30d)}</strong>
            </div>
            <div>
              <span className="muted small">Uptime 90d</span>
              <strong>{formatUptime(data.uptime90d)}</strong>
            </div>
            <div>
              <span className="muted small">p50 / p95 (24h)</span>
              <strong>
                {formatMs(data.latency24h?.p50)} / {formatMs(data.latency24h?.p95)}
              </strong>
            </div>
            <div>
              <span className="muted small">Max (24h)</span>
              <strong>{formatMs(data.latency24h?.max)}</strong>
            </div>
          </div>

          <h3 className="subhead">Response time · 7 days</h3>
          <LatencyChart hourly={data.hourly} />

          <h3 className="subhead">90-day history</h3>
          <UptimeHeatmap days={data.daily} size="lg" />

          <h3 className="subhead">Incidents</h3>
          {data.incidents.length === 0 ? (
            <p className="muted small">No incidents recorded.</p>
          ) : (
            <ul className="incidents">
              {data.incidents.map((i) => (
                <li key={i.id} className={i.resolvedAt ? '' : 'is-open'}>
                  <span className={`status status--${i.resolvedAt ? 'up' : 'down'}`}>
                    <span className="status__dot" aria-hidden="true" />
                    {i.resolvedAt ? 'Resolved' : 'Ongoing'}
                  </span>
                  <span className="incidents__cause">{i.cause}</span>
                  <span className="muted small">
                    {formatDateTime(i.startedAt)} ·{' '}
                    {i.resolvedAt ? formatDuration(i.resolvedAt - i.startedAt) : 'ongoing'} ·{' '}
                    {i.failures} failed check{i.failures === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h3 className="subhead">Recent checks</h3>
          <table className="checks">
            <thead>
              <tr>
                <th>Time</th>
                <th>Result</th>
                <th className="is-right">Latency</th>
              </tr>
            </thead>
            <tbody>
              {data.recentChecks.slice(0, 15).map((c) => (
                <tr key={c.ts}>
                  <td className="mono">{formatDateTime(c.ts)}</td>
                  <td className={c.ok ? '' : 'text-down'}>
                    {c.ok ? `HTTP ${c.status}` : (c.error ?? 'Failed')}
                  </td>
                  <td className="is-right mono">{formatMs(c.latencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </aside>
  );
}
