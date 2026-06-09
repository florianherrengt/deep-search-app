import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MantineProvider } from "@mantine/core";
import { GuardrailCard } from "@/components/assistant-ui/guardrail-card";

function wrap(node: React.ReactNode) {
  return <MantineProvider>{node}</MantineProvider>;
}

describe("GuardrailCard", () => {
  it("renders retry events without exposing raw correction prompts", () => {
    const html = renderToStaticMarkup(
      wrap(
        <GuardrailCard
          event={{
            kind: "question_tool",
            status: "retrying",
            title: "Question tool enforced",
            message: "Prompted the agent to ask this with the question tool.",
            reason:
              "Your previous response asked the user for input in plain text. Convert that request into an ask_questions tool call now.",
            attempt: 1,
          }}
        />,
      ),
    );

    expect(html).toContain("Question tool enforced");
    expect(html).toContain("Prompted the agent");
    expect(html).toContain("Attempt 1");
    expect(html).not.toContain("Your previous response");
    expect(html).not.toContain("Convert that request");
  });

  it("renders warning events", () => {
    const html = renderToStaticMarkup(
      wrap(
        <GuardrailCard
          event={{
            kind: "research_checkpoint",
            status: "warning",
            title: "Guardrail retry limit reached",
            message:
              "The agent kept missing this guardrail, so the latest output is shown.",
          }}
        />,
      ),
    );

    expect(html).toContain("Guardrail retry limit reached");
    expect(html).toContain("latest output is shown");
  });

  it("renders passed status events with green styling", () => {
    const html = renderToStaticMarkup(
      wrap(
        <GuardrailCard
          event={{
            kind: "research_checkpoint",
            status: "passed",
            title: "Research checkpoint passed",
            message: "The agent completed the research checkpoint.",
          }}
        />,
      ),
    );

    expect(html).toContain("Research checkpoint passed");
    expect(html).toContain("The agent completed the research checkpoint");
    expect(html).toContain('data-tone="success"');
  });

  it("renders tool_call_requirement events", () => {
    const html = renderToStaticMarkup(
      wrap(
        <GuardrailCard
          event={{
            kind: "tool_call_requirement",
            status: "retrying",
            title: "Tool prerequisite enforced",
            message: "Prompted the agent to call extract_page_content before create_file.",
            reason: "The agent tried to call create_file before required previous tool calls: extract_page_content.",
          }}
        />,
      ),
    );

    expect(html).toContain("Tool prerequisite enforced");
    expect(html).toContain("extract_page_content before create_file");
  });

  it("renders currency_conversion events", () => {
    const html = renderToStaticMarkup(
      wrap(
        <GuardrailCard
          event={{
            kind: "currency_conversion",
            status: "retrying",
            title: "Currency conversion enforced",
            message: "Convert $100 (USD) to EUR.",
            reason: "Foreign currency amounts found: $100 (USD). Target currency: EUR. Convert $100 (USD) to EUR.",
          }}
        />,
      ),
    );

    expect(html).toContain("Currency conversion enforced");
    expect(html).toContain("Convert $100 (USD) to EUR");
  });

  it("renders nothing for invalid guardrail events", () => {
    const html = renderToStaticMarkup(
      wrap(<GuardrailCard event={{ status: "retrying" }} />),
    );

    expect(html).not.toContain("Question tool enforced");
  });
});
