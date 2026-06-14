// @vitest-environment jsdom
import { render, renderHook, act } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SubAgentProvider,
  useSubAgentActions,
  useSubAgentState,
  useSubAgentStore,
} from "@/lib/sub-agent-store";
import type { SubAgentEvent, SubAgentRun } from "@/lib/sub-agent-types";
import { MAX_SUB_AGENT_TEXT_LENGTH } from "@/lib/sub-agent-types";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SubAgentProvider>{children}</SubAgentProvider>
);

const chatId = "chat-1";

function startEvent(
  id: string,
  overrides: Partial<Extract<SubAgentEvent, { type: "start" }>> = {},
): SubAgentEvent {
  return {
    type: "start",
    id,
    source: "sub-agent",
    name: `Subagent ${id}`,
    toolName: "retrieval_agent",
    parentMessageId: "msg-1",
    ...overrides,
  };
}

describe("SubAgentStore processEvent", () => {
  it("ignores main-agent tool wrapper start events", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, {
        type: "start",
        id: "tool-run-1",
        name: "Brave Search",
        toolName: "brave_search",
        parentMessageId: "msg-1",
      });
    });

    expect(result.current.getRuns(chatId)).toEqual([]);
  });

  it("start event creates a new run with status running", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("sa-1");
    expect(runs[0].chatId).toBe("sa-1");
    expect(runs[0].parentChatId).toBe(chatId);
    expect(runs[0].status).toBe("running");
    expect(runs[0].startedAt).toBeTruthy();
    expect(runs[0].finishedAt).toBeNull();
    expect(runs[0].text).toBe("");
    expect(runs[0].chunksReceived).toBe(0);
    expect(runs[0].toolCalls).toEqual([]);
    expect(runs[0].error).toBeNull();
  });

  it("text-delta event appends text and transitions to streaming status", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "text-delta",
        id: "sa-1",
        delta: "Hello ",
      });
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "text-delta",
        id: "sa-1",
        delta: "world",
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].text).toBe("Hello world");
    expect(runs[0].status).toBe("streaming");
    expect(runs[0].chunksReceived).toBe(2);
  });

  it("tool-call event adds a tool call to the run", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-call",
        id: "sa-1",
        toolCall: {
          toolName: "web_search",
          args: { query: "test" },
          status: "running",
        },
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].toolCalls).toHaveLength(1);
    expect(runs[0].toolCalls[0].toolName).toBe("web_search");
    expect(runs[0].toolCalls[0].status).toBe("running");
  });

  it("tool-result event updates the tool call with result and status complete", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-call",
        id: "sa-1",
        toolCall: {
          toolName: "web_search",
          args: { query: "test" },
          status: "running",
        },
      });
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-result",
        id: "sa-1",
        toolCallIndex: 0,
        result: "Search results here",
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].toolCalls[0].status).toBe("complete");
    expect(runs[0].toolCalls[0].result).toBe("Search results here");
  });

  it("tool-result event can update a tool call by toolCallId", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-call",
        id: "sa-1",
        toolCall: {
          toolCallId: "tc-1",
          toolName: "read_file",
          args: { filename: "notes.md" },
          status: "running",
        },
      });
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-result",
        id: "sa-1",
        toolCallId: "tc-1",
        result: "File content",
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].toolCalls[0].status).toBe("complete");
    expect(runs[0].toolCalls[0].result).toBe("File content");
  });

  it("complete event sets status to completed and finishedAt", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, { type: "complete", id: "sa-1" });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].status).toBe("completed");
    expect(runs[0].finishedAt).toBeTruthy();
  });

  it("error event sets status to failed, finishedAt, and error message", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "error",
        id: "sa-1",
        error: "Failed to process",
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].finishedAt).toBeTruthy();
    expect(runs[0].error).toBe("Failed to process");
  });

  it("truncates text at MAX_SUB_AGENT_TEXT_LENGTH", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "text-delta",
        id: "sa-1",
        delta: "a".repeat(MAX_SUB_AGENT_TEXT_LENGTH),
      });
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "text-delta",
        id: "sa-1",
        delta: "overflow",
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].text.length).toBe(MAX_SUB_AGENT_TEXT_LENGTH);
    expect(runs[0].text).not.toContain("overflow");
  });

  it("tracks multiple runs independently", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, startEvent("sa-2"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "text-delta",
        id: "sa-1",
        delta: "First",
      });
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "text-delta",
        id: "sa-2",
        delta: "Second",
      });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "complete", id: "sa-1" });
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "error",
        id: "sa-2",
        error: "Boom",
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("sa-1");
    expect(runs[0].text).toBe("First");
    expect(runs[0].status).toBe("completed");
    expect(runs[1].id).toBe("sa-2");
    expect(runs[1].text).toBe("Second");
    expect(runs[1].status).toBe("failed");
    expect(runs[1].error).toBe("Boom");
  });

  it("chunks are appended in order", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    const chunks = ["chunk-1", ",chunk-2", ",chunk-3"];
    for (const chunk of chunks) {
      act(() => {
        result.current.processEvent(chatId, {
          type: "text-delta",
          id: "sa-1",
          delta: chunk,
        });
      });
    }

    const runs = result.current.getRuns(chatId);
    expect(runs[0].text).toBe("chunk-1,chunk-2,chunk-3");
    expect(runs[0].chunksReceived).toBe(3);
  });

  it("preserves repeated text-delta chunks from the same run", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-repeat"));
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-repeat", delta: "the " });
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-repeat", delta: "the " });
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-repeat", delta: "the " });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].text).toBe("the the the ");
    expect(runs[0].chunksReceived).toBe(3);
  });

  it("batches rapid text deltas into one state commit", () => {
    vi.useFakeTimers();

    try {
      let renderCount = 0;
      const { result } = renderHook(() => {
        renderCount += 1;
        return useSubAgentStore();
      }, { wrapper });

      act(() => {
        result.current.processEvent(chatId, startEvent("sa-1"));
      });
      const renderCountAfterStart = renderCount;

      act(() => {
        result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "a" });
        result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "b" });
        result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "c" });
      });

      expect(renderCount).toBe(renderCountAfterStart);
      expect(result.current.getRuns(chatId)[0].text).toBe("abc");
      expect(result.current.getRuns(chatId)[0].chunksReceived).toBe(3);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(renderCount).toBe(renderCountAfterStart + 1);
      expect(result.current.getRuns(chatId)[0].text).toBe("abc");
      expect(result.current.getRuns(chatId)[0].status).toBe("streaming");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not re-render action-only consumers during streamed text updates", () => {
    vi.useFakeTimers();

    try {
      let actionRenderCount = 0;
      let stateRenderCount = 0;
      let storeActions!: ReturnType<typeof useSubAgentActions>;

      function ActionOnlyConsumer() {
        actionRenderCount += 1;
        storeActions = useSubAgentActions();
        return null;
      }

      function StateConsumer() {
        stateRenderCount += 1;
        useSubAgentState();
        return null;
      }

      const view = render(
        <SubAgentProvider>
          <ActionOnlyConsumer />
          <StateConsumer />
        </SubAgentProvider>,
      );

      act(() => {
        storeActions.processEvent(chatId, startEvent("sa-1"));
      });

      const actionRenderCountAfterStart = actionRenderCount;
      const stateRenderCountAfterStart = stateRenderCount;

      act(() => {
        for (let index = 0; index < 100; index += 1) {
          storeActions.processEvent(chatId, {
            type: "text-delta",
            id: "sa-1",
            delta: String(index % 10),
          });
        }
      });

      expect(actionRenderCount).toBe(actionRenderCountAfterStart);
      expect(stateRenderCount).toBe(stateRenderCountAfterStart);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(actionRenderCount).toBe(actionRenderCountAfterStart);
      expect(stateRenderCount).toBe(stateRenderCountAfterStart + 1);

      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("two parallel sub-agents do not mix their streams", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-alpha", { name: "Agent A" }));
    });
    act(() => {
      result.current.processEvent(chatId, startEvent("sa-beta", { name: "Agent B" }));
    });

    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-alpha", delta: "A1" });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-beta", delta: "B1" });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-alpha", delta: " A2" });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-beta", delta: " B2" });
    });

    const runs = result.current.getRuns(chatId);
    const alpha = runs.find((r) => r.id === "sa-alpha")!;
    const beta = runs.find((r) => r.id === "sa-beta")!;
    expect(alpha.text).toBe("A1 A2");
    expect(beta.text).toBe("B1 B2");
    expect(alpha.chunksReceived).toBe(2);
    expect(beta.chunksReceived).toBe(2);
  });

  it("completion preserves the streamed output", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "Hello world" });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "complete", id: "sa-1" });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].text).toBe("Hello world");
    expect(runs[0].status).toBe("completed");
    expect(runs[0].chunksReceived).toBe(1);
  });

  it("failure preserves partial streamed text and records the error", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "Partial text" });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "error", id: "sa-1", error: "Stream failed" });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].text).toBe("Partial text");
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toBe("Stream failed");
    expect(runs[0].chunksReceived).toBe(1);
  });

  it("cancelled event sets status to cancelled and preserves partial text", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "Partial text" });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "cancelled", id: "sa-1" });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].text).toBe("Partial text");
    expect(runs[0].status).toBe("cancelled");
    expect(runs[0].error).toBeNull();
    expect(runs[0].finishedAt).toBeTruthy();
  });

  it("streaming status does not revert to running on subsequent deltas", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "first" });
    });
    expect(result.current.getRuns(chatId)[0].status).toBe("streaming");

    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: " second" });
    });
    expect(result.current.getRuns(chatId)[0].status).toBe("streaming");
  });

  it("folder naming sub-agent output is visible in store", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, {
        type: "start",
        id: "sa-folder",
        source: "sub-agent",
        name: "Folder Naming",
        toolName: "name_folder",
        parentMessageId: "transport",
      });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-folder", delta: "best-coffee-beans" });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(1);
    expect(runs[0].name).toBe("Folder Naming");
    expect(runs[0].toolName).toBe("name_folder");
    expect(runs[0].text).toBe("best-coffee-beans");
    expect(runs[0].status).toBe("streaming");
  });

  it("memory extraction sub-agent output is visible in store", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, {
        type: "start",
        id: "sa-memory",
        source: "sub-agent",
        name: "Memory Extraction",
        toolName: "memory_agent",
        parentMessageId: "transport",
      });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-memory", delta: '["fact 1"' });
    });
    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-memory", delta: ', "fact 2"]' });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(1);
    expect(runs[0].name).toBe("Memory Extraction");
    expect(runs[0].text).toBe('["fact 1", "fact 2"]');
    expect(runs[0].chunksReceived).toBe(2);
  });

  it("tool-result with explicit status error marks the tool call as error", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-call",
        id: "sa-1",
        toolCall: {
          toolName: "web_search",
          args: { query: "test" },
          status: "running",
        },
      });
    });
    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-result",
        id: "sa-1",
        toolCallIndex: 0,
        result: "API failure",
        status: "error",
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].toolCalls[0].status).toBe("error");
    expect(runs[0].toolCalls[0].result).toBe("API failure");
  });

  it("updateRun does not match by chatId", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, startEvent("sa-2"));
    });

    act(() => {
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "text for sa-1" });
    });

    const runs = result.current.getRuns(chatId);
    const run1 = runs.find((r) => r.id === "sa-1")!;
    const run2 = runs.find((r) => r.id === "sa-2")!;
    expect(run1.text).toBe("text for sa-1");
    expect(run2.text).toBe("");
  });

  it("start event dedup does not match by chatId", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });
    act(() => {
      result.current.processEvent(chatId, startEvent("sa-2"));
    });

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(2);
  });

  it("deduplicates tool-call events by toolCallId, not just toolName", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-dedup"));
    });

    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-call",
        id: "sa-dedup",
        toolCall: { toolCallId: "tc-1", toolName: "list_files", args: { folder: "a" }, status: "running" },
      });
    });

    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-call",
        id: "sa-dedup",
        toolCall: { toolCallId: "tc-2", toolName: "list_files", args: { folder: "b" }, status: "running" },
      });
    });

    act(() => {
      result.current.processEvent(chatId, {
        type: "tool-call",
        id: "sa-dedup",
        toolCall: { toolCallId: "tc-1", toolName: "list_files", args: { folder: "a" }, status: "running" },
      });
    });

    const runs = result.current.getRuns(chatId);
    expect(runs[0].toolCalls).toHaveLength(2);
    expect(runs[0].toolCalls[0].toolCallId).toBe("tc-1");
    expect(runs[0].toolCalls[1].toolCallId).toBe("tc-2");
  });

  it("does not crash on tool-call event with missing toolCall property", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });

    expect(() => {
      act(() => {
        result.current.processEvent(chatId, {
          type: "tool-call",
          id: "sa-1",
          toolCall: undefined as unknown as import("@/lib/sub-agent-types").SubAgentToolCall,
        });
      });
    }).not.toThrow();

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("sa-1");
  });

  it("does not crash on tool-call event with null toolCall property", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });

    expect(() => {
      act(() => {
        result.current.processEvent(chatId, {
          type: "tool-call",
          id: "sa-1",
          toolCall: null as unknown as import("@/lib/sub-agent-types").SubAgentToolCall,
        });
      });
    }).not.toThrow();

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(1);
  });

  it("fingerprint pruning keeps recent events, not old ones", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      for (let i = 0; i < 5001; i++) {
        result.current.processEvent(chatId, startEvent(`sa-prune-${i}`));
      }
    });

    const runsBefore = result.current.getRuns(chatId);
    expect(runsBefore).toHaveLength(5001);

    act(() => {
      result.current.processEvent(chatId, {
        type: "text-delta",
        id: "sa-prune-0",
        delta: "recent-delta",
      });
    });

    const run0 = result.current.getRuns(chatId).find((r) => r.id === "sa-prune-0");
    expect(run0).toBeDefined();
    expect(run0!.text).toBe("recent-delta");
  });
});

