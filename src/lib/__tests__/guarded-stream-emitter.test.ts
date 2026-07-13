import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";

const mocks = vi.hoisted(() => ({
  createTools: vi.fn(),
  createCoreGuardedStream: vi.fn(),
}));

vi.mock("@/lib/transport/tool-registry", () => ({
  createTools: mocks.createTools,
}));

vi.mock("deep-search-core/research-orchestrator", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("deep-search-core/research-orchestrator")
  >();
  return {
    ...actual,
    createGuardedStream: mocks.createCoreGuardedStream,
  };
});

vi.mock("@/lib/skills-store", () => ({
  skillsStore: {
    get: vi.fn().mockResolvedValue({ skills: [] }),
  },
}));

import { createGuardedStream } from "@/lib/transport/guarded-stream";

describe("createGuardedStream sub-agent events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTools.mockResolvedValue({});
    mocks.createCoreGuardedStream.mockResolvedValue(undefined);
  });

  it("passes the chat-scoped emitter into the App tool registry", async () => {
    const emitEvent = vi.fn();
    const controller = {
      enqueue: vi.fn(),
    } as unknown as ReadableStreamDefaultController<UIMessageChunk>;

    await createGuardedStream({
      model: { modelId: "test" } as never,
      researchFolder: "test-folder",
      messages: [],
      abortSignal: undefined,
      emitEvent,
      controller,
    });

    expect(mocks.createTools).toHaveBeenCalledWith(
      expect.objectContaining({ emitEvent }),
    );
    expect(mocks.createCoreGuardedStream).toHaveBeenCalledWith(
      expect.objectContaining({ tools: {} }),
    );
  });
});
