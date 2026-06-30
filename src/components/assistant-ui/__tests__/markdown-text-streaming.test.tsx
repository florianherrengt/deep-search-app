import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  markdownMocks.messagePart.text = "";
  markdownMocks.messagePart.status = { type: "complete" };
  markdownMocks.reactMarkdown.mockReset();
  markdownMocks.reactMarkdown.mockImplementation(
    ({ children }: { children?: string }) =>
      createElement("div", { "data-testid": "markdown-output" }, children),
  );
});

describe("MarkdownText streaming behavior", () => {
  it("renders running text without invoking ReactMarkdown", () => {
    markdownMocks.messagePart.text = "## Streaming\n\n- raw token";
    markdownMocks.messagePart.status = { type: "running" };

    const html = renderToStaticMarkup(createElement(MarkdownText));

    expect(markdownMocks.reactMarkdown).not.toHaveBeenCalled();
    expect(html).toContain("<pre");
    expect(html).toContain('data-status="running"');
    expect(html).toContain("## Streaming");
    expect(html).toContain("- raw token");
  });

  it("uses markdown rendering after the part completes", () => {
    markdownMocks.messagePart.text = SAMPLE_MARKDOWN;
    markdownMocks.messagePart.status = { type: "complete" };

    renderToStaticMarkup(createElement(MarkdownText));

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
