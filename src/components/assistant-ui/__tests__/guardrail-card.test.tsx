import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuardrailCard } from "@/components/assistant-ui/guardrail-card";

describe("GuardrailCard", () => {
  it("renders retry events without exposing raw correction prompts", () => {
    const html = renderToStaticMarkup(
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
    );

    expect(html).toContain("Question tool enforced");
    expect(html).toContain("Prompted the agent");
    expect(html).toContain("Attempt 1");
    expect(html).not.toContain("Your previous response");
    expect(html).not.toContain("Convert that request");
  });

  it("renders warning events", () => {
    const html = renderToStaticMarkup(
      <GuardrailCard
        event={{
          kind: "research_checkpoint",
          status: "warning",
          title: "Guardrail retry limit reached",
          message:
            "The agent kept missing this guardrail, so the latest output is shown.",
        }}
      />,
    );

    expect(html).toContain("Guardrail retry limit reached");
    expect(html).toContain("latest output is shown");
  });

  it("renders nothing for invalid guardrail events", () => {
    const html = renderToStaticMarkup(
      <GuardrailCard event={{ status: "retrying" }} />,
    );

    expect(html).toBe("");
  });
});
