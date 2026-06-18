import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import type { LanguageModelV3StreamPart, LanguageModelV3StreamResult } from "@ai-sdk/provider";

const resolveUnique = vi.hoisted(() => vi.fn());
const slugifyName = vi.hoisted(() => vi.fn());
const validateName = vi.hoisted(() => vi.fn());

vi.mock("@/lib/transport/research-folder", () => ({
  slugifyFolderName: slugifyName,
  resolveUniqueFolderName: resolveUnique,
  validateResearchFolderName: validateName,
}));

vi.mock("@/lib/sub-agent-emitter", () => ({
  emitSubAgentEvent: vi.fn(),
  setActiveSubAgentEmitter: vi.fn(),
}));

import {
  generateFolderSlug,
  generateFolderSlugWithReport,
  extractCandidate,
} from "@/lib/transport/folder-namer";
import { emitSubAgentEvent } from "@/lib/sub-agent-emitter";

const mockedEmit = vi.mocked(emitSubAgentEvent);

beforeEach(() => {
  vi.clearAllMocks();
  validateName.mockImplementation(defaultValidateName);
  slugifyName.mockImplementation((t: string) =>
    t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  );
});

function tokenUsage() {
  return {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 3, text: 3, reasoning: 0 },
  };
}

function textChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "text-1" },
    { type: "text-delta" as const, id: "text-1", delta: text },
    { type: "text-end" as const, id: "text-1" },
    {
      type: "finish" as const,
      finishReason: { unified: "stop", raw: "stop" },
      usage: tokenUsage(),
    },
  ];
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
    doStream: async (): Promise<LanguageModelV3StreamResult> => {
      const text = texts[call++] ?? texts[texts.length - 1];
      return {
        stream: simulateReadableStream({ chunks: textChunks(text) }),
      };
    },
  });
}

function defaultValidateName(name: string): string | null {
  if (!name.trim()) return "must not be empty";
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return "must be lowercase kebab-case (letters, numbers, hyphens only)";
  }
  if (name.length < 2) return "too short (min 2 characters)";
  if (name.split("-").length > 8) return "too many words (max 8)";
  if (/^\d{4}-\d{2}-\d{2}$/.test(name)) {
    return "must describe the research topic, not just a timestamp";
  }
  return null;
}

