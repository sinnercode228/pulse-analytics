import type { SparkPoint } from '@pulse/core';
import { formatMs, formatTime } from '../lib/format';

interface Props {
  points: readonly SparkPoint[];
  width?: number;
  height?: number;
  degradedAfterMs?: number;
}

/** 24h response-time sparkline (15-min buckets); failed buckets are marked in red. */
export function Sparkline({ points, width = 160, height = 36, degradedAfterMs }: Props) {
  const values = points.map((p) => p.latencyMs).filter((v): v is number => v !== null);
  if (values.length === 0) return <svg width={width} height={height} aria-hidden="true" />;
  const max = Math.max(...values, degradedAfterMs ? degradedAfterMs * 0.6 : 0) * 1.1;
  const step = width / Math.max(1, points.length - 1);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  let d = '';
  let pen = false;
  points.forEach((p, i) => {
    if (p.latencyMs === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${(i * step).toFixed(1)},${y(p.latencyMs).toFixed(1)}`;
    pen = true;
  });
  const last = points.at(-1);
  const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="sparkline"
      role="img"
      aria-label={`Average response time ${formatMs(avg)} over 24 hours`}
    >
      {degradedAfterMs && degradedAfterMs < max && (
        <line
          x1={0}
          x2={width}
          y1={y(degradedAfterMs)}
          y2={y(degradedAfterMs)}
          className="sparkline__threshold"
        />
      )}
      {points.map((p, i) =>
        p.failures > 0 ? (
          <rect
            key={p.t}
            x={i * step - 1.5}
            y={0}
            width={3}
            height={height}
            className="sparkline__fail"
          >
            <title>{`${formatTime(p.t)}: ${p.failures} failed checks`}</title>
          </rect>
        ) : null,
      )}
      <path d={d} className="sparkline__line" />
      {last?.latencyMs != null && (
        <circle
          cx={(points.length - 1) * step}
          cy={y(last.latencyMs)}
          r={2.5}
          className="sparkline__dot"
        />
      )}
    </svg>
  );
}
