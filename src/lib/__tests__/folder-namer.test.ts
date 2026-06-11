import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";

const resolveUnique = vi.hoisted(() => vi.fn());
const slugifyName = vi.hoisted(() => vi.fn());

vi.mock("@/lib/transport/research-folder", () => ({
  slugifyFolderName: slugifyName,
  resolveUniqueFolderName: resolveUnique,
}));

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: vi.fn(),
  setActiveSubAgentEmitter: vi.fn(),
}));

import { nameFolderFromMessage } from "@/lib/transport/folder-namer";
import { emitSubAgentEvent } from "@/lib/sub-agent-emitter";

const mockedEmit = vi.mocked(emitSubAgentEvent);

beforeEach(() => {
  vi.clearAllMocks();
});

function tokenUsage() {
  return {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 3, text: 3, reasoning: 0 },
  };
}

function modelReturning(...texts: string[]) {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: texts[call++] ?? texts[texts.length - 1] }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: tokenUsage(),
      warnings: [],
    }),
  });
}

describe("nameFolderFromMessage", () => {
  it("returns a slugified folder name from the model response", async () => {
    slugifyName.mockReturnValue("acme-earnings-calls");
    resolveUnique.mockResolvedValueOnce("acme-earnings-calls");
    const model = modelReturning("acme earnings calls");
    const name = await nameFolderFromMessage(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings-calls");
  });

  it("resolves collisions via resolveUniqueFolderName", async () => {
    slugifyName.mockReturnValue("acme-earnings");
    resolveUnique.mockResolvedValueOnce("acme-earnings-2026-06-09");
    const model = modelReturning("acme-earnings");
    const name = await nameFolderFromMessage(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings-2026-06-09");
  });

  it("retries when the model returns explanatory text", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    resolveUnique.mockResolvedValueOnce("acme-earnings");
    const model = modelReturning(
      "The folder should be named acme-earnings",
      "acme-earnings",
    );
    const name = await nameFolderFromMessage(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings");
  });

  it("throws after max retries with invalid names", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    const model = modelReturning(
      "The folder should be named acme-earnings-research because it is about ACME",
    );
    await expect(
      nameFolderFromMessage(model, "Find earnings calls for ACME?"),
    ).rejects.toThrow("Failed to generate a valid folder name");
  });
});

describe("nameFolderFromMessage validation", () => {
  it("rejects a single-character slug (too short) and retries", async () => {
    slugifyName.mockReturnValueOnce("c").mockReturnValueOnce("my-research");
    resolveUnique.mockResolvedValueOnce("my-research");
    const model = modelReturning("c++", "my-research");
    const name = await nameFolderFromMessage(model, "Tell me about C++");
    expect(name).toBe("my-research");
  });

  it("rejects a name with more than 5 words and retries", async () => {
    slugifyName
      .mockReturnValueOnce("acme-market-map-2026-q1-earnings-report")
      .mockReturnValueOnce("acme-market");
    resolveUnique.mockResolvedValueOnce("acme-market");
    const model = modelReturning(
      "acme-market-map-2026-q1-earnings-report",
      "acme-market",
    );
    const name = await nameFolderFromMessage(model, "ACME market map");
    expect(name).toBe("acme-market");
  });

  it("accepts a valid 5-word slug", async () => {
    slugifyName.mockReturnValue("acme-market-map-q1-report");
    resolveUnique.mockResolvedValueOnce("acme-market-map-q1-report");
    const model = modelReturning("acme-market-map-q1-report");
    const name = await nameFolderFromMessage(model, "ACME Q1 report");
    expect(name).toBe("acme-market-map-q1-report");
  });

  it("accepts a 2-character slug", async () => {
    slugifyName.mockReturnValue("ai");
    resolveUnique.mockResolvedValueOnce("ai");
    const model = modelReturning("ai");
    const name = await nameFolderFromMessage(model, "Tell me about AI");
    expect(name).toBe("ai");
  });

  it("accepts a numeric slug with at least 2 chars", async () => {
    slugifyName.mockReturnValue("2026");
    resolveUnique.mockResolvedValueOnce("2026");
    const model = modelReturning("2026");
    const name = await nameFolderFromMessage(model, "Year 2026 outlook");
    expect(name).toBe("2026");
  });

  it("accepts the fallback 'research' when LLM output slugifies to it", async () => {
    slugifyName.mockReturnValue("research");
    resolveUnique.mockResolvedValueOnce("research");
    const model = modelReturning("research");
    const name = await nameFolderFromMessage(model, "!!! invalid !!!");
    expect(name).toBe("research");
  });

  it("retries with different failure reasons on each attempt", async () => {
    slugifyName
      .mockReturnValueOnce("a")
      .mockReturnValueOnce("this-is-way-too-many-words-in-one-slug-name")
      .mockReturnValueOnce("valid-name");
    resolveUnique.mockResolvedValueOnce("valid-name");
    const model = modelReturning(
      "a",
      "this-is-way-too-many-words-in-one-slug-name",
      "valid-name",
    );
    const name = await nameFolderFromMessage(model, "research");
    expect(name).toBe("valid-name");
  });
});

describe("nameFolderFromMessage sub-agent events", () => {
  it("emits start, text-delta, and complete on success", async () => {
    slugifyName.mockReturnValue("acme-research");
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning("acme-research");

    await nameFolderFromMessage(model, "Research ACME");

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    const startEvent = calls.find((e) => e.type === "start");
    const deltaEvents = calls.filter((e) => e.type === "text-delta");
    const completeEvent = calls.find((e) => e.type === "complete");

    expect(startEvent).toEqual(
      expect.objectContaining({
        type: "start",
        name: "Folder Naming",
        toolName: "name_folder",
        parentMessageId: "transport",
      }),
    );
    expect(startEvent?.id).toBeTruthy();
    expect(deltaEvents.length).toBeGreaterThanOrEqual(1);
    expect(completeEvent).toEqual(
      expect.objectContaining({ type: "complete" }),
    );
  });

  it("emits text-delta with raw LLM output, not the slugified version", async () => {
    slugifyName.mockReturnValue("acme-research");
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning("Acme Research");

    await nameFolderFromMessage(model, "Research ACME");

    const deltaEvents = mockedEmit.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === "text-delta");
    expect(deltaEvents[0].delta).toBe("Acme Research");
  });

  it("emits text-delta for each retry attempt", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning(
      "The folder name should be about acme research",
      "acme-research",
    );

    await nameFolderFromMessage(model, "Research ACME");

    const deltaEvents = mockedEmit.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === "text-delta");
    expect(deltaEvents).toHaveLength(2);
    expect(deltaEvents[0].delta).toBe("The folder name should be about acme research");
    expect(deltaEvents[1].delta).toBe("acme-research");
  });

  it("emits start and error events on total failure", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    const model = modelReturning(
      "The folder should be named acme-earnings-research because it is about ACME",
    );

    await expect(
      nameFolderFromMessage(model, "ACME research"),
    ).rejects.toThrow();

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    expect(calls.find((e) => e.type === "start")).toBeTruthy();
    expect(calls.filter((e) => e.type === "text-delta")).toHaveLength(3);
    expect(calls.find((e) => e.type === "error")).toEqual(
      expect.objectContaining({
        type: "error",
        error: expect.stringContaining("Failed to generate a valid folder name"),
      }),
    );
    expect(calls.find((e) => e.type === "complete")).toBeUndefined();
  });

  it("uses the same sub-agent id across all events", async () => {
    slugifyName.mockReturnValue("test-folder");
    resolveUnique.mockResolvedValueOnce("test-folder");
    const model = modelReturning("test-folder");

    await nameFolderFromMessage(model, "Test");

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    const ids = calls.map((e) => e.id);
    const uniqueIds = [...new Set(ids)];
    expect(uniqueIds).toHaveLength(1);
  });
});

