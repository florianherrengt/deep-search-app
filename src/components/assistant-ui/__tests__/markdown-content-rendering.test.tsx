import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "@/components/assistant-ui/markdown-text";

describe("MarkdownContent rendering", () => {
  it("preserves rich markdown elements after streaming completes", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        text:
          "Read the [docs](https://example.com), use `code`, and compare:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
      }),
    );

    expect(html).toContain("<a ");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("<code");
    expect(html).toContain("<table");
  });
});
