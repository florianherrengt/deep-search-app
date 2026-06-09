import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import { GuardrailCard } from "@/components/assistant-ui/guardrail-card";

function wrap(node: ReactNode) {
  return createElement(MantineProvider, null, node);
}

describe("GuardrailCard styles", () => {
  it("marks retrying currency events with the info tone", () => {
    const html = renderToStaticMarkup(
      wrap(
        createElement(GuardrailCard, {
          event: {
            kind: "currency_conversion",
            status: "retrying",
            title: "Currency conversion enforced",
            message: "Prompted the agent to convert foreign currency amounts.",
          },
        }),
      ),
    );

    expect(html).toContain("Currency conversion enforced");
    expect(html).toContain("md-guardrail-card");
    expect(html).toContain('data-tone="info"');
  });
});
