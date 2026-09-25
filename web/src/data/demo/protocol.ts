import type { LiveMessage } from '@pulse/core';
import type { DemoEngine } from './engine';

type EngineMethod =
  'sites' | 'summary' | 'timeseries' | 'breakdown' | 'realtime' | 'monitors' | 'monitor';

export type RpcMethod = EngineMethod;
export type RpcParams<M extends RpcMethod> = Parameters<DemoEngine[M]>;
export type RpcResult<M extends RpcMethod> = ReturnType<DemoEngine[M]>;

export type WorkerRequest =
  | { kind: 'call'; id: number; method: RpcMethod; params: unknown[] }
  | { kind: 'focus'; siteId: string | null };

export type WorkerResponse =
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'error'; id: number; error: string }
  | { kind: 'live'; messages: LiveMessage[] };
