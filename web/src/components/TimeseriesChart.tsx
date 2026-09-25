import type { TimeseriesResponse } from '@pulse/core';
import { useMemo } from 'react';
import type uPlot from 'uplot';
import { formatBucket, formatMs, formatNumber } from '../lib/format';
import type { Metric } from '../state/store';
import { AXIS_STYLE, gradientFill } from '../lib/chart';
import { UPlotChart } from './UPlotChart';

const COLORS = { visitors: '#7c9cff', pageviews: '#36c2b4', load: '#f5b83d' } as const;

interface Props {
  data: TimeseriesResponse;
  metric: Metric;
  height?: number;
}

/** Visitors / pageviews over time. Series toggles and live values come from uPlot's legend. */
export function TimeseriesChart({ data, metric, height = 360 }: Props) {
  const aligned = useMemo<uPlot.AlignedData>(
    () => [
      data.points.map((p) => p.t / 1000),
      data.points.map((p) => p.visitors),
      data.points.map((p) => p.pageviews),
      data.points.map((p) => p.avgLoadMs),
    ],
    [data],
  );

  const interval = data.interval;
  const options = (width: number): uPlot.Options => ({
    width,
    height,
    cursor: { points: { size: 7 }, drag: { x: false, y: false } },
    legend: { live: true },
    scales: {
      x: { time: true },
      y: { range: (_u, _min, max) => [0, Math.max(4, max * 1.12)] },
      ms: { range: (_u, _min, max) => [0, Math.max(100, max * 1.2)] },
    },
    series: [
      { value: (_u, v) => (v == null ? '—' : formatBucket(v * 1000, interval)) },
      {
        label: 'Visitors',
        stroke: COLORS.visitors,
        width: 2,
        fill: metric === 'visitors' ? gradientFill(COLORS.visitors) : undefined,
        value: (_u, v) => (v == null ? '—' : formatNumber(v)),
        points: { show: false },
      },
      {
        label: 'Pageviews',
        stroke: COLORS.pageviews,
        width: metric === 'pageviews' ? 2 : 1.5,
        dash: metric === 'pageviews' ? undefined : [4, 4],
        fill: metric === 'pageviews' ? gradientFill(COLORS.pageviews) : undefined,
        value: (_u, v) => (v == null ? '—' : formatNumber(v)),
        points: { show: false },
      },
      {
        label: 'Avg load',
        stroke: COLORS.load,
        width: 1,
        scale: 'ms',
        show: false,
        value: (_u, v) => formatMs(v),
        spanGaps: true,
        points: { show: false },
      },
    ],
    axes: [
      { ...AXIS_STYLE, space: 60 },
      { ...AXIS_STYLE, size: 48, values: (_u, vals) => vals.map((v) => formatNumber(v)) },
      { ...AXIS_STYLE, scale: 'ms', side: 1, show: false },
    ],
  });

  return (
    <UPlotChart
      className="chart"
      options={options}
      optionsKey={`${interval}:${metric}:${height}`}
      data={aligned}
      height={height}
      ariaLabel={`Visitors and pageviews per ${interval}`}
    />
  );
}
