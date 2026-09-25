import type { Granularity, LiveMessage } from '@pulse/core';
import type { BreakdownParams, DataSource, Range } from '../source';
import type { RpcMethod, RpcParams, RpcResult, WorkerRequest, WorkerResponse } from './protocol';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

/** Talks to the demo engine in a Web Worker, so backfill and queries never block the UI thread. */
export class DemoDataSource implements DataSource {
  readonly kind = 'demo' as const;
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<(m: LiveMessage) => void>>();
  private nextId = 1;

  constructor(worker?: Worker) {
    this.worker = worker ?? new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.kind === 'live') {
      for (const m of msg.messages) {
        const targets =
          m.type === 'check' ? [...this.listeners.values()] : [this.listeners.get(m.siteId)];
        for (const set of targets) set?.forEach((fn) => fn(m));
      }
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.kind === 'result') p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  }

  private call<M extends RpcMethod>(method: M, ...params: RpcParams<M>): Promise<RpcResult<M>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ kind: 'call', id, method, params } satisfies WorkerRequest);
    });
  }

  sites() {
    return this.call('sites');
  }
  summary(siteId: string, range: Range) {
    return this.call('summary', siteId, range);
  }
  timeseries(siteId: string, range: Range, interval?: Granularity) {
    return this.call('timeseries', siteId, range, interval);
  }
  breakdown(siteId: string, range: Range, params: BreakdownParams) {
    return this.call('breakdown', siteId, range, params);
  }
  realtime(siteId: string) {
    return this.call('realtime', siteId);
  }
  monitors() {
    return this.call('monitors');
  }
  monitor(id: string) {
    return this.call('monitor', id);
  }

  subscribe(siteId: string, listener: (m: LiveMessage) => void): () => void {
    let set = this.listeners.get(siteId);
    if (!set) {
      set = new Set();
      this.listeners.set(siteId, set);
    }
    set.add(listener);
    this.worker.postMessage({ kind: 'focus', siteId } satisfies WorkerRequest);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(siteId);
    };
  }
}
