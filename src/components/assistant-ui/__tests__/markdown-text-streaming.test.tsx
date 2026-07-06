// @vitest-environment jsdom
import { type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markdownMocks = vi.hoisted(() => ({
  messagePart: {
    text: "",
    status: { type: "complete" },
  },
  reactMarkdown: vi.fn(),
}));

vi.mock("react-markdown", () => ({
  default: markdownMocks.reactMarkdown,
  __esModule: true,
}));

vi.mock("@assistant-ui/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@assistant-ui/react")>();
  return {
    ...actual,
    useMessagePartText: () => markdownMocks.messagePart,
  };
});

const { MarkdownText } = await import("@/components/assistant-ui/markdown-text");

const SAMPLE_MARKDOWN =
  "## Finished\n\nRead the [docs](https://example.com), use `code`, and compare:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  markdownMocks.messagePart.text = "";
  markdownMocks.messagePart.status = { type: "complete" };
  markdownMocks.reactMarkdown.mockReset();
  markdownMocks.reactMarkdown.mockImplementation(
    ({ children }: { children?: ReactNode }) => (
      <div data-testid="markdown-output">{children}</div>
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MarkdownText streaming behavior", () => {
  it("renders nothing while running text is empty", () => {
    markdownMocks.messagePart.text = "";
    markdownMocks.messagePart.status = { type: "running" };

    const { container } = render(<MarkdownText />);

    expect(markdownMocks.reactMarkdown).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });

  it("renders the first non-empty running snapshot with markdown immediately", () => {
    markdownMocks.messagePart.text = "## Streaming\n\n- raw token";
    markdownMocks.messagePart.status = { type: "running" };

    render(<MarkdownText />);

    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(1);
    expect(getLatestMarkdownText()).toBe("## Streaming\n\n- raw token");
  });

  it("throttles running markdown updates to one-second snapshots", async () => {
    markdownMocks.messagePart.text = "## Streaming\n\n- first";
    markdownMocks.messagePart.status = { type: "running" };

    const { rerender } = render(<MarkdownText />);
    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(1);

    markdownMocks.messagePart.text = "## Streaming\n\n- second";
    rerender(<MarkdownText />);
    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(2);
    expect(getLatestMarkdownText()).toBe("## Streaming\n\n- second");
  });

  it("renders the final full text immediately when the part completes", () => {
    markdownMocks.messagePart.text = "## Streaming\n\n- first";
    markdownMocks.messagePart.status = { type: "running" };

    const { rerender } = render(<MarkdownText />);

    markdownMocks.messagePart.text = "## Streaming\n\n- pending";
    rerender(<MarkdownText />);
    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(1);

    markdownMocks.messagePart.text = SAMPLE_MARKDOWN;
    markdownMocks.messagePart.status = { type: "complete" };
    rerender(<MarkdownText />);

    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(2);
    expect(getLatestMarkdownText()).toBe(SAMPLE_MARKDOWN);
  });

  it("uses markdown components and GFM plugins after the part completes", () => {
    markdownMocks.messagePart.text = SAMPLE_MARKDOWN;
    markdownMocks.messagePart.status = { type: "complete" };

    render(<MarkdownText />);

    expect(markdownMocks.reactMarkdown).toHaveBeenCalledTimes(1);
    const props = markdownMocks.reactMarkdown.mock.calls[0]?.[0] as {
      children?: string;
      components?: Record<string, unknown>;
      remarkPlugins?: unknown[];
    };
    expect(props.children).toBe(SAMPLE_MARKDOWN);
    expect(props.components).toEqual(
      expect.objectContaining({
        a: expect.any(Object),
        code: expect.any(Object),
        pre: expect.any(Object),
      }),
    );
    expect(props.remarkPlugins?.length).toBeGreaterThan(0);
  });
});

function getLatestMarkdownText() {
  const latestCall =
    markdownMocks.reactMarkdown.mock.calls[
      markdownMocks.reactMarkdown.mock.calls.length - 1
    ];
  const props = latestCall?.[0] as {
    children?: string;
  };
  return props.children;
}
