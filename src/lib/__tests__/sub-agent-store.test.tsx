// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SubAgentProvider, useSubAgentStore } from "@/lib/sub-agent-store";
import type { SubAgentEvent } from "@/lib/sub-agent-types";
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
    expect(runs[0].toolCalls).toEqual([]);
    expect(runs[0].error).toBeNull();
  });

  it("text-delta event appends text to the run", () => {
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
});
