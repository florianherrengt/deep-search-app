import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";

function wrap(node: ReactNode) {
  return createElement(MantineProvider, null, node);
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
});
