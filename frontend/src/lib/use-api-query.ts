"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isAbort } from "@/lib/api/errors";

interface QueryResult<T> {
  baseKey: string | null;
  requestKey: string | null;
  data?: T;
  error?: unknown;
}

export interface ApiQuery<T> {
  data: T | undefined;
  error: unknown;
  /** True while the current request is in flight (stale data may still be shown). */
  loading: boolean;
  reload: () => void;
}

/**
 * Minimal data hook: cancels in-flight requests when the key changes or the
 * component unmounts/hides, keeps stale data during background refreshes, and
 * never reports AbortErrors as failures. Pass `key = null` to skip.
 */
export function useApiQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: { refreshMs?: number } = {},
): ApiQuery<T> {
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });

  const [nonce, setNonce] = useState(0);
  const requestKey = key === null ? null : `${key}#${nonce}`;
  const [result, setResult] = useState<QueryResult<T>>({ baseKey: null, requestKey: null });

  useEffect(() => {
    if (requestKey === null) return;
    const controller = new AbortController();
    fetcherRef.current(controller.signal).then(
      (data) => setResult({ baseKey: key, requestKey, data }),
      (error: unknown) => {
        if (!isAbort(error)) setResult((prev) => ({ ...prev, baseKey: key, requestKey, error }));
      },
    );
    return () => controller.abort();
  }, [key, requestKey]);

  useEffect(() => {
    if (!opts.refreshMs || key === null) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    }, opts.refreshMs);
    return () => clearInterval(id);
  }, [key, opts.refreshMs]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const sameKey = result.baseKey === key;
  const settled = result.requestKey === requestKey;

  return {
    data: sameKey ? result.data : undefined,
    error: settled ? result.error : undefined,
    loading: key !== null && !settled,
    reload,
  };
}