const mockPersistWrite = vi.hoisted(() => vi.fn());
const mockDiskRead = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sub-agent-persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sub-agent-persistence")>();
  return {
    ...actual,
    writeSubAgentRuns: mockPersistWrite,
    readSubAgentRuns: mockDiskRead,
  };
});

describe("persistRuns write serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads latest state at write time, not at call time", async () => {
    mockPersistWrite.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
      result.current.processEvent(chatId, {
        type: "complete",
        id: "sa-1",
      });
    });

    const p1 = result.current.persistRuns(chatId, "folder-1");

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-2"));
      result.current.processEvent(chatId, {
        type: "complete",
        id: "sa-2",
      });
    });

    const p2 = result.current.persistRuns(chatId, "folder-1");

    await Promise.all([p1, p2]);

    expect(mockPersistWrite).toHaveBeenCalledTimes(2);
    for (const call of mockPersistWrite.mock.calls) {
      const runs = call[2] as SubAgentRun[];
      expect(runs).toHaveLength(2);
      expect(runs.find((r) => r.id === "sa-2")).toBeDefined();
    }
  });

  it("does not lose runs when writes are concurrent", async () => {
    mockPersistWrite.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
      result.current.processEvent(chatId, { type: "complete", id: "sa-1" });
    });

    const p1 = result.current.persistRuns(chatId, "folder-1");

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-2"));
      result.current.processEvent(chatId, { type: "complete", id: "sa-2" });
    });

    const p2 = result.current.persistRuns(chatId, "folder-1");

    await Promise.all([p1, p2]);

    expect(mockPersistWrite).toHaveBeenCalledTimes(2);

    const secondWriteRuns = mockPersistWrite.mock.calls[1][2] as SubAgentRun[];
    expect(secondWriteRuns).toHaveLength(2);
    expect(secondWriteRuns.find((r) => r.id === "sa-1")).toBeDefined();
    expect(secondWriteRuns.find((r) => r.id === "sa-2")).toBeDefined();
  });
});

