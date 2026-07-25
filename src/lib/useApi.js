import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * One fetching hook for every page. `refetching` is separate from `loading` on
 * purpose: first load shows skeletons, a refetch shows a translucent overlay
 * over the previous data. Collapsing to a skeleton on a keystroke makes search
 * feel broken.
 */
export function useApi(path, params, { skip = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [refetching, setRefetching] = useState(false);
  const loaded = useRef(false);
  const alive = useRef(true);
  const key = JSON.stringify(params || null);

  const run = useCallback(async () => {
    if (skip) { setLoading(false); return; }
    loaded.current ? setRefetching(true) : setLoading(true);
    setError(null);
    try {
      const result = await api(path, { params: params || undefined });
      if (!alive.current) return;
      setData(result);
      loaded.current = true;
    } catch (err) {
      if (!alive.current) return;
      setError(err);
    } finally {
      if (alive.current) {
        setLoading(false);
        setRefetching(false);
      }
    }
    // params is compared by value through `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, skip]);

  // A slow response that lands after the page navigated away must not write
  // state into an unmounted tree.
  useEffect(() => {
    alive.current = true;
    run();
    return () => { alive.current = false; };
  }, [run]);

  return { data, error, loading, refetching, refetch: run, setData };
}

/** Debounces a value — search inputs use 300 ms. */
export function useDebounced(value, ms = 300) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}
