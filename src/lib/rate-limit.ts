type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  fn: () => Promise<unknown>;
};

let queue: Pending[] = [];
let running = false;
let lastFinish = 0;
const MIN_INTERVAL = 1000;

function flush() {
  if (running || queue.length === 0) return;
  running = true;

  const elapsed = Date.now() - lastFinish;
  const delay = Math.max(0, MIN_INTERVAL - elapsed);

  setTimeout(() => {
    const { resolve, reject, fn } = queue.shift()!;
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

export function rateLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ resolve: resolve as (v: unknown) => void, reject, fn });
    flush();
  });
}
