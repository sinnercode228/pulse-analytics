import type { LiveMessage } from '@pulse/core';

type Listener = (message: LiveMessage) => void;

/**
 * In-process pub/sub for the WebSocket live feed. Pageview messages go to the
 * site's subscribers; uptime checks go to everyone.
 */
export class LiveHub {
  private readonly bySite = new Map<string, Set<Listener>>();

  subscribe(siteId: string, listener: Listener): () => void {
    let set = this.bySite.get(siteId);
    if (!set) {
      set = new Set();
      this.bySite.set(siteId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.bySite.delete(siteId);
    };
  }

  get subscriberCount(): number {
    let n = 0;
    for (const set of this.bySite.values()) n += set.size;
    return n;
  }

  publish(message: LiveMessage): void {
    const targets =
      message.type === 'check'
        ? [...this.bySite.values()]
        : [this.bySite.get(message.siteId) ?? new Set()];
    for (const set of targets) {
      for (const listener of set) {
        try {
          listener(message);
        } catch {
          // A broken socket must never break ingestion.
        }
      }
    }
  }
}
