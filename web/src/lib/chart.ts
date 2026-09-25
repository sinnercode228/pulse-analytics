import type uPlot from 'uplot';

export const AXIS_STYLE = {
  stroke: '#8b93a7',
  grid: { stroke: 'rgba(139,147,167,0.12)', width: 1 },
  ticks: { stroke: 'rgba(139,147,167,0.2)', width: 1, size: 4 },
  font: '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif',
} satisfies Partial<uPlot.Axis>;

export function gradientFill(color: string, alpha = 0.28): uPlot.Series.Fill {
  return (u) => {
    const { top, height } = u.bbox ?? {};
    // uPlot may ask for the fill before layout is computed.
    if (!Number.isFinite(top) || !Number.isFinite(height)) return hexAlpha(color, alpha / 2);
    const g = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
    g.addColorStop(0, hexAlpha(color, alpha));
    g.addColorStop(1, hexAlpha(color, 0));
    return g;
  };
}

export function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
