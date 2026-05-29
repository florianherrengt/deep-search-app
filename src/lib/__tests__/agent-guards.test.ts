import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  asksUserForInput,
  evaluateAssistantStep,
  reviewResearchCheckpoint,
} from "@/lib/agent-guards";

describe("asksUserForInput", () => {
  it("detects direct user-facing questions", () => {
    expect(asksUserForInput("Which repo should I use?")).toBe(true);
    expect(asksUserForInput("Can you share the URL?")).toBe(true);
    expect(asksUserForInput("What output format do you want?")).toBe(true);
    expect(asksUserForInput("May I proceed with the migration?")).toBe(true);
  });

  it("detects clarification phrases without question marks", () => {
    expect(asksUserForInput("Please confirm the repo before I continue.")).toBe(
      true,
    );
    expect(asksUserForInput("Let me know your preferred output format.")).toBe(
      true,
    );
    expect(asksUserForInput("Pick a colour and I'll find matching legs.")).toBe(
      true,
    );
  });

  it("ignores questions inside code blocks and quotes", () => {
    expect(
      asksUserForInput("```ts\nconst question = 'Which repo?';\n```"),
    ).toBe(false);
    expect(asksUserForInput("> Which repo should I use?")).toBe(false);
  });

  it("ignores rhetorical and summary question text", () => {
    expect(asksUserForInput("Why? Because the cache is stale.")).toBe(false);
    expect(asksUserForInput("The question is whether this scales.")).toBe(
      false,
    );
    expect(asksUserForInput("Open questions: auth, billing, deploys")).toBe(
      false,
    );
    expect(
      asksUserForInput("What happened in 2020? The company changed CEOs."),
    ).toBe(false);
  });

  it("ignores final-answer advice that does not ask for a reply", () => {
    expect(
      asksUserForInput(
        "Here are the direct links. Just pick the colour you like - they're all 120x70cm and pre-drilled.",
      ),
    ).toBe(false);
  });
});

describe("reviewResearchCheckpoint", () => {
  const validCheckpoint = {
    originalQuestion: "Find the current state of the market.",
    searchesRun: ["market report 2026", "vendor pricing 2026"],
    sourcesOpened: [
      { url: "https://example.com/report", sourceType: "primary" as const },
      { url: "https://example.com/pricing", sourceType: "secondary" as const },
    ],
    claimsVerified: ["Market size is up year over year", "Pricing changed"],
    unresolvedQuestions: [],
    confidence: "medium" as const,
    readyToAnswer: true,
  };

  it("rejects checkpoints with no searches or sources", async () => {
    await expect(
      reviewResearchCheckpoint({
        ...validCheckpoint,
        searchesRun: [],
        sourcesOpened: [],
      }),
    ).resolves.toMatchObject({
      approved: false,
      severity: "major",
    });
  });

  it("rejects checkpoints with too few sources", async () => {
    await expect(
      reviewResearchCheckpoint({
        ...validCheckpoint,
        sourcesOpened: validCheckpoint.sourcesOpened.slice(0, 1),
      }),
    ).resolves.toMatchObject({
      approved: false,
      visibleSummary: "Research checkpoint needs more sources.",
    });
  });

  it("rejects unresolved questions and low confidence", async () => {
    await expect(
      reviewResearchCheckpoint({
        ...validCheckpoint,
        unresolvedQuestions: ["Need official pricing confirmation"],
      }),
    ).resolves.toMatchObject({
      approved: false,
      visibleSummary: "Research checkpoint still has unresolved questions.",
    });

    await expect(
      reviewResearchCheckpoint({
        ...validCheckpoint,
        confidence: "low",
      }),
    ).resolves.toMatchObject({
      approved: false,
      visibleSummary: "Research checkpoint confidence is too low.",
    });
  });

  it("approves a balanced checkpoint", async () => {
    await expect(reviewResearchCheckpoint(validCheckpoint)).resolves.toMatchObject({
      approved: true,
      severity: "none",
    });
  });

  it("uses the judge after deterministic checks pass", async () => {
    await expect(
      reviewResearchCheckpoint(validCheckpoint, async () => ({
        approved: false,
        severity: "major",
        visibleSummary: "Research checkpoint is missing primary sources.",
        missingAngles: ["Primary source confirmation"],
        weakClaims: ["Pricing claim"],
        requiredNextActions: ["Open the vendor pricing page"],
      })),
    ).resolves.toMatchObject({
      approved: false,
      visibleSummary: "Research checkpoint is missing primary sources.",
      requiredNextActions: ["Open the vendor pricing page"],
    });
  });

  it("falls back to basic approval when the judge fails", async () => {
    await expect(
      reviewResearchCheckpoint(validCheckpoint, async () => {
        throw new Error("judge unavailable");
      }),
    ).resolves.toMatchObject({
      approved: true,
      severity: "minor",
      visibleSummary:
        "Research checkpoint passed basic checks; judge review was unavailable.",
    });
  });
});

