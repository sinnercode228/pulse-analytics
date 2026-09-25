import type { SummaryResponse } from '@pulse/core';
import { delta, formatExact, formatMs, formatNumber, formatPercent } from '../lib/format';
import type { Metric } from '../state/store';
import { Icon } from './Icon';

interface Tile {
  id: string;
  label: string;
  value: string;
  title: string;
  change: number | null;
  /** For load time, lower is better. */
  invert?: boolean;
  metric?: Metric;
}

interface Props {
  summary: SummaryResponse | undefined;
  active: number | null;
  metric: Metric;
  onMetric: (m: Metric) => void;
  loading: boolean;
}

export function KpiRow({ summary, active, metric, onMetric, loading }: Props) {
  const c = summary?.current;
  const p = summary?.previous;
  const tiles: Tile[] = [
    {
      id: 'visitors',
      label: 'Unique visitors',
      value: c ? formatNumber(c.visitors) : '—',
      title: c ? formatExact(c.visitors) : '',
      change: c && p ? delta(c.visitors, p.visitors) : null,
      metric: 'visitors',
    },
    {
      id: 'pageviews',
      label: 'Pageviews',
      value: c ? formatNumber(c.pageviews) : '—',
      title: c ? formatExact(c.pageviews) : '',
      change: c && p ? delta(c.pageviews, p.pageviews) : null,
      metric: 'pageviews',
    },
    {
      id: 'vpv',
      label: 'Views per visit',
      value: c ? c.viewsPerVisitor.toFixed(2) : '—',
      title: '',
      change: c && p ? delta(c.viewsPerVisitor, p.viewsPerVisitor) : null,
    },
    {
      id: 'load',
      label: 'Avg page load',
      value: c ? formatMs(c.avgLoadMs) : '—',
      title: '',
      change: c?.avgLoadMs && p?.avgLoadMs ? delta(c.avgLoadMs, p.avgLoadMs) : null,
      invert: true,
    },
  ];

  return (
    <section className="kpis" aria-label="Key metrics" aria-busy={loading}>
      <div className="kpi kpi--live">
        <span className="kpi__label">
          <span className="live-dot" aria-hidden="true" /> Online now
        </span>
        <span className="kpi__value" aria-live="polite">
          {active ?? '—'}
        </span>
        <span className="kpi__hint">visitors in the last 5 min</span>
      </div>
      {tiles.map((t) => {
        const selectable = t.metric !== undefined;
        const content = (
          <>
            <span className="kpi__label">{t.label}</span>
            <span className={`kpi__value${loading ? ' is-loading' : ''}`} title={t.title}>
              {t.value}
            </span>
            <Change value={t.change} invert={t.invert} />
          </>
        );
        return selectable ? (
          <button
            key={t.id}
            type="button"
            className={`kpi kpi--select${metric === t.metric ? ' is-active' : ''}`}
            aria-pressed={metric === t.metric}
            onClick={() => onMetric(t.metric!)}
          >
            {content}
          </button>
        ) : (
          <div key={t.id} className="kpi">
            {content}
          </div>
        );
      })}
    </section>
  );
}

function Change({ value, invert }: { value: number | null; invert?: boolean | undefined }) {
  if (value === null) return <span className="kpi__hint">no previous data</span>;
  const good = invert ? value < 0 : value > 0;
  const flat = Math.abs(value) < 0.005;
  return (
    <span className={`change ${flat ? 'change--flat' : good ? 'change--up' : 'change--down'}`}>
      {!flat && <Icon name={value > 0 ? 'arrowUp' : 'arrowDown'} size={12} />}
      {formatPercent(Math.abs(value))}
      <span className="kpi__hint"> vs previous</span>
    </span>
  );
}