describe("extractCandidate", () => {
  it("returns plain kebab-case input unchanged", () => {
    expect(extractCandidate("acme-earnings-calls")).toBe("acme-earnings-calls");
  });

  it("strips surrounding double quotes", () => {
    expect(extractCandidate('"acme-earnings"')).toBe("acme-earnings");
  });

  it("strips surrounding single quotes", () => {
    expect(extractCandidate("'acme-earnings'")).toBe("acme-earnings");
  });

  it("strips surrounding backticks", () => {
    expect(extractCandidate("`acme-earnings`")).toBe("acme-earnings");
  });

  it("strips markdown code fences without language", () => {
    expect(extractCandidate("```\nacme-earnings\n```")).toBe("acme-earnings");
  });

  it("strips markdown code fences with language", () => {
    expect(extractCandidate("```json\nacme-earnings\n```")).toBe("acme-earnings");
  });

  it("extracts folderName from JSON object", () => {
    expect(extractCandidate('{"folderName": "acme-earnings"}')).toBe("acme-earnings");
  });

  it("extracts name from JSON object", () => {
    expect(extractCandidate('{"name": "acme-earnings"}')).toBe("acme-earnings");
  });

  it("extracts title from JSON object", () => {
    expect(extractCandidate('{"title": "acme-earnings"}')).toBe("acme-earnings");
  });

  it("extracts folder_name from JSON object with underscore key", () => {
    expect(extractCandidate('{"folder_name": "acme-earnings"}')).toBe("acme-earnings");
  });

  it("extracts value from JSON string", () => {
    expect(extractCandidate('"acme-earnings"')).toBe("acme-earnings");
  });

  it("returns empty string for empty input", () => {
    expect(extractCandidate("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(extractCandidate("   ")).toBe("");
  });

  it("extracts kebab-case line from multi-line output", () => {
    expect(extractCandidate("The folder name is:\nacme-earnings\nThank you.")).toBe("acme-earnings");
  });

  it("returns full text when no single kebab-case line is found", () => {
    expect(extractCandidate("best compact vans under 2m")).toBe("best compact vans under 2m");
  });

  it("strips code fence then extracts JSON", () => {
    const input = "```json\n{\"folderName\": \"best-compact-vans\"}\n```";
    expect(extractCandidate(input)).toBe("best-compact-vans");
  });
});

describe("generateFolderSlug", () => {
  it("returns a slugified folder name from the model response", async () => {
    slugifyName.mockReturnValue("acme-earnings-calls");
    resolveUnique.mockResolvedValueOnce("acme-earnings-calls");
    const model = modelReturning("acme earnings calls");
    const name = await generateFolderSlug(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings-calls");
  });

  it("resolves collisions via resolveUniqueFolderName", async () => {
    slugifyName.mockReturnValue("acme-earnings");
    resolveUnique.mockResolvedValueOnce("acme-earnings-2026-06-09");
    const model = modelReturning("acme-earnings");
    const name = await generateFolderSlug(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings-2026-06-09");
  });

  it("retries when the model returns explanatory text", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    resolveUnique.mockResolvedValueOnce("acme-earnings");
    const model = modelReturning(
      "The folder should be named acme-earnings",
      "acme-earnings",
    );
    const name = await generateFolderSlug(model, "Find earnings calls for ACME?");
    expect(name).toBe("acme-earnings");
  });

  it("throws when all model attempts fail validation", async () => {
    slugifyName.mockImplementation((t: string) =>
      t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    );
    let callCount = 0;
    validateName.mockImplementation((name: string) => {
      callCount++;
      if (callCount <= MAX_ATTEMPTS) return "must be lowercase kebab-case";
      return defaultValidateName(name);
    });
    resolveUnique.mockImplementation(async (c: string) => c);
    const model = modelReturning(
      "The folder should be named acme-earnings-research because it is about ACME",
    );

    await expect(
      generateFolderSlug(model, "Find best compact vans under 2m")
    ).rejects.toThrow("Research could not start");
  });

  it("throws when all model attempts fail and no fallback exists", async () => {
    slugifyName.mockImplementation((t: string) =>
      t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    );
    let callCount = 0;
    validateName.mockImplementation((name: string) => {
      callCount++;
      if (callCount <= MAX_ATTEMPTS) return "must be lowercase kebab-case";
      return defaultValidateName(name);
    });
    resolveUnique.mockImplementation(async (c: string) => c);

    await expect(
      generateFolderSlug(modelReturning("bad output"), "Find best compact vans")
    ).rejects.toThrow("Research could not start");
  });

  it("throws when title slugifies to empty and model fails", async () => {
    slugifyName.mockImplementation((t: string) => {
      if (t === "北京" || t === "") return "";
      return t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    });
    validateName.mockImplementation(defaultValidateName);
    resolveUnique.mockImplementation(async (c: string) => c);

    await expect(
      generateFolderSlug(modelReturning(""), "北京"),
    ).rejects.toThrow("Research could not start");
  });
});

describe("generateFolderSlug validation", () => {
  it("rejects a single-character slug (too short) and retries", async () => {
    slugifyName.mockReturnValueOnce("c").mockReturnValueOnce("my-research");
    resolveUnique.mockResolvedValueOnce("my-research");
    const model = modelReturning("c++", "my-research");
    const name = await generateFolderSlug(model, "Tell me about C++");
    expect(name).toBe("my-research");
  });

  it("rejects a name with more than 8 words and retries", async () => {
    slugifyName
      .mockReturnValueOnce("acme-market-map-2026-q1-earnings-report-analysis-extra")
      .mockReturnValueOnce("acme-market");
    resolveUnique.mockResolvedValueOnce("acme-market");
    const model = modelReturning(
      "acme-market-map-2026-q1-earnings-report-analysis-extra",
      "acme-market",
    );
    const name = await generateFolderSlug(model, "ACME market map");
    expect(name).toBe("acme-market");
  });

  it("accepts a valid 8-word slug", async () => {
    slugifyName.mockReturnValue("acme-market-map-q1-earnings-report-analysis");
    resolveUnique.mockResolvedValueOnce("acme-market-map-q1-earnings-report-analysis");
    const model = modelReturning("acme-market-map-q1-earnings-report-analysis");
    const name = await generateFolderSlug(model, "ACME Q1 earnings report analysis");
    expect(name).toBe("acme-market-map-q1-earnings-report-analysis");
  });

  it("accepts a 2-character slug", async () => {
    slugifyName.mockReturnValue("ai");
    resolveUnique.mockResolvedValueOnce("ai");
    const model = modelReturning("ai");
    const name = await generateFolderSlug(model, "Tell me about AI");
    expect(name).toBe("ai");
  });

  it("accepts a numeric slug with at least 2 chars", async () => {
    slugifyName.mockReturnValue("2026");
    resolveUnique.mockResolvedValueOnce("2026");
    const model = modelReturning("2026");
    const name = await generateFolderSlug(model, "Year 2026 outlook");
    expect(name).toBe("2026");
  });

  it("treats timestamp-only generated names as rejected and throws after all attempts fail", async () => {
    slugifyName.mockImplementation((t: string) =>
      t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    );
    let callCount = 0;
    validateName.mockImplementation((name: string) => {
      callCount++;
      if (callCount <= MAX_ATTEMPTS) return "must describe the research topic, not just a timestamp";
      return defaultValidateName(name);
    });
    resolveUnique.mockImplementation(async (c: string) => c);

    const model = modelReturning("2026-06-11");
    await expect(
      generateFolderSlug(model, "Research ACME"),
    ).rejects.toThrow("Research could not start");
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
    const name = await generateFolderSlug(model, "research");
    expect(name).toBe("valid-name");
  });
});

describe("generateFolderSlug sub-agent events", () => {
  it("emits start, text-delta, and complete on success", async () => {
    slugifyName.mockReturnValue("acme-research");
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning("acme-research");

    await generateFolderSlug(model, "Research ACME");

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

  it("emits report event on success", async () => {
    slugifyName.mockReturnValue("acme-research");
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning("acme-research");

    await generateFolderSlug(model, "Research ACME");

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    const reportEvent = calls.find((e) => e.type === "report");
    expect(reportEvent).toBeTruthy();
    expect(reportEvent?.report).toEqual(
      expect.objectContaining({
        name: "Folder Naming",
        status: "success",
        finalAcceptedValue: "acme-research",
      }),
    );
    expect(reportEvent?.report.attempts).toHaveLength(1);
    expect(reportEvent?.report.attempts[0].accepted).toBe(true);
  });

  it("emits text-delta with raw LLM output, not the slugified version", async () => {
    slugifyName.mockReturnValue("acme-research");
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning("Acme Research");

    await generateFolderSlug(model, "Research ACME");

    const deltaEvents = mockedEmit.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === "text-delta");
    expect(deltaEvents[0].delta).toBe("Acme Research");
  });

  it("emits text-delta for each retry attempt", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning(
      "The folder name should be about acme research analysis",
      "acme-research",
    );

    await generateFolderSlug(model, "Research ACME");

    const deltaEvents = mockedEmit.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === "text-delta");
    expect(deltaEvents).toHaveLength(2);
    expect(deltaEvents[0].delta).toBe("The folder name should be about acme research analysis");
    expect(deltaEvents[1].delta).toBe("acme-research");
  });

  it("emits start and error events on total failure", async () => {
    slugifyName.mockReturnValue("");
    validateName.mockReturnValue("must not be empty");
    const model = modelReturning("");

    await expect(
      generateFolderSlug(model, ""),
    ).rejects.toThrow();

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    expect(calls.find((e) => e.type === "start")).toBeTruthy();
    expect(calls.find((e) => e.type === "error")).toEqual(
      expect.objectContaining({
        type: "error",
        error: expect.stringContaining("Failed to generate a valid folder name"),
      }),
    );
    expect(calls.find((e) => e.type === "complete")).toBeUndefined();
  });

  it("emits report event on failure with detailed attempts", async () => {
    slugifyName.mockImplementation((t: string) =>
      t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    );
    let callCount = 0;
    validateName.mockImplementation((name: string) => {
      callCount++;
      if (callCount <= MAX_ATTEMPTS) return "must not be empty";
      return defaultValidateName(name);
    });
    resolveUnique.mockImplementation(async (c: string) => c);

    await expect(
      generateFolderSlug(modelReturning("", "", ""), "北京"),
    ).rejects.toThrow();

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    const reportEvent = calls.find((e) => e.type === "report");
    expect(reportEvent).toBeTruthy();
    expect(reportEvent?.report.status).toBe("rejected");
    expect(reportEvent?.report.attempts.length).toBe(MAX_ATTEMPTS);
  });

  it("uses the same sub-agent id across all events", async () => {
    slugifyName.mockReturnValue("test-folder");
    resolveUnique.mockResolvedValueOnce("test-folder");
    const model = modelReturning("test-folder");

    await generateFolderSlug(model, "Test");

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    const ids = calls.map((e) => e.id);
    const uniqueIds = [...new Set(ids)];
    expect(uniqueIds).toHaveLength(1);
  });
});

describe("generateFolderSlug retry prompts", () => {
  it("sends the title as prompt on first attempt", async () => {
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
      doStream: async ({ prompt }) => {
        capturedPrompt = prompt;
        return {
          stream: simulateReadableStream({ chunks: textChunks("test") }),
        };
      },
    });

    await generateFolderSlug(model, "What is quantum computing?");

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
            content: [{ type: "text", text: "The answer is about quantum computing basics and applications" }],
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
      doStream: async ({ prompt }) => {
        prompts.push(JSON.stringify(prompt));
        call++;
        if (call === 1) {
          return {
            stream: simulateReadableStream({ chunks: textChunks("The answer is about quantum computing basics and applications") }),
          };
        }
        return {
          stream: simulateReadableStream({ chunks: textChunks("quantum-computing") }),
        };
      },
    });

    await generateFolderSlug(model, "What is quantum computing?");

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("What is quantum computing?");
    expect(prompts[1]).toContain("The answer is about quantum computing basics and applications");
    expect(prompts[1]).toContain("rejected");
  });
});

