import PQueue from 'p-queue';

const queue = new PQueue({ concurrency: 1, intervalCap: 1, interval: 1000 });

export function rateLimit<T>(
  fn: () => Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  return queue.add(fn, { signal: abortSignal });
}
