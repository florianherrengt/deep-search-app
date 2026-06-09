import { Fragment, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import {
  ReasoningContent,
  ReasoningRoot,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";

describe("Reasoning", () => {
  it("does not render thinking content while collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(ReasoningRoot, {
          defaultOpen: false,
          children: ({ open }) =>
            createElement(
              Fragment,
              null,
              createElement(ReasoningTrigger, { open }),
              createElement(
                ReasoningContent,
                { open },
                "Hidden reasoning text",
              ),
            ),
        }),
      ),
    );

    expect(html).toContain("Thinking");
    expect(html).not.toContain("Hidden reasoning text");
  });

  it("renders thinking content while open", () => {
    const html = renderToStaticMarkup(
      createElement(
        MantineProvider,
        null,
        createElement(ReasoningRoot, {
          defaultOpen: true,
          children: ({ open }) =>
            createElement(
              Fragment,
              null,
              createElement(ReasoningTrigger, { open }),
              createElement(
                ReasoningContent,
                { open },
                "Visible reasoning text",
              ),
            ),
        }),
      ),
    );

    expect(html).toContain("Thinking");
    expect(html).toContain("Visible reasoning text");
  });
});
