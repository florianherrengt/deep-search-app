import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: aiMocks.generateText,
  };
});

import {
  researchPlanInputSchema,
  createResearchPlanTool,
} from "@/tools/research-plan-tool";
import { RESEARCH_PLANNER_SYSTEM } from "@/tools/research-plan-tool";

type ExecutablePlanTool = {
  execute: (input: { query: string }) => Promise<string>;
};

function makeModel() {
  return { modelId: "test", doGenerate: async () => ({}) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("researchPlanInputSchema", () => {
  it("accepts a valid query", () => {
    const result = researchPlanInputSchema.safeParse({ query: "What is machine learning?" });
    expect(result.success).toBe(true);
  });

  it("rejects empty query", () => {
    const result = researchPlanInputSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing query", () => {
    const result = researchPlanInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("RESEARCH_PLANNER_SYSTEM", () => {
  it("contains goal classification guidance", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("decide");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("compare");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("verify");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("explain");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("find");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("troubleshoot");
  });

  it("contains freshness classification", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Freshness");
  });

  it("contains must-answer questions section", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Must-answer questions");
  });

  it("contains source priority section", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Source priority");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Primary");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Secondary");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Experiential");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Weak");
  });

  it("contains research passes", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Map the topic");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Primary evidence");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Independent evidence");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Synthesis");
  });

  it("contains confidence rules", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Confidence rules");
  });

  it("contains stop conditions", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Stop conditions");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("must-answer questions are answered");
  });
});

describe("createResearchPlanTool", () => {
  it("has the correct description", () => {
    const t = createResearchPlanTool(makeModel());
    expect(t.description).toContain("research plan");
  });

  it("calls generateText with correct parameters", async () => {
    const model = makeModel();
    aiMocks.generateText.mockResolvedValueOnce({
      text: "Research plan output",
    });

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;
    const result = await t.execute({ query: "What is AI?" });

    expect(result).toBe("Research plan output");
    expect(aiMocks.generateText).toHaveBeenCalledWith({
      model,
      system: RESEARCH_PLANNER_SYSTEM,
      prompt: "What is AI?",
      abortSignal: undefined,
    });
  });

  it("propagates abort signal to generateText", async () => {
    const model = makeModel();
    aiMocks.generateText.mockResolvedValueOnce({
      text: "Research plan output",
    });

    const abortController = new AbortController();
    const t = createResearchPlanTool(model);
    await t.execute!(
      { query: "What is AI?" },
      { abortSignal: abortController.signal, toolCallId: "call-1", messages: [] },
    );

    expect(aiMocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: abortController.signal,
      }),
    );
  });

  it("throws when model call fails", async () => {
    const model = makeModel();
    aiMocks.generateText.mockRejectedValueOnce(
      new Error("Model API error"),
    );

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;

    await expect(t.execute({ query: "What is AI?" })).rejects.toThrow(
      "Model API error",
    );
  });
});
