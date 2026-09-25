import { create } from 'zustand';
import type { Range } from '../data/source';
import { PRESETS, presetRange, shiftRange, type PresetId } from '../lib/ranges';

export type View = 'analytics' | 'uptime';
export type Metric = 'visitors' | 'pageviews';

export interface DashboardState {
  view: View;
  siteId: string | null;
  preset: PresetId;
  /** Only meaningful when `preset === 'custom'`. */
  custom: Range | null;
  metric: Metric;
  /** Pauses auto-refresh of live ranges. */
  paused: boolean;
  /** Bumped on every auto-refresh tick; queries use it as a cache key. */
  refreshKey: number;
  helpOpen: boolean;
  rangeOpen: boolean;
  monitorId: string | null;

  setView(view: View): void;
  setSite(siteId: string): void;
  setPreset(preset: Exclude<PresetId, 'custom'>): void;
  setCustom(range: Range): void;
  shift(direction: -1 | 1, now?: number): void;
  setMetric(metric: Metric): void;
  togglePaused(): void;
  refresh(): void;
  setHelpOpen(open: boolean): void;
  setRangeOpen(open: boolean): void;
  openMonitor(id: string | null): void;
}

export const useDashboard = create<DashboardState>()((set, get) => ({
  view: 'analytics',
  siteId: null,
  preset: '24h',
  custom: null,
  metric: 'visitors',
  paused: false,
  refreshKey: 0,
  helpOpen: false,
  rangeOpen: false,
  monitorId: null,

  setView: (view) => set({ view }),
  setSite: (siteId) => set({ siteId }),
  setPreset: (preset) => set({ preset, custom: null }),
  setCustom: (range) => set({ preset: 'custom', custom: range }),
  shift: (direction, now = Date.now()) => {
    const current = selectRange(get(), now);
    set({ preset: 'custom', custom: shiftRange(current, direction, now) });
  },
  setMetric: (metric) => set({ metric }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  refresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setRangeOpen: (rangeOpen) => set({ rangeOpen }),
  openMonitor: (monitorId) => set({ monitorId }),
}));

export function selectRange(s: Pick<DashboardState, 'preset' | 'custom'>, now = Date.now()): Range {
  if (s.preset === 'custom' && s.custom) return s.custom;
  const preset = s.preset === 'custom' ? '24h' : s.preset;
  return presetRange(preset, now);
}

export function presetLabel(s: Pick<DashboardState, 'preset'>): string {
  return PRESETS.find((p) => p.id === s.preset)?.label ?? 'Custom range';
}

/** `#/uptime/<monitor>` ⇄ view state, so views are linkable and survive reloads. */
export function readHash(hash: string): Partial<Pick<DashboardState, 'view' | 'monitorId'>> {
  const [view, monitorId] = hash.replace(/^#\/?/, '').split('/');
  if (view === 'uptime')
    return { view: 'uptime', monitorId: monitorId ? decodeURIComponent(monitorId) : null };
  if (view === 'analytics') return { view: 'analytics', monitorId: null };
  return {};
}

export function writeHash(s: Pick<DashboardState, 'view' | 'monitorId'>): string {
  if (s.view === 'uptime')
    return `#/uptime${s.monitorId ? `/${encodeURIComponent(s.monitorId)}` : ''}`;
  return '#/analytics';
}
