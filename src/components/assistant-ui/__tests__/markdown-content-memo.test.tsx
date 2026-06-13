// @vitest-environment jsdom
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const mockReactMarkdown = vi.fn(({ children }: { children?: ReactNode }) => (
  <div data-testid="md-output">{children}</div>
));

vi.mock("react-markdown", () => ({
  default: mockReactMarkdown,
  __esModule: true,
}));

const { MarkdownContent } = await import(
  "@/components/assistant-ui/markdown-text"
);

const SAMPLE = "# Title\n\nSome **markdown** with a list:\n\n- one\n- two\n- three\n";

function Harness({ text }: { text: string }) {
  return <MarkdownContent text={text} />;
}

describe("MarkdownContent memoization", () => {
  it("does not re-invoke ReactMarkdown when text prop is unchanged", () => {
    mockReactMarkdown.mockClear();
    const { rerender } = render(<Harness text={SAMPLE} />);
    const baselineCalls = mockReactMarkdown.mock.calls.length;
    expect(baselineCalls).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 10; i += 1) {
      rerender(<Harness text={SAMPLE} />);
    }

    expect(mockReactMarkdown.mock.calls.length).toBe(baselineCalls);

    rerender(<Harness text={SAMPLE + "\n\nnew paragraph"} />);
    expect(mockReactMarkdown.mock.calls.length).toBeGreaterThan(baselineCalls);
  });
});
