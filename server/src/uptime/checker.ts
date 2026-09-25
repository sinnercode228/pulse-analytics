import { isSuccessStatus, type CheckResult, type Monitor } from '@pulse/core';

export type FetchLike = (
  input: string,
  init: RequestInit,
) => Promise<{ status: number; body?: unknown }>;

/** One HTTP probe. Never throws: network errors and timeouts become failed checks. */
export async function performCheck(
  monitor: Monitor,
  fetchImpl: FetchLike = fetch,
  clock: () => number = Date.now,
): Promise<CheckResult> {
  const ts = clock();
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeoutMs);
  try {
    const res = await fetchImpl(monitor.url, {
      method: monitor.method,
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'PulseUptime/0.1 (+demo project)' },
    });
    const latencyMs = Math.round(performance.now() - started);
    const ok = isSuccessStatus(res.status);
    // Drain the body so the connection can be reused.
    const body = res.body as { cancel?: () => Promise<void> } | undefined;
    await body?.cancel?.().catch(() => undefined);
    return {
      monitorId: monitor.id,
      ts,
      ok,
      status: res.status,
      latencyMs,
      error: ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const aborted = controller.signal.aborted;
    return {
      monitorId: monitor.id,
      ts,
      ok: false,
      status: null,
      latencyMs: aborted ? monitor.timeoutMs : Math.round(performance.now() - started),
      error: aborted ? `Timeout after ${monitor.timeoutMs / 1000}s` : errorMessage(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  if (cause?.code) return cause.code;
  return err instanceof Error ? err.message.slice(0, 200) : 'Unknown error';
}