describe("generateFolderSlug abort", () => {
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
      doStream: async ({ abortSignal }) => {
        capturedSignal = abortSignal ?? undefined;
        return {
          stream: simulateReadableStream({ chunks: textChunks("test") }),
        };
      },
    });

    const controller = new AbortController();
    await generateFolderSlug(model, "test", { abortSignal: controller.signal });

    expect(capturedSignal).toBe(controller.signal);
  });

  it("emits both report and cancelled events on abort", async () => {
    const controller = new AbortController();
    controller.abort();

    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("aborted");
      },
      doStream: async () => {
        throw new Error("aborted");
      },
    });

    await expect(
      generateFolderSlug(model, "test", { abortSignal: controller.signal }),
    ).rejects.toThrow();

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    const reportEvent = calls.find((e) => e.type === "report");
    const cancelledEvent = calls.find((e) => e.type === "cancelled");

    expect(reportEvent).toBeTruthy();
    expect(reportEvent).toEqual(
      expect.objectContaining({
        type: "report",
        report: expect.objectContaining({
          status: "cancelled",
          errorMessage: "Folder naming was cancelled.",
        }),
      }),
    );
    expect(cancelledEvent).toBeTruthy();
    expect(cancelledEvent?.type).toBe("cancelled");
  });

  it("abort cancelled event sets sub-agent status to cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("aborted");
      },
      doStream: async () => {
        throw new Error("aborted");
      },
    });

    await expect(
      generateFolderSlug(model, "test", { abortSignal: controller.signal }),
    ).rejects.toThrow();

    const calls = mockedEmit.mock.calls.map((c) => c[0]);
    const startEvent = calls.find((e) => e.type === "start");
    const cancelledEvent = calls.find((e) => e.type === "cancelled");

    expect(startEvent?.id).toBeTruthy();
    expect(cancelledEvent?.id).toBe(startEvent?.id);
    expect(cancelledEvent?.type).toBe("cancelled");
  });

  it("treats LLM generation errors as fatal", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("provider unavailable");
      },
      doStream: async () => {
        throw new Error("provider unavailable");
      },
    });

    await expect(
      generateFolderSlug(model, "Research ACME"),
    ).rejects.toThrow("Research could not start because the research folder name could not be generated");

    expect(resolveUnique).not.toHaveBeenCalled();
    expect(mockedEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        error: expect.stringContaining("research folder name could not be generated"),
      }),
    );
  });
});

