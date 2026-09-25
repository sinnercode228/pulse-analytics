import { MINUTE } from './time.js';

/**
 * Sliding-window distinct counter for "visitors online now".
 * O(1) amortised: a Map keeps insertion order, so re-inserting on every hit
 * keeps the oldest visitors at the front where pruning is cheap.
 */
export class ActiveVisitors {
  private lastSeen = new Map<string, number>();

  constructor(readonly windowMs = 5 * MINUTE) {}

  touch(visitorId: string, ts: number): void {
    const prev = this.lastSeen.get(visitorId);
    if (prev !== undefined && prev > ts) return;
    this.lastSeen.delete(visitorId);
    this.lastSeen.set(visitorId, ts);
  }

  count(now: number): number {
    const cutoff = now - this.windowMs;
    for (const [id, ts] of this.lastSeen) {
      if (ts > cutoff) break;
      this.lastSeen.delete(id);
    }
    return this.lastSeen.size;
  }
}
