import { useCallback, useEffect, useState } from "react";

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAsyncResource<T>(
  initial: T,
  load: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): AsyncResource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await load();
    setData(next);
  }, deps);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().then((d) => {
      if (!cancelled) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, deps);

  return { data, loading, refresh };
}
