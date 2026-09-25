import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useElementWidth } from '../hooks/useElementWidth';

export interface UPlotChartProps {
  /** Builds options for a given width. Changing `optionsKey` recreates the chart. */
  options: (width: number) => uPlot.Options;
  optionsKey: string;
  data: uPlot.AlignedData;
  height: number;
  className?: string;
  ariaLabel: string;
}

/** Thin React wrapper around uPlot: creates once per `optionsKey`, then only `setData` / `setSize`. */
export function UPlotChart({
  options,
  optionsKey,
  data,
  height,
  className,
  ariaLabel,
}: UPlotChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const width = useElementWidth(wrapRef);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || width === 0) return;
    const plot = new uPlot({ ...optionsRef.current(width), width, height }, dataRef.current, el);
    plotRef.current = plot;
    return () => {
      plot.destroy();
      plotRef.current = null;
    };
    // width handled by setSize below; recreate only when the option shape changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, height, width === 0]);

  useEffect(() => {
    if (plotRef.current && width > 0) plotRef.current.setSize({ width, height });
  }, [width, height]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <div
      ref={wrapRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
      style={{ minHeight: height }}
    />
  );
}
