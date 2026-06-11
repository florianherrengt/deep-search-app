// @vitest-environment jsdom
import { useLayoutEffect, useRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

function StoreSetup({
  chatId,
  runs,
  selectRunId,
}: {
  chatId: string;
  runs: SubAgentRun[];
  selectRunId?: string;
}) {
  const store = useSubAgentStore();
  const done = useRef(false);
  useLayoutEffect(() => {
    if (done.current) return;
    done.current = true;
    store.loadRuns(chatId, runs);
    if (selectRunId) store.selectRun(selectRunId);
  });
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
  name: "Research pricing",
  toolName: "research",
  status: "complete",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  text: "Here is the research output.",
  toolCalls: [],
  error: null,
  parentMessageId: "msg-1",
};

describe("SubAgentSidebar", () => {
  it("shows empty state when no run is selected", () => {
    renderSidebar({ runs: [] });
    expect(
      screen.getByText("Select a subagent to view details"),
    ).toBeInTheDocument();
  });

  it("shows run list items when runs are loaded", () => {
    renderSidebar({ runs: [baseRun] });
    expect(screen.getByText("Research pricing")).toBeInTheDocument();
  });

  it("shows detail panel with output text when a run is selected", () => {
    renderSidebar({ runs: [baseRun], selectRunId: "run-1" });
    expect(screen.getByText("Here is the research output.")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
  });

  it("shows error text in detail panel", () => {
    const errorRun: SubAgentRun = {
      ...baseRun,
      id: "run-err",
      status: "error",
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
    expect(screen.getByText("Tool Calls")).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.getByText("extract_page_content")).toBeInTheDocument();
    expect(screen.getByText("Extracted content here")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const { onClose, container } = renderSidebar({ runs: [] });
    const closeBtn = container.querySelector(
      '[aria-label="Close subagent sidebar"]',
    );
    fireEvent.click(closeBtn!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