describe("evaluateAssistantStep", () => {
  it("retries plain-text questions with the question tool", () => {
    const decision = evaluateAssistantStep({
      messages: [userMessage("Pick a color")],
      responseMessage: assistantMessage("Which color do you prefer?"),
    });

    expect(decision).toMatchObject({
      action: "retry",
      guard: "question_tool",
    });
  });

  it("accepts answers that already use ask_questions", () => {
    const decision = evaluateAssistantStep({
      messages: [userMessage("Pick a color")],
      responseMessage: assistantWithQuestionTool(),
    });

    expect(decision).toMatchObject({ action: "accept" });
  });

  it("retries tool calls that are missing required previous tool calls", () => {
    const decision = evaluateAssistantStep({
      messages: [userMessage("Research the market")],
      responseMessage: assistantWithResearchPlanTool(),
    });

    expect(decision).toMatchObject({
      action: "retry",
      guard: "tool_call_requirement",
      toolChoice: { type: "tool", toolName: "ask_questions" },
    });
  });

  it("accepts prerequisite-gated tools after the required tool was called", () => {
    const decision = evaluateAssistantStep({
      messages: [
        userMessage("Research the market"),
        assistantWithQuestionTool(),
      ],
      responseMessage: assistantWithResearchPlanTool(),
    });

    expect(decision).toMatchObject({ action: "accept" });
  });

  it("accepts non-research answers without checkpoint", () => {
    const decision = evaluateAssistantStep({
      messages: [userMessage("Thanks")],
      responseMessage: assistantMessage("You're welcome."),
    });

    expect(decision).toMatchObject({ action: "accept" });
  });

  it("retries shallow research answers", () => {
    const decision = evaluateAssistantStep({
      messages: [userMessage("Find the latest pricing for Acme Search")],
      responseMessage: assistantMessage("Acme Search costs about 10 pounds."),
    });

    expect(decision).toMatchObject({
      action: "retry",
      guard: "research_checkpoint",
    });
  });

  it("accepts a final answer after an approved checkpoint in the same turn", () => {
    const decision = evaluateAssistantStep({
      messages: [
        userMessage("Find the latest pricing for Acme Search"),
        approvedCheckpointMessage(),
      ],
      responseMessage: assistantMessage(
        "Acme Search currently lists pricing from the verified sources.",
      ),
    });

    expect(decision).toMatchObject({ action: "accept" });
  });

  it("lets assistant-ui continue after a tool-only retry", () => {
    const decision = evaluateAssistantStep({
      messages: [userMessage("Find the latest pricing for Acme Search")],
      responseMessage: assistantWithSearchTool(),
    });

    expect(decision).toMatchObject({ action: "accept" });
  });
});

function userMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantMessage(text: string): UIMessage {
  return {
    id: `assistant-${text}`,
    role: "assistant",
    parts: [{ type: "text", text }],
  };
}

function approvedCheckpointMessage(): UIMessage {
  return {
    id: "assistant-checkpoint",
    role: "assistant",
    parts: [
      {
        type: "tool-research_checkpoint",
        toolCallId: "checkpoint-1",
        state: "output-available",
        input: {
          originalQuestion: "Find the latest pricing for Acme Search",
          searchesRun: ["acme search pricing"],
          sourcesOpened: [
            { url: "https://example.com/pricing" },
            { url: "https://example.com/docs" },
          ],
          claimsVerified: ["Pricing page lists GBP", "Docs confirm plan name"],
          unresolvedQuestions: [],
          confidence: "high",
          readyToAnswer: true,
        },
        output: {
          approved: true,
          severity: "none",
          visibleSummary: "Research checkpoint passed.",
          missingAngles: [],
          weakClaims: [],
          requiredNextActions: [],
        },
      } as UIMessage["parts"][number],
    ],
  };
}

function assistantWithQuestionTool(): UIMessage {
  return {
    id: "assistant-question-tool",
    role: "assistant",
    parts: [
      {
        type: "tool-ask_questions",
        toolCallId: "question-1",
        state: "input-available",
        input: {
          questions: [
            {
              question: "Which color do you prefer?",
              candidates: [{ label: "Red", value: "red" }],
            },
          ],
        },
      } as UIMessage["parts"][number],
    ],
  };
}

function assistantWithResearchPlanTool(): UIMessage {
  return {
    id: "assistant-research-plan",
    role: "assistant",
    parts: [
      {
        type: "tool-create_research_plan",
        toolCallId: "plan-1",
        state: "input-available",
        input: {
          query: "Research the market",
        },
      } as UIMessage["parts"][number],
    ],
  };
}

function assistantWithSearchTool(): UIMessage {
  return {
    id: "assistant-search",
    role: "assistant",
    parts: [
      { type: "text", text: "Acme Search costs about 10 pounds." },
      {
        type: "tool-brave_search",
        toolCallId: "search-1",
        state: "output-available",
        input: { query: "acme search pricing" },
        output: {
          results: [
            {
              title: "Pricing",
              url: "https://example.com/pricing",
              description: "Pricing page",
            },
          ],
        },
      } as UIMessage["parts"][number],
    ],
  };
}
