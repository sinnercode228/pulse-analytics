import type { Site } from '@pulse/core';
import { useDashboard, type View } from '../state/store';
import { useLive } from '../state/live';
import { Icon } from './Icon';
import { RangePicker } from './RangePicker';

interface Props {
  sites: Site[];
  sourceKind: 'api' | 'demo';
}

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: 'analytics', label: 'Analytics', key: 'A' },
  { id: 'uptime', label: 'Uptime', key: 'U' },
];

export function Header({ sites, sourceKind }: Props) {
  const view = useDashboard((s) => s.view);
  const setView = useDashboard((s) => s.setView);
  const siteId = useDashboard((s) => s.siteId);
  const setSite = useDashboard((s) => s.setSite);
  const paused = useDashboard((s) => s.paused);
  const togglePaused = useDashboard((s) => s.togglePaused);
  const setHelpOpen = useDashboard((s) => s.setHelpOpen);
  const active = useLive((s) => s.active);
  const site = sites.find((s) => s.id === siteId);

  return (
    <header className="topbar">
      <div className="topbar__row">
        <a className="brand" href="./" aria-label="Pulse home">
          <span className="brand__mark">
            <Icon name="logo" size={18} />
          </span>
          Pulse
          {sourceKind === 'demo' && (
            <span className="badge" title="Synthetic data generated in a Web Worker">
              demo data
            </span>
          )}
        </a>
        <nav className="views" aria-label="Views">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`view-tab${view === v.id ? ' is-active' : ''}`}
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => setView(v.id)}
              title={`${v.label} (${v.key})`}
            >
              <Icon name={v.id === 'analytics' ? 'activity' : 'shield'} size={15} />
              {v.label}
            </button>
          ))}
        </nav>
        <div className="topbar__spacer" />
        <button
          type="button"
          className="icon-btn"
          onClick={togglePaused}
          aria-pressed={paused}
          aria-label={paused ? 'Resume live updates (L)' : 'Pause live updates (L)'}
          title={paused ? 'Resume live updates (L)' : 'Pause live updates (L)'}
        >
          <Icon name={paused ? 'play' : 'pause'} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setHelpOpen(true)}
          aria-label="Keyboard shortcuts (?)"
          title="Keyboard shortcuts (?)"
        >
          <Icon name="keyboard" />
        </button>
      </div>
      {view === 'analytics' && (
        <div className="topbar__row topbar__row--tools">
          <label className="site-select">
            <Icon name="globe" size={15} />
            <select
              value={siteId ?? ''}
              onChange={(e) => setSite(e.target.value)}
              aria-label="Site (S to cycle)"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {site && <span className="muted small hide-sm">{site.domain}</span>}
          <span
            className={`pill pill--live${paused ? ' is-paused' : ''}`}
            title="Visitors active in the last 5 minutes"
          >
            <span className="live-dot" aria-hidden="true" />
            {paused ? 'paused' : `${active ?? '—'} online`}
          </span>
          <div className="topbar__spacer" />
          <RangePicker />
        </div>
      )}
    </header>
  );
}
