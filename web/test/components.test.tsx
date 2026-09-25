import type { BreakdownResponse, SummaryResponse } from '@pulse/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BreakdownCard } from '../src/components/BreakdownCard';
import { KpiRow } from '../src/components/KpiRow';
import { UptimeHeatmap } from '../src/components/UptimeHeatmap';
import type { DataSource } from '../src/data/source';
import { DataSourceContext } from '../src/hooks/useDataSource';
import { useHotkeys } from '../src/hooks/useHotkeys';

const breakdown: BreakdownResponse = {
  dimension: 'page',
  total: 3,
  rows: [
    { value: '/', visitors: 50, pageviews: 80, avgLoadMs: 900 },
    { value: '/pricing', visitors: 30, pageviews: 31, avgLoadMs: 1200 },
    { value: '/docs', visitors: 20, pageviews: 60, avgLoadMs: null },
  ],
};

function fakeSource(): DataSource {
  return {
    kind: 'demo',
    sites: vi.fn(),
    summary: vi.fn(),
    timeseries: vi.fn(),
    breakdown: vi.fn(async (_s, _r, p) => ({
      ...breakdown,
      rows: breakdown.rows.filter((r) => !p.search || r.value.includes(p.search)),
    })),
    realtime: vi.fn(),
    monitors: vi.fn(),
    monitor: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  } as unknown as DataSource;
}

describe('BreakdownCard', () => {
  it('renders rows with shares, sorts by column and filters via the data source', async () => {
    const ds = fakeSource();
    render(
      <DataSourceContext.Provider value={ds}>
        <BreakdownCard
          title="Top pages"
          tabs={[{ dimension: 'page', label: 'Pages' }]}
          siteId="s"
          range={{ from: 0, to: 1 }}
          refreshKey={0}
        />
      </DataSourceContext.Provider>,
    );
    await screen.findByText('/pricing');
    expect(screen.getByText('50%')).toBeTruthy();
    const firstLabel = () => screen.getAllByRole('row').slice(1)[0]!.textContent;
    expect(firstLabel()).toContain('/');
    fireEvent.click(screen.getByRole('button', { name: 'Views' }));
    expect(firstLabel()).toContain('/');
    fireEvent.click(screen.getByRole('button', { name: /Views/ }));
    expect(firstLabel()).toContain('/pricing');

    fireEvent.change(screen.getByLabelText('Filter Pages'), { target: { value: 'doc' } });
    await waitFor(() => expect(screen.queryByText('/pricing')).toBeNull());
    expect(ds.breakdown).toHaveBeenLastCalledWith(
      's',
      { from: 0, to: 1 },
      { dimension: 'page', limit: 1000, search: 'doc' },
    );
  });
});

describe('KpiRow', () => {
  it('shows values, deltas and lets you pick the chart metric', () => {
    const summary: SummaryResponse = {
      interval: 'hour',
      current: { visitors: 1200, pageviews: 3000, viewsPerVisitor: 2.5, avgLoadMs: 800 },
      previous: { visitors: 1000, pageviews: 3000, viewsPerVisitor: 3, avgLoadMs: 1000 },
    };
    const onMetric = vi.fn();
    render(
      <KpiRow
        summary={summary}
        active={12}
        metric="visitors"
        onMetric={onMetric}
        loading={false}
      />,
    );
    expect(screen.getByText('1,200')).toBeTruthy();
    const [visitors, load] = screen.getAllByText('20.0%');
    expect(visitors!.closest('.change')!.className).toContain('change--up');
    // a 20% faster page load is an improvement too
    expect(screen.getByText('800 ms')).toBeTruthy();
    expect(load!.closest('.change')!.className).toContain('change--up');
    expect(screen.getByText('16.7%').closest('.change')!.className).toContain('change--down');
    fireEvent.click(screen.getByRole('button', { name: /Pageviews/ }));
    expect(onMetric).toHaveBeenCalledWith('pageviews');
  });
});

describe('UptimeHeatmap', () => {
  it('colours each day by its uptime level', () => {
    render(
      <UptimeHeatmap
        days={[
          { day: 0, checks: 0, failures: 0, latencySum: 0, latencyMax: 0 },
          { day: 86_400_000, checks: 1440, failures: 0, latencySum: 1, latencyMax: 1 },
          { day: 2 * 86_400_000, checks: 1440, failures: 200, latencySum: 1, latencyMax: 1 },
        ]}
      />,
    );
    const cells = screen.getAllByRole('listitem');
    expect(cells.map((c) => c.className.split(' ')[1])).toEqual([
      'lvl-none',
      'lvl-operational',
      'lvl-major',
    ]);
  });
});

describe('useHotkeys', () => {
  function Harness({ onKey }: { onKey: () => void }) {
    useHotkeys({ e: onKey });
    return <input aria-label="field" />;
  }

  it('fires outside inputs and stays quiet while typing', () => {
    const onKey = vi.fn();
    render(<Harness onKey={onKey} />);
    act(() => void fireEvent.keyDown(window, { key: 'e' }));
    expect(onKey).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'e' });
    act(() => void fireEvent.keyDown(window, { key: 'e', metaKey: true }));
    expect(onKey).toHaveBeenCalledTimes(1);
  });
});
