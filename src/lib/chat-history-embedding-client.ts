import { isRecord } from "@/lib/json";

interface PendingEmbeddingRequest {
  resolve: (embeddings: number[][]) => void;
  reject: (error: Error) => void;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
}

export class ChatHistoryEmbeddingClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingEmbeddingRequest>();

  constructor(
    private readonly workerFactory: () => Worker = () =>
      new Worker(
        new URL("../workers/chat-history-embedding.worker.ts", import.meta.url),
        { type: "module" },
      ),
  ) {}

  embed(texts: string[], abortSignal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return Promise.resolve([]);
    if (abortSignal?.aborted) {
      return Promise.reject(abortError(abortSignal));
    }

    const id = this.nextRequestId++;
    const worker = this.getWorker();

    return new Promise<number[][]>((resolve, reject) => {
      const abortListener = abortSignal
        ? () => {
            this.finishRequest(id);
            reject(abortError(abortSignal));
          }
        : undefined;

      if (abortListener) {
        abortSignal?.addEventListener("abort", abortListener, { once: true });
      }

      this.pending.set(id, {
        resolve,
        reject,
        abortSignal,
        abortListener,
      });
      worker.postMessage({ type: "embed", id, texts });
    });
  }

  dispose() {
    this.rejectAll(new Error("Embedding worker was disposed."));
    this.worker?.terminate();
    this.worker = null;
  }

  private getWorker() {
    if (this.worker) return this.worker;

    const worker = this.workerFactory();
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleWorkerError);
    this.worker = worker;
    return worker;
  }

  private readonly handleMessage = (event: MessageEvent<unknown>) => {
    if (!isRecord(event.data) || typeof event.data.type !== "string") return;
    if (event.data.type === "progress") return;
    if (typeof event.data.id !== "number") return;

    const pending = this.finishRequest(event.data.id);
    if (!pending) return;

    if (event.data.type === "error") {
      pending.reject(
        new Error(
          typeof event.data.message === "string"
            ? event.data.message
            : "Embedding worker failed.",
        ),
      );
      return;
    }

    if (event.data.type !== "result" || !isEmbeddingBatch(event.data.embeddings)) {
      pending.reject(new Error("Embedding worker returned an invalid response."));
      return;
    }

    pending.resolve(event.data.embeddings);
  };

  private readonly handleWorkerError = (event: ErrorEvent) => {
    const error = new Error(event.message || "Embedding worker crashed.");
    this.rejectAll(error);
    this.worker?.terminate();
    this.worker = null;
  };

  private finishRequest(id: number) {
    const pending = this.pending.get(id);
    if (!pending) return null;
    this.pending.delete(id);
    if (pending.abortListener) {
      pending.abortSignal?.removeEventListener("abort", pending.abortListener);
    }
    return pending;
  }

  private rejectAll(error: Error) {
    for (const id of this.pending.keys()) {
      this.finishRequest(id)?.reject(error);
    }
  }
}

function isEmbeddingBatch(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.every(
      (embedding) =>
        Array.isArray(embedding) && embedding.every((item) => typeof item === "number"),
    )
  );
}

function abortError(abortSignal: AbortSignal) {
  return abortSignal.reason instanceof Error
    ? abortSignal.reason
    : new DOMException("Aborted", "AbortError");
}
