// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useLayoutEffect, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, beforeAll, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { SubAgentProvider, useSubAgentActions } from "@/lib/sub-agent-store";
import type { SubAgentEvent } from "@/lib/sub-agent-types";

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function wrap(node: ReactNode) {
  return createElement(
    MantineProvider,
    null,
    createElement(SubAgentProvider, null, node),
  );
}

function SetupEvents({ chatId }: { chatId: string }) {
  const { processEvent } = useSubAgentActions();
  useLayoutEffect(() => {
    processEvent(chatId, {
      type: "start",
      id: "sa-1",
      source: "sub-agent",
      name: "Content Extraction",
      toolName: "extract_page_content",
      parentMessageId: "msg-1",
      displayTarget: { type: "toolCall", toolCallId: "tc-1" },
    });
    processEvent(chatId, {
      type: "text-delta",
      id: "sa-1",
      delta: "Hello streaming world",
    });
  }, [chatId, processEvent]);
  return null;
}

function EventController({
  onReady,
}: {
  onReady: (processEvent: (chatId: string, event: SubAgentEvent) => void) => void;
}) {
  const { processEvent } = useSubAgentActions();
  useLayoutEffect(() => {
    onReady(processEvent);
  }, [onReady, processEvent]);
  return null;
}

describe("ToolFallback", () => {
  it("does not stringify collapsed tool details during initial render", () => {
    const result = {
      toJSON() {
        throw new Error("Tool result should not be formatted while collapsed.");
      },
    };

    const html = renderToStaticMarkup(
      wrap(
        createElement(ToolFallback, {
          toolName: "extract_page_content",
          status: "complete",
          args: { url: "https://example.com/large-page" },
          result,
        }),
      ),
    );

    expect(html).toContain("extract_page_content");
    expect(html).toContain("done");
  });

  it("does not re-render collapsed tool cards for subagent text deltas", () => {
    vi.useFakeTimers();
    let processEvent:
      | ((chatId: string, event: SubAgentEvent) => void)
      | undefined;
    let renderCount = 0;

    function CountingToolFallback() {
      renderCount += 1;
      return createElement(ToolFallback, {
        toolName: "extract_page_content",
        args: { url: "https://example.com" },
        chatId: "test-chat",
        toolCallId: "tc-collapsed",
        status: "running",
      });
    }

    try {
      render(
        createElement(
          MantineProvider,
          null,
          createElement(
            SubAgentProvider,
            null,
            createElement(EventController, {
              onReady: (handler) => {
                processEvent = handler;
              },
            }),
            createElement(CountingToolFallback),
          ),
        ),
      );

      expect(processEvent).toBeDefined();
      expect(renderCount).toBe(1);

      act(() => {
        processEvent!("test-chat", {
          type: "start",
          id: "sa-collapsed",
          source: "sub-agent",
          name: "Content Extraction",
          toolName: "extract_page_content",
          parentMessageId: "msg-1",
          displayTarget: { type: "toolCall", toolCallId: "tc-collapsed" },
        });
        processEvent!("test-chat", {
          type: "text-delta",
          id: "sa-collapsed",
          delta: "Hidden progress",
        });
        vi.advanceTimersByTime(150);
      });

      expect(renderCount).toBe(1);
      expect(screen.queryByText("Hidden progress")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders subagent transcript inline when toolCallId matches a run with streaming output", () => {
    vi.useFakeTimers();
    try {
      render(
        createElement(
          MantineProvider,
          null,
          createElement(
            SubAgentProvider,
            null,
            createElement(SetupEvents, { chatId: "test-chat" }),
            createElement(ToolFallback, {
              toolName: "extract_page_content",
              args: { url: "https://example.com" },
              chatId: "test-chat",
              toolCallId: "tc-1",
              status: "complete",
            }),
          ),
        ),
      );

      // Flush pending text deltas
      act(() => {
        vi.advanceTimersByTime(150);
      });

      // Open the tool call card
      fireEvent.click(screen.getByLabelText(/expand.*extract_page_content/i));

      // Assert the streaming text appears inline
      expect(screen.getByText("Hello streaming world")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates an expanded inline subagent transcript as later text deltas flush", () => {
    vi.useFakeTimers();
    let processEvent:
      | ((chatId: string, event: SubAgentEvent) => void)
      | undefined;

    try {
      render(
        createElement(
          MantineProvider,
          null,
          createElement(
            SubAgentProvider,
            null,
            createElement(EventController, {
              onReady: (handler) => {
                processEvent = handler;
              },
            }),
            createElement(ToolFallback, {
              toolName: "extract_page_content",
              args: { url: "https://example.com" },
              chatId: "test-chat",
              toolCallId: "tc-live",
              status: "running",
            }),
          ),
        ),
      );

      expect(processEvent).toBeDefined();

      act(() => {
        processEvent!("test-chat", {
          type: "start",
          id: "sa-live",
          source: "sub-agent",
          name: "Content Extraction",
          toolName: "extract_page_content",
          parentMessageId: "msg-1",
          displayTarget: { type: "toolCall", toolCallId: "tc-live" },
        });
      });

      fireEvent.click(screen.getByLabelText(/expand.*extract_page_content/i));
      expect(screen.getByText("Waiting for sub-agent output...")).toBeInTheDocument();

      act(() => {
        processEvent!("test-chat", {
          type: "text-delta",
          id: "sa-live",
          delta: "First chunk",
        });
        vi.advanceTimersByTime(150);
      });

      expect(screen.getByText("First chunk")).toBeInTheDocument();

      act(() => {
        processEvent!("test-chat", {
          type: "text-delta",
          id: "sa-live",
          delta: "\nSecond chunk",
        });
        vi.advanceTimersByTime(150);
      });

      expect(screen.getByText(/Second chunk/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders inline subagent output as raw text while streaming and markdown after completion", () => {
    vi.useFakeTimers();
    let processEvent:
      | ((chatId: string, event: SubAgentEvent) => void)
      | undefined;

    try {
      const { container } = render(
        createElement(
          MantineProvider,
          null,
          createElement(
            SubAgentProvider,
            null,
            createElement(EventController, {
              onReady: (handler) => {
                processEvent = handler;
              },
            }),
            createElement(ToolFallback, {
              toolName: "create_research_plan",
              chatId: "test-chat",
              toolCallId: "tc-plan",
              status: "running",
            }),
          ),
        ),
      );

      expect(processEvent).toBeDefined();

      act(() => {
        processEvent!("test-chat", {
          type: "start",
          id: "sa-plan",
          source: "sub-agent",
          name: "Research Plan",
          toolName: "create_research_plan",
          parentMessageId: "msg-1",
          displayTarget: { type: "toolCall", toolCallId: "tc-plan" },
        });
        processEvent!("test-chat", {
          type: "text-delta",
          id: "sa-plan",
          delta: "# Heading\n\nSome **bold** text.",
        });
        vi.advanceTimersByTime(150);
      });

      fireEvent.click(screen.getByLabelText(/expand.*create_research_plan/i));

      const preDuringStreaming = container.querySelector("pre");
      expect(preDuringStreaming?.textContent).toContain("# Heading");
      expect(screen.queryByRole("heading", { name: "Heading" })).not.toBeInTheDocument();

      act(() => {
        processEvent!("test-chat", { type: "complete", id: "sa-plan" });
      });

      expect(container.querySelector("pre")).toBeNull();
      expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
