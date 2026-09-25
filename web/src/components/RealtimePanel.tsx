import type { RealtimeResponse } from '@pulse/core';
import { useNow } from '../hooks/useNow';
import { countryFlag, countryName } from '../lib/countries';
import { formatTime, timeAgo } from '../lib/format';
import { useLive } from '../state/live';

interface Props {
  realtime: RealtimeResponse | undefined;
}

/** Per-minute pageview bars for the last 30 minutes + a streaming feed of pageviews. */
export function RealtimePanel({ realtime }: Props) {
  const events = useLive((s) => s.events);
  const active = useLive((s) => s.active);
  const now = useNow(1000);
  const bars = realtime?.perMinute ?? [];
  const max = Math.max(1, ...bars.map((b) => b.pageviews));
  const total = bars.reduce((s, b) => s + b.pageviews, 0);

  return (
    <section className="card realtime" aria-labelledby="rt-title">
      <header className="card__head">
        <h2 id="rt-title">Realtime</h2>
        <span className="pill pill--live">
          <span className="live-dot" aria-hidden="true" /> {active ?? realtime?.active ?? '—'}{' '}
          online
        </span>
      </header>
      <div
        className="realtime__bars"
        role="img"
        aria-label={`${total} pageviews in the last 30 minutes`}
      >
        {bars.map((b) => (
          <div key={b.t} className="bar" title={`${formatTime(b.t)} — ${b.pageviews} pageviews`}>
            <span style={{ height: `${(b.pageviews / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="realtime__axis muted small">
        <span>−30 min</span>
        <span>{total} pageviews</span>
        <span>now</span>
      </div>
      <h3 className="subhead">Live feed</h3>
      <ol className="feed" aria-live="off">
        {events.length === 0 && <li className="muted small">Waiting for pageviews…</li>}
        {events.slice(0, 14).map((e) => (
          <li key={e.id} className="feed__item">
            <span
              className="flag"
              title={countryName(e.country)}
              aria-label={countryName(e.country)}
            >
              {countryFlag(e.country)}
            </span>
            <span className="feed__path" title={e.path}>
              {e.path}
            </span>
            <span className="feed__meta muted">
              {e.referrer !== '(direct)' ? `${e.referrer} · ` : ''}
              {e.device}
            </span>
            <time className="feed__time muted" dateTime={new Date(e.ts).toISOString()}>
              {timeAgo(e.ts, now)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}
