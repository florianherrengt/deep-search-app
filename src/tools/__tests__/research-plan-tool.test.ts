import { beforeEach, describe, expect, it, vi } from "vitest";

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}));

const emitterMocks = vi.hoisted(() => ({
  emitSubAgentEvent: vi.fn(),
  createSubAgentId: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: aiMocks.streamText,
  };
});

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: emitterMocks.emitSubAgentEvent,
}));

vi.mock("@/lib/sub-agent-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sub-agent-types")>();
  return {
    ...actual,
    createSubAgentId: emitterMocks.createSubAgentId,
  };
});

import {
  researchPlanInputSchema,
  createResearchPlanTool,
} from "@/tools/research-plan-tool";
import { RESEARCH_PLANNER_SYSTEM } from "@/tools/research-plan-tool";

type ExecutablePlanTool = {
  execute: (input: { query: string }, options?: { abortSignal?: AbortSignal; toolCallId?: string; messages?: unknown[] }) => Promise<string>;
};

function makeModel() {
  return { modelId: "test", doGenerate: async () => ({}) } as never;
}

function mockStreamText(chunks: string[]) {
  const textResult = chunks.join("");
  return {
    textStream: (async function* () {
      for (const chunk of chunks) yield chunk;
    })(),
    text: Promise.resolve(textResult),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  emitterMocks.createSubAgentId.mockReturnValue("sa-test-1");
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

  it("calls streamText with correct parameters and returns streamed text", async () => {
    const model = makeModel();
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["Research ", "plan output"]));

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;
    const result = await t.execute({ query: "What is AI?" });

    expect(result).toBe("Research plan output");
    expect(aiMocks.streamText).toHaveBeenCalledWith({
      model,
      system: RESEARCH_PLANNER_SYSTEM,
      prompt: "What is AI?",
      abortSignal: undefined,
    });
  });

  it("emits sub-agent events during streaming", async () => {
    const model = makeModel();
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["chunk1", "chunk2"]));

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;
    await t.execute({ query: "test" });

    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start", id: "sa-test-1", toolName: "create_research_plan" }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", id: "sa-test-1", delta: "chunk1" }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", id: "sa-test-1", delta: "chunk2" }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete", id: "sa-test-1" }),
    );
  });

  it("propagates abort signal to streamText", async () => {
    const model = makeModel();
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["ok"]));

    const abortController = new AbortController();
    const t = createResearchPlanTool(model);
    await t.execute!(
      { query: "What is AI?" },
      { abortSignal: abortController.signal, toolCallId: "call-1", messages: [] },
    );

    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: abortController.signal,
      }),
    );
  });

  it("emits error event when model call fails", async () => {
    const model = makeModel();
    aiMocks.streamText.mockImplementationOnce(() => {
      throw new Error("Model API error");
    });

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;

    await expect(t.execute({ query: "What is AI?" })).rejects.toThrow(
      "Model API error",
    );

    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", id: "sa-test-1" }),
    );
  });
});
