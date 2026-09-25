import type { CheckResult, LiveEvent, LiveMessage } from '@pulse/core';
import { create } from 'zustand';

const MAX_EVENTS = 40;

interface LiveState {
  siteId: string | null;
  active: number | null;
  events: LiveEvent[];
  lastCheck: CheckResult | null;
  checksSeen: number;
  reset(siteId: string | null): void;
  seed(siteId: string, active: number, events: LiveEvent[]): void;
  apply(message: LiveMessage): void;
}

/** Fed by the data source's live stream (WebSocket or worker). */
export const useLive = create<LiveState>()((set, get) => ({
  siteId: null,
  active: null,
  events: [],
  lastCheck: null,
  checksSeen: 0,
  reset: (siteId) => set({ siteId, active: null, events: [] }),
  seed: (siteId, active, events) => {
    if (get().siteId !== siteId) return;
    const known = new Set(get().events.map((e) => e.id));
    const merged = [...get().events, ...events.filter((e) => !known.has(e.id))]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MAX_EVENTS);
    set({ active, events: merged });
  },
  apply: (m) => {
    const s = get();
    switch (m.type) {
      case 'check':
        set({ lastCheck: m.check, checksSeen: s.checksSeen + 1 });
        return;
      case 'hello':
      case 'active':
        if (m.siteId === s.siteId) set({ active: m.active });
        return;
      case 'pageview':
        if (m.siteId !== s.siteId) return;
        set({ active: m.active, events: [m.event, ...s.events].slice(0, MAX_EVENTS) });
    }
  },
}));
