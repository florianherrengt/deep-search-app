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
  createResearchPlanTool,
  researchPlanInputSchema,
  RESEARCH_PLANNER_SYSTEM,
} from "@/tools/core-research-tools";

type ExecutablePlanTool = {
  execute: (
    input: { query: string },
    options?: { abortSignal?: AbortSignal; toolCallId?: string; messages?: unknown[] },
  ) => Promise<string>;
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
  it("uses the shared core planner prompt", () => {
    expect(RESEARCH_PLANNER_SYSTEM).toContain("decide");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("compare");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("verify");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Freshness");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Must-answer questions");
    expect(RESEARCH_PLANNER_SYSTEM).toContain("Stop conditions");
  });
});

describe("createResearchPlanTool", () => {
  it("has the core research-plan description", () => {
    const t = createResearchPlanTool(makeModel());
    expect(t.description).toContain("research plan");
  });

  it("uses the core planner prompt and returns streamed text", async () => {
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

  it("emits app sub-agent text streaming events around the core planner prompt", async () => {
    const model = makeModel();
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["plan", " chunk"]));

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;
    await t.execute({ query: "test" });

    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "start", id: "sa-test-1", toolName: "create_research_plan" }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", id: "sa-test-1", delta: "plan" }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", id: "sa-test-1", delta: " chunk" }),
    );
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "complete", id: "sa-test-1" }),
    );
  });

  it("targets the main-chat tool call when toolCallId is available", async () => {
    const model = makeModel();
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["chunk"]));

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;
    await t.execute(
      { query: "test" },
      { toolCallId: "plan-call-1", messages: [] },
    );

    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "start",
        id: "sa-test-1",
        displayTarget: { type: "toolCall", toolCallId: "plan-call-1" },
      }),
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

  it("emits error event when the core planner call fails", async () => {
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

  it("returns core empty-plan message and emits error", async () => {
    const model = makeModel();
    aiMocks.streamText.mockReturnValueOnce(mockStreamText(["   ", "  "]));

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;
    const result = await t.execute({ query: "What is AI?" });

    expect(result).toContain("empty");
    expect(emitterMocks.emitSubAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", id: "sa-test-1" }),
    );

    const completeCalls = emitterMocks.emitSubAgentEvent.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type?: string })?.type === "complete",
    );
    expect(completeCalls).toHaveLength(0);
  });

  it("emits a cancelled event when the abort signal fires", async () => {
    const model = makeModel();
    const abortError = new DOMException("aborted", "AbortError");
    aiMocks.streamText.mockImplementationOnce(() => {
      throw abortError;
    });

    const controller = new AbortController();
    controller.abort();

    const t = createResearchPlanTool(model) as unknown as ExecutablePlanTool;
    await expect(
      t.execute({ query: "What is AI?" }, { abortSignal: controller.signal }),
    ).rejects.toBe(abortError);

    const cancelledCalls = emitterMocks.emitSubAgentEvent.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type?: string })?.type === "cancelled",
    );
    expect(cancelledCalls).toHaveLength(1);
  });
});
