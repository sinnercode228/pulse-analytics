import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';

export interface Column<T> {
  id: string;
  header: string;
  /** CSS grid track, e.g. `1fr` or `80px`. */
  width: string;
  align?: 'left' | 'right';
  render: (row: T, index: number) => ReactNode;
  sortable?: boolean;
}

interface Props<T> {
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  height: number;
  rowHeight?: number;
  sort?: { id: string; desc: boolean };
  onSort?: (id: string) => void;
  empty?: ReactNode;
  label: string;
  rowStyle?: (row: T) => React.CSSProperties | undefined;
}

/** Windowed table: only visible rows are in the DOM, so 5 000-row breakdowns scroll smoothly. */
export function VirtualTable<T>({
  rows,
  columns,
  rowKey,
  height,
  rowHeight = 34,
  sort,
  onSort,
  empty,
  label,
  rowStyle,
}: Props<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
    initialRect: { width: 600, height },
  });
  const template = columns.map((c) => c.width).join(' ');

  return (
    <div className="vtable" role="table" aria-label={label} aria-rowcount={rows.length + 1}>
      <div className="vtable__head" role="row" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => {
          const active = sort?.id === c.id;
          return (
            <div
              key={c.id}
              role="columnheader"
              className={`vtable__cell${c.align === 'right' ? ' is-right' : ''}`}
              aria-sort={active ? (sort!.desc ? 'descending' : 'ascending') : undefined}
            >
              {c.sortable && onSort ? (
                <button
                  type="button"
                  className={`sort${active ? ' is-active' : ''}`}
                  onClick={() => onSort(c.id)}
                >
                  {c.header}
                  {active ? (sort!.desc ? ' ↓' : ' ↑') : ''}
                </button>
              ) : (
                c.header
              )}
            </div>
          );
        })}
      </div>
      <div ref={scrollRef} className="vtable__body" style={{ height }} tabIndex={0}>
        {rows.length === 0 ? (
          <div className="vtable__empty">{empty ?? 'No data'}</div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <div
                  key={rowKey(row)}
                  role="row"
                  aria-rowindex={item.index + 2}
                  className="vtable__row"
                  style={{
                    gridTemplateColumns: template,
                    height: rowHeight,
                    transform: `translateY(${item.start}px)`,
                    ...rowStyle?.(row),
                  }}
                >
                  {columns.map((c) => (
                    <div
                      key={c.id}
                      role="cell"
                      className={`vtable__cell${c.align === 'right' ? ' is-right' : ''}`}
                    >
                      {c.render(row, item.index)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
