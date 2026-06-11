function createAbortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAbortError();
  }
}

export function abortablePromise<T>(
  promise: Promise<T>,
  abortSignal?: AbortSignal,
): Promise<T> {
  if (!abortSignal) return promise;
  throwIfAborted(abortSignal);

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createAbortError());

    abortSignal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      abortSignal.removeEventListener("abort", abort);
    });
  });
}

export function abortableDelay(
  ms: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (!abortSignal) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
  throwIfAborted(abortSignal);

  let abort: (() => void) | undefined;
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    abort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    abortSignal.addEventListener("abort", abort, { once: true });
  }).finally(() => {
    if (abort) abortSignal.removeEventListener("abort", abort);
  });
}