describe("generateFolderSlugWithReport", () => {
  it("returns both folder name and report on success", async () => {
    slugifyName.mockReturnValue("acme-research");
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning("acme-research");

    const result = await generateFolderSlugWithReport(model, "Research ACME");

    expect(result.folderName).toBe("acme-research");
    expect(result.report).toEqual(
      expect.objectContaining({
        name: "Folder Naming",
        status: "success",
        finalAcceptedValue: "acme-research",
      }),
    );
    expect(result.report.attempts).toHaveLength(1);
    expect(result.report.attempts[0].accepted).toBe(true);
    expect(result.report.attempts[0].rawOutputPreview).toBe("acme-research");
  });

  it("report contains detailed attempt info on retries", async () => {
    slugifyName.mockImplementation((t) => t.trim().replace(/\s+/g, "-").toLowerCase());
    resolveUnique.mockResolvedValueOnce("acme-research");
    const model = modelReturning(
      "The folder name should be about acme research analysis",
      "acme-research",
    );

    const result = await generateFolderSlugWithReport(model, "Research ACME");

    expect(result.report.attempts).toHaveLength(2);
    expect(result.report.attempts[0].accepted).toBe(false);
    expect(result.report.attempts[0].rejectedReasonCode).toBeTruthy();
    expect(result.report.attempts[0].rawOutputPreview).toBeTruthy();
    expect(result.report.attempts[1].accepted).toBe(true);
  });

  it("report shows all failed attempts after model failures", async () => {
    slugifyName.mockImplementation((t: string) =>
      t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    );
    let callCount = 0;
    validateName.mockImplementation((name: string) => {
      callCount++;
      if (callCount <= MAX_ATTEMPTS) return "must be lowercase kebab-case";
      return defaultValidateName(name);
    });
    resolveUnique.mockImplementation(async (c: string) => c);

    await expect(
      generateFolderSlugWithReport(
        modelReturning("invalid output here"),
        "Best compact vans",
      ),
    ).rejects.toThrow();

    const reportCall = mockedEmit.mock.calls.find((c) => c[0].type === "report");
    expect(reportCall).toBeDefined();
    const report = (reportCall![0] as any).report;
    expect(report.attempts.length).toBe(MAX_ATTEMPTS);
    expect(report.status).toBe("rejected");
  });

  it("error message reports model failure reason", async () => {
    let callCount = 0;
    validateName.mockImplementation((_name: string) => {
      callCount++;
      if (callCount <= MAX_ATTEMPTS) return "too short (min 2 characters)";
      return "too many words (max 8)"; // should never reach this since we throw before fallback
    });
    slugifyName.mockImplementation((t: string) =>
      t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    );
    resolveUnique.mockImplementation(async (c: string) => c);

    await expect(
      generateFolderSlugWithReport(
        modelReturning("a"),
        "Best compact vans in the whole entire world today",
      ),
    ).rejects.toThrow("Research could not start");

    const reportCall = mockedEmit.mock.calls.find((c) => c[0].type === "report");
    expect(reportCall).toBeDefined();
    const report = (reportCall![0] as any).report;
    expect(report.errorMessage).toContain("Failed to generate a valid folder name");
  });
});

const MAX_ATTEMPTS = 3;
