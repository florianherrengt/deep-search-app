// @vitest-environment jsdom
import { useLayoutEffect } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { SubAgentSidebar } from "@/components/sub-agent-sidebar";
import { SubAgentProvider, useSubAgentStore } from "@/lib/sub-agent-store";
import type { SubAgentRun } from "@/lib/sub-agent-types";

import "@testing-library/jest-dom/vitest";

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
  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }
  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
});

afterEach(() => {
  cleanup();
});

function StoreSetup({
  chatId,
  runs,
  selectRunId,
}: {
  chatId: string;
  runs: SubAgentRun[];
  selectRunId?: string;
}) {
  const { loadRuns, selectRun } = useSubAgentStore();
  useLayoutEffect(() => {
    loadRuns(chatId, runs);
    if (selectRunId) selectRun(selectRunId);
  }, [chatId, loadRuns, runs, selectRun, selectRunId]);
  return null;
}

function renderSidebar({
  chatId = "chat-1",
  runs,
  selectRunId,
}: {
  chatId?: string;
  runs?: SubAgentRun[];
  selectRunId?: string;
} = {}) {
  const onClose = vi.fn();
  const view = render(
    <MantineProvider>
      <SubAgentProvider>
        {runs && (
          <StoreSetup chatId={chatId} runs={runs} selectRunId={selectRunId} />
        )}
        <SubAgentSidebar chatId={chatId} onClose={onClose} />
      </SubAgentProvider>
    </MantineProvider>,
  );
  return { ...view, onClose };
}

const baseRun: SubAgentRun = {
  id: "run-1",
  chatId: "run-1",
  parentChatId: "chat-1",
  source: "sub-agent",
  name: "Research pricing",
  toolName: "retrieval_agent",
  status: "completed",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  text: "Here is the research output.",
  chunksReceived: 5,
  toolCalls: [],
  error: null,
  parentMessageId: "msg-1",
};

