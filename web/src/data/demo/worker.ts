/// <reference lib="webworker" />
import { DemoEngine } from './engine';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const engine = new DemoEngine({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
let focused: string | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === 'focus') {
    focused = req.siteId;
    return;
  }
  try {
    const fn = engine[req.method] as (...args: unknown[]) => unknown;
    post({ kind: 'result', id: req.id, result: fn.apply(engine, req.params) });
  } catch (err) {
    post({ kind: 'error', id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};

// Live simulation clock: synthetic visitors arrive in real time.
setInterval(() => {
  const messages = engine.tick(focused);
  if (messages.length > 0) post({ kind: 'live', messages });
}, 1000);
