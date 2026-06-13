import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncResource<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useAsyncResource<T>(
  initial: T,
  load: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): AsyncResource<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const gen = ++generationRef.current;
    setLoading(true);
    try {
      const next = await load();
      if (gen === generationRef.current) {
        setData(next);
        setError(null);
        setLoading(false);
      }
    } catch (err) {
      if (gen === generationRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
  }, deps);

  useEffect(() => {
    const gen = ++generationRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((d) => {
        if (!cancelled && gen === generationRef.current) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled && gen === generationRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, deps);

  return { data, loading, error, refresh };
}