describe("nameFolderFromMessage retry prompts", () => {
  it("sends the user message as prompt on first attempt", async () => {
    slugifyName.mockReturnValue("test");
    resolveUnique.mockResolvedValueOnce("test");
    let capturedPrompt: unknown;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        capturedPrompt = prompt;
        return {
          content: [{ type: "text", text: "test" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: tokenUsage(),
          warnings: [],
        };
      },
    });

    await nameFolderFromMessage(model, "What is quantum computing?");

    expect(JSON.stringify(capturedPrompt)).toContain("What is quantum computing?");
  });

  it("sends a corrective prompt on retry with the rejected value", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    resolveUnique.mockResolvedValueOnce("quantum-computing");
    const prompts: string[] = [];
    let call = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ prompt }) => {
        prompts.push(JSON.stringify(prompt));
        call++;
        if (call === 1) {
          return {
            content: [{ type: "text", text: "The answer is quantum computing basics" }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: tokenUsage(),
            warnings: [],
          };
        }
        return {
          content: [{ type: "text", text: "quantum-computing" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: tokenUsage(),
          warnings: [],
        };
      },
    });

    await nameFolderFromMessage(model, "What is quantum computing?");

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("What is quantum computing?");
    expect(prompts[1]).toContain("quantum-computing-basics");
    expect(prompts[1]).toContain("rejected");
  });
});

describe("nameFolderFromMessage abort", () => {
  it("passes abort signal to the LLM call", async () => {
    slugifyName.mockReturnValue("test");
    resolveUnique.mockResolvedValueOnce("test");
    let capturedSignal: AbortSignal | undefined;
    const model = new MockLanguageModelV3({
      doGenerate: async ({ abortSignal }) => {
        capturedSignal = abortSignal ?? undefined;
        return {
          content: [{ type: "text", text: "test" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: tokenUsage(),
          warnings: [],
        };
      },
    });

    const controller = new AbortController();
    await nameFolderFromMessage(model, "test", { abortSignal: controller.signal });

    expect(capturedSignal).toBe(controller.signal);
  });
});
