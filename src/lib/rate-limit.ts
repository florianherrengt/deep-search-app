import { createAbortError } from "@/lib/abort";

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  fn: () => Promise<unknown>;
  abortSignal?: AbortSignal;
};

const queue: Pending[] = [];
let running = false;
let lastFinish = 0;
const MIN_INTERVAL = 1000;

function flush() {
  if (running || queue.length === 0) return;
  running = true;

  const pending = queue.shift()!;
  if (pending.abortSignal?.aborted) {
    running = false;
    pending.reject(createAbortError());
    flush();
    return;
  }

  const elapsed = Date.now() - lastFinish;
  const delay = Math.max(0, MIN_INTERVAL - elapsed);

  setTimeout(() => {
    const { resolve, reject, fn, abortSignal } = pending;
    if (abortSignal?.aborted) {
      reject(createAbortError());
      lastFinish = Date.now();
      running = false;
      flush();
      return;
    }

    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        lastFinish = Date.now();
        running = false;
        flush();
      });
  }, delay);
}

export function rateLimit<T>(
  fn: () => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(createAbortError());
      return;
    }

    queue.push({
      resolve: resolve as (v: unknown) => void,
      reject,
      fn,
      abortSignal,
    });
    flush();
  });
}
