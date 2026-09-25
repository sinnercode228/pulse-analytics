import { useEffect, useRef, useState } from 'react';

export interface QueryState<T> {
  data: T | undefined;
  error: Error | undefined;
  /** True until the first result arrives. */
  loading: boolean;
  /** True while a request is in flight (previous data stays visible, dimmed). */
  fetching: boolean;
}

/**
 * Minimal async data hook: keyed, race-safe (stale responses are dropped) and
 * keeps the previous result while refetching, so live refreshes never flicker.
 * Pass `null` as key to skip.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({
    data: undefined,
    error: undefined,
    loading: key !== null,
    fetching: false,
  });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: s.data === undefined, fetching: true }));
    fetcherRef
      .current()
      .then((data) => {
        if (!cancelled) setState({ data, error: undefined, loading: false, fetching: false });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState((s) => ({ ...s, error, loading: false, fetching: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
