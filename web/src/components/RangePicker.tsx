import { useEffect, useRef, useState } from 'react';
import { formatDateTime } from '../lib/format';
import { MAX_HISTORY_MS, PRESETS, fromLocalInput, toLocalInput } from '../lib/ranges';
import { selectRange, useDashboard } from '../state/store';
import { Icon } from './Icon';

/** Preset segmented control + custom from/to popover + ←/→ window shifting. */
export function RangePicker() {
  const preset = useDashboard((s) => s.preset);
  const custom = useDashboard((s) => s.custom);
  const setPreset = useDashboard((s) => s.setPreset);
  const setCustom = useDashboard((s) => s.setCustom);
  const shift = useDashboard((s) => s.shift);
  const open = useDashboard((s) => s.rangeOpen);
  const setOpen = useDashboard((s) => s.setRangeOpen);
  const range = selectRange({ preset, custom });
  const [from, setFrom] = useState(toLocalInput(range.from));
  const [to, setTo] = useState(toLocalInput(range.to));
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const r = selectRange(useDashboard.getState());
    setFrom(toLocalInput(r.from));
    setTo(toLocalInput(r.to));
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  const now = Date.now();
  const f = fromLocalInput(from);
  const t = Math.min(fromLocalInput(to), now);
  const invalid = !Number.isFinite(f) || !Number.isFinite(t) || f >= t;

  return (
    <div className="range" ref={popRef}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => shift(-1)}
        aria-label="Previous period (←)"
        title="Previous period (←)"
      >
        <Icon name="left" />
      </button>
      <div className="segmented" role="radiogroup" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            className={preset === p.id ? 'is-active' : undefined}
            onClick={() => setPreset(p.id)}
            title={`${p.label} (${p.key})`}
          >
            {p.short}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={preset === 'custom'}
          aria-expanded={open}
          className={preset === 'custom' ? 'is-active' : undefined}
          onClick={() => setOpen(!open)}
          title="Custom range (C)"
        >
          <Icon name="calendar" size={14} />
          <span className="hide-sm">
            {preset === 'custom' && custom
              ? `${formatDateTime(custom.from)} – ${formatDateTime(custom.to)}`
              : 'Custom'}
          </span>
        </button>
      </div>
      <button
        type="button"
        className="icon-btn"
        onClick={() => shift(1)}
        aria-label="Next period (→)"
        title="Next period (→)"
      >
        <Icon name="right" />
      </button>
      {open && (
        <form
          className="popover"
          aria-label="Custom date range"
          onSubmit={(e) => {
            e.preventDefault();
            if (invalid) return;
            setCustom({ from: Math.max(f, now - MAX_HISTORY_MS), to: t });
            setOpen(false);
          }}
        >
          <label>
            From
            <input
              type="datetime-local"
              value={from}
              min={toLocalInput(now - MAX_HISTORY_MS)}
              max={toLocalInput(now)}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="datetime-local"
              value={to}
              min={toLocalInput(now - MAX_HISTORY_MS)}
              max={toLocalInput(now)}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <p className="muted small">
            Up to 30 days of history. Charts pick minute, hour or day buckets automatically.
          </p>
          <div className="popover__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--sm" disabled={invalid}>
              Apply
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
