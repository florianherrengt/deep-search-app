// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useLayoutEffect, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, beforeAll, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { SubAgentProvider, useSubAgentActions } from "@/lib/sub-agent-store";

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
});
