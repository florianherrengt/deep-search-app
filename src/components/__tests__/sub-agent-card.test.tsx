// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { render, fireEvent, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MantineProvider } from "@mantine/core";
import { SubAgentCard } from "@/components/sub-agent-card";
import type { SubAgentRun } from "@/lib/sub-agent-types";

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

function wrap(node: React.ReactNode) {
  return <MantineProvider>{node}</MantineProvider>;
}

const baseRun: SubAgentRun = {
  id: "run-1",
  chatId: "run-1",
  parentChatId: "chat-1",
  name: "Test Run",
  toolName: "research",
  status: "running",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: null,
  text: "",
  toolCalls: [],
  error: null,
  parentMessageId: "msg-1",
};

describe("SubAgentCard", () => {
  it("renders the run name", () => {
    const html = renderToStaticMarkup(
      wrap(<SubAgentCard run={baseRun} onClick={vi.fn()} />),
    );
    expect(html).toContain("Test Run");
  });

  it("shows spinner for running status", () => {
    const html = renderToStaticMarkup(
      wrap(
        <SubAgentCard
          run={{ ...baseRun, status: "running" }}
          onClick={vi.fn()}
        />,
      ),
    );
    expect(html).toContain("spin 1s linear infinite");
  });

  it('shows "done" text for completed status', () => {
    const html = renderToStaticMarkup(
      wrap(
        <SubAgentCard
          run={{ ...baseRun, status: "completed" }}
          onClick={vi.fn()}
        />,
      ),
    );
    expect(html).toContain("done");
  });

  it('shows "error" text for failed status', () => {
    const html = renderToStaticMarkup(
      wrap(
        <SubAgentCard
          run={{ ...baseRun, status: "failed" }}
          onClick={vi.fn()}
        />,
      ),
    );
    expect(html).toContain("error");
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn();
    render(
      wrap(
        <SubAgentCard
          run={{ ...baseRun, name: "Inspect Me" }}
          onClick={onClick}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Inspect Inspect Me" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