describe("SubAgentSidebar", () => {
  it("shows empty state when no run is selected", () => {
    renderSidebar({ runs: [] });
    expect(
      screen.getByText("No sub-agents for this conversation yet."),
    ).toBeInTheDocument();
  });

  it("shows empty state when only main-agent tool runs are loaded", () => {
    renderSidebar({
      runs: [
        {
          ...baseRun,
          id: "tool-run-1",
          chatId: "tool-run-1",
          source: undefined,
          name: "Brave Search",
          toolName: "brave_search",
          toolCalls: [
            {
              toolName: "brave_search",
              args: { query: "pricing" },
              result: { results: [] },
              status: "complete",
            },
          ],
        },
      ],
    });

    expect(screen.getByText("No sub-agents for this conversation yet.")).toBeInTheDocument();
    expect(screen.queryByText("Brave Search")).not.toBeInTheDocument();
  });

  it("shows run list items when runs are loaded", () => {
    renderSidebar({ runs: [baseRun] });
    expect(screen.getByText("Research pricing")).toBeInTheDocument();
  });

  it("shows detail panel with output text when a run is selected", () => {
    renderSidebar({ runs: [baseRun], selectRunId: "run-1" });
    expect(screen.getByText("Here is the research output.")).toBeInTheDocument();
  });

  it("shows error text in detail panel", () => {
    const errorRun: SubAgentRun = {
      ...baseRun,
      id: "run-err",
      chatId: "run-err",
      status: "failed",
      error: "Something went wrong",
      text: "",
    };
    renderSidebar({ runs: [errorRun], selectRunId: "run-err" });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows tool calls in detail panel", () => {
    const runWithTools: SubAgentRun = {
      ...baseRun,
      id: "run-tools",
      chatId: "run-tools",
      text: "",
      toolCalls: [
        {
          toolName: "web_search",
          args: { query: "pricing data" },
          status: "complete",
        },
        {
          toolName: "extract_page_content",
          args: { url: "https://example.com" },
          result: "Extracted content here",
          status: "complete",
        },
      ],
    };
    renderSidebar({ runs: [runWithTools], selectRunId: "run-tools" });
    expect(screen.getByText(/Tool calls \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("web_search")).not.toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Tool calls/,
      }),
    );
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.getByText("extract_page_content")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand extract_page_content details",
      }),
    );
    expect(screen.getByText("Extracted content here")).toBeInTheDocument();
  });

  it("shows running streamed text inside an open sub-agent card", () => {
    const streamingRun: SubAgentRun = {
      ...baseRun,
      id: "run-live",
      chatId: "run-live",
      status: "streaming",
      chunksReceived: 2,
      finishedAt: null,
      text: "Streaming update 1",
    };
    const { rerender } = renderSidebar({ runs: [streamingRun] });
    expect(screen.getByText("Streaming update 1")).toBeInTheDocument();

    rerender(
      <MantineProvider>
        <SubAgentProvider>
          <StoreSetup
            chatId="chat-1"
            runs={[{ ...streamingRun, text: "Streaming update 1\nStreaming update 2", chunksReceived: 3 }]}
          />
          <SubAgentSidebar chatId="chat-1" onClose={vi.fn()} />
        </SubAgentProvider>
      </MantineProvider>,
    );

    expect(screen.getByText(/Streaming update 2/)).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const { onClose, container } = renderSidebar({ runs: [] });
    const closeBtn = container.querySelector(
      '[aria-label="Close subagent sidebar"]',
    );
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows streaming status indicator for streaming runs", () => {
    const streamingRun: SubAgentRun = {
      ...baseRun,
      id: "run-streaming",
      chatId: "run-streaming",
      status: "streaming",
      chunksReceived: 5,
      finishedAt: null,
      text: "Generating text...",
    };
    renderSidebar({ runs: [streamingRun] });
    expect(screen.getByText("Generating text...")).toBeInTheDocument();
    expect(screen.getByLabelText("streaming")).toBeInTheDocument();
  });

  it("preserves partial text when run fails after streaming", () => {
    const failedRun: SubAgentRun = {
      ...baseRun,
      id: "run-fail-stream",
      chatId: "run-fail-stream",
      status: "failed",
      chunksReceived: 3,
      text: "Partial streamed text that was saved",
      error: "Connection lost",
    };
    renderSidebar({ runs: [failedRun], selectRunId: "run-fail-stream" });
    expect(screen.getByText("Partial streamed text that was saved")).toBeInTheDocument();
    expect(screen.getByText("Connection lost")).toBeInTheDocument();
  });

  it("allows collapsing the currently selected run", () => {
    const completedRun: SubAgentRun = {
      ...baseRun,
      id: "run-collapse",
      chatId: "run-collapse",
      status: "completed",
    };
    renderSidebar({ runs: [completedRun] });

    const runBtn = screen.getAllByRole("button").find((b) =>
      b.textContent?.includes("Research pricing"),
    );
    expect(runBtn).toBeDefined();
    fireEvent.click(runBtn!);

    expect(screen.getByText("Here is the research output.")).toBeVisible();

    fireEvent.click(runBtn!);

    expect(screen.getByText("Here is the research output.")).not.toBeVisible();
  });

  it("shows 'No output produced' for completed runs with no text", () => {
    const noTextRun: SubAgentRun = {
      ...baseRun,
      id: "run-notext",
      chatId: "run-notext",
      status: "completed",
      text: "",
      toolCalls: [],
      error: null,
    };
    renderSidebar({ runs: [noTextRun], selectRunId: "run-notext" });
    expect(screen.getByText("No output produced.")).toBeInTheDocument();
  });

  it("resets open runs when chatId changes", () => {
    const streamingRun: SubAgentRun = {
      ...baseRun,
      id: "run-live",
      chatId: "run-live",
      status: "streaming",
      chunksReceived: 1,
      finishedAt: null,
      text: "Streaming text",
    };
    const { rerender } = renderSidebar({
      chatId: "chat-1",
      runs: [streamingRun],
    });

    expect(screen.getByText("Streaming text")).toBeInTheDocument();

    const chat2Run: SubAgentRun = {
      ...baseRun,
      id: "run-chat2",
      chatId: "run-chat2",
      parentChatId: "chat-2",
      status: "completed",
      text: "Chat 2 output",
    };
    rerender(
      <MantineProvider>
        <SubAgentProvider>
          <StoreSetup chatId="chat-2" runs={[chat2Run]} />
          <SubAgentSidebar chatId="chat-2" onClose={vi.fn()} />
        </SubAgentProvider>
      </MantineProvider>,
    );

    expect(screen.queryByText("Streaming text")).not.toBeInTheDocument();
    expect(screen.getByText("Chat 2 output")).toBeInTheDocument();
  });
});
