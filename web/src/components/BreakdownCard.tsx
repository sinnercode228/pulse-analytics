import type { BreakdownRow, Dimension } from '@pulse/core';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Range } from '../data/source';
import { useDataSource } from '../hooks/useDataSource';
import { useQuery } from '../hooks/useQuery';
import { countryFlag, countryName } from '../lib/countries';
import { downloadText, toCsv } from '../lib/csv';
import { formatExact, formatMs, formatNumber, formatPercent } from '../lib/format';
import { Icon } from './Icon';
import { VirtualTable, type Column } from './VirtualTable';

export interface Tab {
  dimension: Dimension;
  label: string;
}

interface Props {
  title: string;
  tabs: readonly Tab[];
  siteId: string;
  range: Range;
  refreshKey: number;
  height?: number;
  limit?: number;
}

export interface BreakdownCardHandle {
  focusSearch(): void;
  exportCsv(): void;
}

type SortId = 'visitors' | 'pageviews' | 'load' | 'value';

function label(dimension: Dimension, value: string) {
  if (dimension === 'country') {
    return (
      <>
        <span className="flag" aria-hidden="true">
          {countryFlag(value)}
        </span>
        {countryName(value)}
      </>
    );
  }
  if (dimension === 'referrer' && value !== '(direct)' && value.includes('.')) {
    return (
      <>
        <span className="favicon" aria-hidden="true">
          {value[0]!.toUpperCase()}
        </span>
        {value}
      </>
    );
  }
  if (dimension === 'referrer')
    return <span className="muted">{value === '(direct)' ? 'Direct / none' : value}</span>;
  return value;
}

/** Top-N breakdown with tabs, search, sortable columns, virtual scrolling and CSV export. */
export const BreakdownCard = forwardRef<BreakdownCardHandle, Props>(function BreakdownCard(
  { title, tabs, siteId, range, refreshKey, height = 320, limit = 1000 },
  ref,
) {
  const ds = useDataSource();
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ id: SortId; desc: boolean }>({ id: 'visitors', desc: true });
  const searchRef = useRef<HTMLInputElement>(null);
  const dimension = tabs[tab]!.dimension;
  const query = search.trim();

  const { data, loading, fetching, error } = useQuery(
    `${siteId}|${dimension}|${range.from}|${range.to}|${query}|${refreshKey}`,
    () => ds.breakdown(siteId, range, { dimension, limit, ...(query ? { search: query } : {}) }),
  );

  const totalVisitors = useMemo(() => data?.rows.reduce((s, r) => s + r.visitors, 0) ?? 0, [data]);
  const maxVisitors = data?.rows[0]?.visitors ?? 1;

  const rows = useMemo(() => {
    const list = [...(data?.rows ?? [])];
    const dir = sort.desc ? -1 : 1;
    const key = (r: BreakdownRow): number | string =>
      sort.id === 'value' ? r.value : sort.id === 'load' ? (r.avgLoadMs ?? -1) : r[sort.id];
    list.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return (typeof ka === 'string' ? ka.localeCompare(kb as string) : ka - (kb as number)) * dir;
    });
    return list;
  }, [data, sort]);

  const exportCsv = () => {
    if (!data) return;
    const header = [dimension, 'visitors', 'pageviews', 'avg_load_ms'];
    const csv = toCsv(
      header,
      rows.map((r) => [r.value, r.visitors, r.pageviews, r.avgLoadMs]),
    );
    downloadText(
      `pulse-${siteId}-${dimension}-${new Date(range.from).toISOString().slice(0, 10)}.csv`,
      csv,
    );
  };

  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus(), exportCsv }));

  const columns: Column<BreakdownRow>[] = [
    {
      id: 'value',
      header: tabs[tab]!.label,
      width: 'minmax(0, 1fr)',
      sortable: true,
      render: (r) => (
        <span className="cell-label" title={r.value}>
          {label(dimension, r.value)}
        </span>
      ),
    },
    {
      id: 'visitors',
      header: 'Visitors',
      width: '84px',
      align: 'right',
      sortable: true,
      render: (r) => <span title={formatExact(r.visitors)}>{formatNumber(r.visitors)}</span>,
    },
    {
      id: 'pageviews',
      header: 'Views',
      width: '72px',
      align: 'right',
      sortable: true,
      render: (r) => formatNumber(r.pageviews),
    },
    {
      id: 'share',
      header: 'Share',
      width: '60px',
      align: 'right',
      render: (r) => (
        <span className="muted">
          {totalVisitors ? formatPercent(r.visitors / totalVisitors, 0) : '—'}
        </span>
      ),
    },
    {
      id: 'load',
      header: 'Load',
      width: '68px',
      align: 'right',
      sortable: true,
      render: (r) => <span className="muted">{formatMs(r.avgLoadMs)}</span>,
    },
  ];

  return (
    <section className="card breakdown" aria-labelledby={`bd-${title}`}>
      <header className="card__head">
        <h2 id={`bd-${title}`}>{title}</h2>
        <div className="tabs" role="tablist">
          {tabs.map((t, i) => (
            <button
              key={t.dimension}
              type="button"
              role="tab"
              aria-selected={i === tab}
              className={`tab${i === tab ? ' is-active' : ''}`}
              onClick={() => setTab(i)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="breakdown__tools">
        <label className="search">
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            type="search"
            placeholder={`Filter ${tabs[tab]!.label.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.currentTarget.blur(), setSearch(''))}
            aria-label={`Filter ${tabs[tab]!.label}`}
          />
        </label>
        <span className="muted small">{data ? `${formatExact(data.total)} rows` : ''}</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={exportCsv}
          disabled={!data}
          title="Export CSV (E)"
        >
          <Icon name="download" size={14} /> CSV
        </button>
      </div>
      {error ? (
        <div className="error">Failed to load: {error.message}</div>
      ) : (
        <div className={fetching && !loading ? 'is-refreshing' : undefined}>
          <VirtualTable
            label={`${title}: ${tabs[tab]!.label}`}
            rows={loading ? [] : rows}
            columns={columns}
            rowKey={(r) => r.value}
            height={height}
            sort={sort}
            onSort={(id) =>
              setSort((s) => ({ id: id as SortId, desc: s.id === id ? !s.desc : id !== 'value' }))
            }
            empty={
              loading ? (
                <span className="skeleton-text">Loading…</span>
              ) : query ? (
                'No matches'
              ) : (
                'No data for this range'
              )
            }
            rowStyle={(r) =>
              ({
                '--bar': `${Math.max(1.5, (r.visitors / maxVisitors) * 100)}%`,
              }) as React.CSSProperties
            }
          />
        </div>
      )}
    </section>
  );
});
