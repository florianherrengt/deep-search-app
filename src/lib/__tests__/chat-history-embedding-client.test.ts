import { describe, expect, it, vi } from "vitest";
import { ChatHistoryEmbeddingClient } from "@/lib/chat-history-embedding-client";

describe("ChatHistoryEmbeddingClient", () => {
  it("creates the worker lazily and routes embedding responses by request id", async () => {
    const worker = new FakeWorker();
    const factory = vi.fn(() => worker as unknown as Worker);
    const client = new ChatHistoryEmbeddingClient(factory);

    expect(factory).not.toHaveBeenCalled();
    const pending = client.embed(["espresso"]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "embed",
      id: 1,
      texts: ["espresso"],
    });

    worker.emitMessage({ type: "result", id: 1, embeddings: [[0.1, 0.2]] });
    await expect(pending).resolves.toEqual([[0.1, 0.2]]);
  });

  it("rejects an aborted caller and ignores its late worker response", async () => {
    const worker = new FakeWorker();
    const client = new ChatHistoryEmbeddingClient(
      () => worker as unknown as Worker,
    );
    const controller = new AbortController();
    const pending = client.embed(["espresso"], controller.signal);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    worker.emitMessage({ type: "result", id: 1, embeddings: [[1]] });
  });

  it("restarts after a worker crash", async () => {
    const first = new FakeWorker();
    const second = new FakeWorker();
    const factory = vi
      .fn<() => Worker>()
      .mockReturnValueOnce(first as unknown as Worker)
      .mockReturnValueOnce(second as unknown as Worker);
    const client = new ChatHistoryEmbeddingClient(factory);
    const failed = client.embed(["first"]);

    first.emitError("worker crashed");
    await expect(failed).rejects.toThrow("worker crashed");
    expect(first.terminate).toHaveBeenCalled();

    const retried = client.embed(["second"]);
    second.emitMessage({ type: "result", id: 2, embeddings: [[1]] });
    await expect(retried).resolves.toEqual([[1]]);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

class FakeWorker {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  private readonly listeners = new Map<string, Array<(event: never) => void>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback =
      typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback as (event: never) => void);
    this.listeners.set(type, listeners);
  }

  emitMessage(data: unknown) {
    this.emit("message", { data } as MessageEvent);
  }

  emitError(message: string) {
    this.emit("error", { message } as ErrorEvent);
  }

  private emit(type: string, event: MessageEvent | ErrorEvent) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event as never);
    }
  }
}