describe("loadRunsFromDisk merges with in-flight runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves running sub-agents when loading from disk", async () => {
    const diskRuns: SubAgentRun[] = [
      {
        id: "sa-disk-1",
        chatId: "sa-disk-1",
        parentChatId: chatId,
        source: "sub-agent",
        name: "Completed Agent",
        toolName: "retrieval_agent",
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:01:00Z",
        text: "result text",
        chunksReceived: 5,
        toolCalls: [],
        error: null,
        parentMessageId: "msg-1",
      },
    ];
    mockDiskRead.mockResolvedValue(diskRuns);

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-running-1"));
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-running-1", delta: "streaming..." });
    });

    await act(async () => {
      await result.current.loadRunsFromDisk(chatId, "folder-1");
    });

    const runs = result.current.getRuns(chatId);
    const running = runs.find((r) => r.id === "sa-running-1");
    const fromDisk = runs.find((r) => r.id === "sa-disk-1");

    expect(running).toBeDefined();
    expect(running!.status).toBe("streaming");
    expect(running!.text).toBe("streaming...");
    expect(fromDisk).toBeDefined();
    expect(fromDisk!.status).toBe("completed");
  });

  it("preserves streaming sub-agents when loading from disk", async () => {
    mockDiskRead.mockResolvedValue([]);

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-streaming"));
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-streaming", delta: "partial" });
    });

    expect(result.current.getRuns(chatId)[0].status).toBe("streaming");

    await act(async () => {
      await result.current.loadRunsFromDisk(chatId, "folder-1");
    });

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("sa-streaming");
    expect(runs[0].status).toBe("streaming");
    expect(runs[0].text).toBe("partial");
  });

  it("does not duplicate disk runs that match in-flight IDs", async () => {
    const diskRuns: SubAgentRun[] = [
      {
        id: "sa-1",
        chatId: "sa-1",
        parentChatId: chatId,
        source: "sub-agent",
        name: "Agent",
        toolName: "retrieval_agent",
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:01:00Z",
        text: "disk result",
        chunksReceived: 3,
        toolCalls: [],
        error: null,
        parentMessageId: "msg-1",
      },
    ];
    mockDiskRead.mockResolvedValue(diskRuns);

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "streaming" });
    });

    await act(async () => {
      await result.current.loadRunsFromDisk(chatId, "folder-1");
    });

    const runs = result.current.getRuns(chatId);
    const matches = runs.filter((r) => r.id === "sa-1");
    expect(matches).toHaveLength(1);
    expect(matches[0].status).toBe("streaming");
    expect(matches[0].text).toBe("streaming");
  });

  it("preserves completed in-memory runs over stale disk data", async () => {
    const staleDiskRuns: SubAgentRun[] = [
      {
        id: "sa-1",
        chatId: "sa-1",
        parentChatId: chatId,
        source: "sub-agent",
        name: "Agent",
        toolName: "retrieval_agent",
        status: "running",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: null,
        text: "",
        chunksReceived: 0,
        toolCalls: [],
        error: null,
        parentMessageId: "msg-1",
      },
    ];
    mockDiskRead.mockResolvedValue(staleDiskRuns);

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "done text" });
      result.current.processEvent(chatId, { type: "complete", id: "sa-1" });
    });

    expect(result.current.getRuns(chatId)[0].status).toBe("completed");

    await act(async () => {
      await result.current.loadRunsFromDisk(chatId, "folder-1");
    });

    const runs = result.current.getRuns(chatId);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("sa-1");
    expect(runs[0].status).toBe("completed");
    expect(runs[0].text).toBe("done text");
  });

  it("scopes fingerprints per chat — same run ID in different chats does not dedup", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });
    const chatA = "chat-a";
    const chatB = "chat-b";

    act(() => {
      result.current.processEvent(chatA, startEvent("sa-1"));
      result.current.processEvent(chatA, { type: "text-delta", id: "sa-1", delta: "hello" });
      result.current.processEvent(chatA, { type: "complete", id: "sa-1" });
    });

    act(() => {
      result.current.processEvent(chatB, startEvent("sa-1"));
      result.current.processEvent(chatB, { type: "text-delta", id: "sa-1", delta: "world" });
      result.current.processEvent(chatB, { type: "complete", id: "sa-1" });
    });

    expect(result.current.getRuns(chatA)).toHaveLength(1);
    expect(result.current.getRuns(chatA)[0].text).toBe("hello");
    expect(result.current.getRuns(chatB)).toHaveLength(1);
    expect(result.current.getRuns(chatB)[0].text).toBe("world");
  });

  it("clearRuns removes fingerprints for that chat", () => {
    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "hello" });
      result.current.processEvent(chatId, { type: "complete", id: "sa-1" });
    });

    expect(result.current.getRuns(chatId)).toHaveLength(1);

    act(() => {
      result.current.clearRuns(chatId);
    });

    expect(result.current.getRuns(chatId)).toHaveLength(0);

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
      result.current.processEvent(chatId, { type: "text-delta", id: "sa-1", delta: "hello again" });
    });

    expect(result.current.getRuns(chatId)).toHaveLength(1);
    expect(result.current.getRuns(chatId)[0].text).toBe("hello again");
  });

  describe("out-of-order events", () => {
    it("text-delta before start creates stub run and preserves text", () => {
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, {
          type: "text-delta",
          id: "sa-1",
          delta: "early text",
        });
      });

      const runsAfterDelta = result.current.getRuns(chatId);
      expect(runsAfterDelta).toHaveLength(1);
      expect(runsAfterDelta[0].text).toBe("early text");
      expect(runsAfterDelta[0].status).toBe("streaming");

      act(() => {
        result.current.processEvent(chatId, startEvent("sa-1"));
      });

      const runsAfterStart = result.current.getRuns(chatId);
      expect(runsAfterStart).toHaveLength(1);
      expect(runsAfterStart[0].text).toBe("early text");
      expect(runsAfterStart[0].name).toBe(`Subagent sa-1`);
      expect(runsAfterStart[0].toolName).toBe("retrieval_agent");
    });

    it("complete before start creates stub run and marks it completed", () => {
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, {
          type: "complete",
          id: "sa-1",
        });
      });

      const runsAfterComplete = result.current.getRuns(chatId);
      expect(runsAfterComplete).toHaveLength(1);
      expect(runsAfterComplete[0].status).toBe("completed");
      expect(runsAfterComplete[0].finishedAt).toBeTruthy();

      act(() => {
        result.current.processEvent(chatId, startEvent("sa-1"));
      });

      const runsAfterStart = result.current.getRuns(chatId);
      expect(runsAfterStart).toHaveLength(1);
      expect(runsAfterStart[0].status).toBe("completed");
      expect(runsAfterStart[0].name).toBe(`Subagent sa-1`);
    });

    it("error before start creates stub run and marks it failed", () => {
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, {
          type: "error",
          id: "sa-1",
          error: "something went wrong",
        });
      });

      const runs = result.current.getRuns(chatId);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("failed");
      expect(runs[0].error).toBe("something went wrong");
    });

    it("cancelled before start creates stub run and marks it cancelled", () => {
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, {
          type: "cancelled",
          id: "sa-1",
        });
      });

      const runs = result.current.getRuns(chatId);
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("cancelled");
    });

    it("tool-call before start creates stub run", () => {
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, {
          type: "tool-call",
          id: "sa-1",
          toolCall: { toolName: "search", args: { q: "test" }, status: "running" },
        });
      });

      const runs = result.current.getRuns(chatId);
      expect(runs).toHaveLength(1);
      expect(runs[0].toolCalls).toHaveLength(1);
      expect(runs[0].toolCalls[0].toolName).toBe("search");
    });

    it("stub run has fallback name when start never arrives", () => {
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, {
          type: "text-delta",
          id: "sa-orphan",
          delta: "orphan text",
        });
      });

      const runs = result.current.getRuns(chatId);
      expect(runs).toHaveLength(1);
      expect(runs[0].name).toBe("Sub-agent");
      expect(runs[0].toolName).toBe("unknown");
      expect(runs[0].text).toBe("orphan text");
    });

    it("stub creation warning includes the actual event type", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, {
          type: "error",
          id: "sa-1",
          error: "boom",
        });
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("creating stub run"),
        expect.objectContaining({ eventType: "error" }),
      );

      consoleSpy.mockRestore();
    });

    it("ignores unknown event type without corrupting store state", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useSubAgentStore(), { wrapper });

      act(() => {
        result.current.processEvent(chatId, startEvent("sa-1"));
      });

      act(() => {
        result.current.processEvent(chatId, {
          type: "unknown_type",
          id: "sa-1",
        } as unknown as SubAgentEvent);
      });

      const runs = result.current.getRuns(chatId);
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe("sa-1");
      expect(runs[0].status).toBe("running");

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("ignoring unknown sub-agent event type"),
        expect.objectContaining({ type: "unknown_type" }),
      );

      consoleSpy.mockRestore();
    });
  });

  it("loadRunsFromDisk handles read failure gracefully", async () => {
    mockDiskRead.mockRejectedValue(new Error("disk read error"));

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    await act(async () => {
      await result.current.loadRunsFromDisk(chatId, "folder-1");
    });

    expect(result.current.getRuns(chatId)).toEqual([]);
  });

  it("persistRuns handles write failure gracefully", async () => {
    mockPersistWrite.mockRejectedValue(new Error("disk full"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useSubAgentStore(), { wrapper });

    act(() => {
      result.current.processEvent(chatId, startEvent("sa-1"));
    });

    await act(async () => {
      await result.current.persistRuns(chatId, "folder-1").catch(() => {});
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to persist"),
      expect.any(Object),
    );

    consoleSpy.mockRestore();
  });
});
