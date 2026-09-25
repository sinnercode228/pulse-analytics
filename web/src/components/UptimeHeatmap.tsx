import { dayLevel, uptimeRatio, type DailyUptime } from '@pulse/core';
import { formatDate, formatMs, formatUptime } from '../lib/format';

interface Props {
  days: readonly DailyUptime[];
  /** Render compact bars (list rows) or the tall detail version. */
  size?: 'sm' | 'lg';
}

const LEVEL_TEXT = {
  none: 'No data',
  operational: 'Operational',
  minor: 'Minor outage',
  partial: 'Partial outage',
  major: 'Major outage',
} as const;

/** Status-page style 90-day heatmap: one bar per day, coloured by uptime. */
export function UptimeHeatmap({ days, size = 'sm' }: Props) {
  return (
    <div
      className={`heatmap heatmap--${size}`}
      role="list"
      aria-label={`Daily uptime, last ${days.length} days`}
    >
      {days.map((d) => {
        const level = dayLevel(d);
        const ratio = uptimeRatio([d]);
        const avg = d.checks - d.failures > 0 ? d.latencySum / (d.checks - d.failures) : null;
        const label = `${formatDate(d.day)}: ${LEVEL_TEXT[level]}${ratio !== null ? ` · ${formatUptime(ratio)} · ${d.failures} failed of ${d.checks} · avg ${formatMs(avg)}` : ''}`;
        return (
          <span
            key={d.day}
            role="listitem"
            className={`heatmap__day lvl-${level}`}
            title={label}
            aria-label={label}
          />
        );
      })}
    </div>
  );
}
