import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Tool } from "ai";

const mockEmitSubAgentEvent = vi.hoisted(() => vi.fn());
const mockGetParentMessageId = vi.hoisted(() => vi.fn(() => "test-msg"));

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: mockEmitSubAgentEvent,
  getParentMessageId: mockGetParentMessageId,
}));

vi.mock("@/lib/sub-agent-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sub-agent-types")>();
  return {
    ...actual,
    createSubAgentId: vi.fn(() => "sa-test-id"),
  };
});

import { getToolDisplayName, wrapToolWithSubAgentTracking } from "@/lib/sub-agent-tool-wrapper";
import { emitSubAgentEvent } from "@/lib/sub-agent-emitter";

describe("getToolDisplayName", () => {
  it("returns display name for known tools", () => {
    expect(getToolDisplayName("brave_search")).toBe("Brave Search");
  });

  it("returns the raw tool name for unknown tools", () => {
    expect(getToolDisplayName("made_up_tool")).toBe("made_up_tool");
  });

  it("returns display names for manual sub-agents", () => {
    expect(getToolDisplayName("memory_agent")).toBe("Memory Extraction");
    expect(getToolDisplayName("retrieval_agent")).toBe("Research Recall");
    expect(getToolDisplayName("name_folder")).toBe("Folder Naming");
  });
});

describe("wrapToolWithSubAgentTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the original tool unchanged if it has no execute function", () => {
    const tool = { description: "no execute" } as unknown as Tool;
    const wrapped = wrapToolWithSubAgentTracking("my_tool", tool);
    expect(wrapped).toBe(tool);
  });

  it("wrapped execute calls emitSubAgentEvent with start, tool-call, tool-result, complete events", async () => {
    const tool = {
      description: "test tool",
      execute: vi.fn().mockResolvedValue({ result: "ok" }),
    };

    const wrapped = wrapToolWithSubAgentTracking("brave_search", tool as unknown as Tool);
    const result = await wrapped.execute!({ query: "test" }, { toolCallId: "tc-1", messages: [] } as any);

    expect(result).toEqual({ result: "ok" });

    const calls = vi.mocked(emitSubAgentEvent).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls[0][0]).toMatchObject({ type: "start" });
    expect(calls[1][0]).toMatchObject({ type: "tool-call" });
    expect(calls[2][0]).toMatchObject({ type: "tool-result" });
    expect(calls[3][0]).toMatchObject({ type: "complete" });
  });

  it("wrapped execute propagates the original result", async () => {
    const expectedResult = { data: [1, 2, 3] };
    const tool = {
      description: "test tool",
      execute: vi.fn().mockResolvedValue(expectedResult),
    };

    const wrapped = wrapToolWithSubAgentTracking("exa_search", tool as unknown as Tool);
    const result = await wrapped.execute!({ query: "test" }, { toolCallId: "tc-2", messages: [] } as any);
    expect(result).toBe(expectedResult);
  });

  it("wrapped execute emits error event and re-throws when original execute throws", async () => {
    const error = new Error("API failure");
    const tool = {
      description: "test tool",
      execute: vi.fn().mockRejectedValue(error),
    };

    const wrapped = wrapToolWithSubAgentTracking("serper_search", tool as unknown as Tool);

    await expect(wrapped.execute!({ query: "test" }, { toolCallId: "tc-3", messages: [] } as any)).rejects.toThrow("API failure");

    const calls = vi.mocked(emitSubAgentEvent).mock.calls;
    const errorCall = calls.find((c) => c[0].type === "error");
    expect(errorCall).toBeDefined();
    expect(errorCall![0]).toMatchObject({ type: "error", error: "API failure" });
  });

  it("wrapped execute emits cancelled event when original execute throws AbortError", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const tool = {
      description: "test tool",
      execute: vi.fn().mockRejectedValue(abortError),
    };

    const wrapped = wrapToolWithSubAgentTracking("serper_search", tool as unknown as Tool);

    await expect(wrapped.execute!({ query: "test" }, { toolCallId: "tc-abort", messages: [] } as any)).rejects.toThrow();

    const calls = vi.mocked(emitSubAgentEvent).mock.calls;
    const cancelledCall = calls.find((c) => c[0].type === "cancelled");
    expect(cancelledCall).toBeDefined();
    expect(cancelledCall![0]).toMatchObject({ type: "cancelled", id: "sa-test-id" });

    const errorCall = calls.find((c) => c[0].type === "error");
    expect(errorCall).toBeUndefined();
  });

  it("tool-result event has status error when execute throws", async () => {
    const error = new Error("API failure");
    const tool = {
      description: "test tool",
      execute: vi.fn().mockRejectedValue(error),
    };

    const wrapped = wrapToolWithSubAgentTracking("serper_search", tool as unknown as Tool);

    await expect(wrapped.execute!({ query: "test" }, { toolCallId: "tc-3", messages: [] } as any)).rejects.toThrow("API failure");

    const calls = vi.mocked(emitSubAgentEvent).mock.calls;
    const toolResultCall = calls.find((c) => c[0].type === "tool-result");
    expect(toolResultCall).toBeDefined();
    expect(toolResultCall![0]).toMatchObject({
      type: "tool-result",
      id: "sa-test-id",
      toolCallIndex: 0,
      result: "API failure",
      status: "error",
    });
  });

  it("emitted events have correct structure", async () => {
    const tool = {
      description: "test tool",
      execute: vi.fn().mockResolvedValue({ result: "ok" }),
    };

    const wrapped = wrapToolWithSubAgentTracking("brave_search", tool as unknown as Tool);
    await wrapped.execute!({ query: "test" }, { toolCallId: "tc-4", messages: [] } as any);

    const calls = vi.mocked(emitSubAgentEvent).mock.calls;

    expect(calls[0][0]).toEqual({
      type: "start",
      id: "sa-test-id",
      name: "Brave Search",
      toolName: "brave_search",
      parentMessageId: "test-msg",
    });

    expect(calls[1][0]).toMatchObject({
      type: "tool-call",
      id: "sa-test-id",
      toolCall: {
        toolName: "brave_search",
        args: { query: "test" },
        status: "running",
      },
    });

    expect(calls[2][0]).toEqual({
      type: "tool-result",
      id: "sa-test-id",
      toolCallIndex: 0,
      result: { result: "ok" },
    });

    expect(calls[3][0]).toEqual({
      type: "complete",
      id: "sa-test-id",
    });
  });
});
