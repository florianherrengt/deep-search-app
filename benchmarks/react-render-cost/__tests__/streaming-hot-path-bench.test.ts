import { describe, expect, it } from "vitest";

// Microbenchmark for hot-path React render allocations identified during the
// streaming-lag investigation. These isolate the per-token / per-chat costs
// so we can prove before/after wins without spinning up the full app.

function summarize(samples: number[]) {
  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p99 = samples[Math.floor(samples.length * 0.99)] ?? samples[samples.length - 1];
  return {
    meanUs: Number((mean * 1000).toFixed(2)),
    p99Us: Number((p99 * 1000).toFixed(2)),
  };
}

function run<T>(label: string, iter: number, fn: () => T): { label: string; result: T; samples: number[] } {
  const samples: number[] = [];
  // warmup
  for (let i = 0; i < Math.min(5, iter); i += 1) fn();
  let result: T | undefined;
  for (let i = 0; i < iter; i += 1) {
    const t = performance.now();
    result = fn();
    samples.push(performance.now() - t);
  }
  return { label, result: result as T, samples };
}

describe("streaming render-cost hotspots", { concurrent: false }, () => {
  it("measures intl format + getDuration + slugify per-call cost", () => {
    if (process.env.BENCH_RENDER_COST !== "1") return;

    const ITERATIONS = 5000;

    // === Intl.DateTimeFormat construction per call (current research-sidebar.tsx)
    function formatChatTimestampCurrent(value: string | null) {
      if (!value) return "Legacy chat";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Saved chat";
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    }

    // === Hoisted singleton (proposed fix)
    const SHARED_FORMATTER = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    function formatChatTimestampOptimized(value: string | null) {
      if (!value) return "Legacy chat";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Saved chat";
      return SHARED_FORMATTER.format(date);
    }

    const ts = "2026-06-21T10:30:00.000Z";

    const intlCurrent = run(
      "Intl.DateTimeFormat per call (current)",
      ITERATIONS,
      () => formatChatTimestampCurrent(ts),
    );
    const intlOptimized = run(
      "Shared Intl.DateTimeFormat (proposed)",
      ITERATIONS,
      () => formatChatTimestampOptimized(ts),
    );

    // === getDuration with new Date per call (current sub-agent-sidebar.tsx)
    interface SubAgentRun {
      startedAt: string;
      finishedAt: string | null;
    }
    function getDurationCurrent(run: SubAgentRun): string {
      if (!run.startedAt) return "";
      const start = new Date(run.startedAt).getTime();
      const end = run.finishedAt
        ? new Date(run.finishedAt).getTime()
        : Date.now();
      const ms = end - start;
      if (ms < 0) return "";
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
      return `${Math.floor(ms / 60_000)}m`;
    }

    // === Cached parse via Date.parse (proposed)
    function getDurationOptimized(run: SubAgentRun): string {
      if (!run.startedAt) return "";
      const start = Date.parse(run.startedAt);
      if (Number.isNaN(start)) return "";
      const end = run.finishedAt
        ? Date.parse(run.finishedAt)
        : Date.now();
      const ms = end - start;
      if (ms < 0) return "";
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
      return `${Math.floor(ms / 60_000)}m`;
    }

    const finishedRun: SubAgentRun = {
      startedAt: "2026-06-21T10:00:00.000Z",
      finishedAt: "2026-06-21T10:05:00.000Z",
    };
    const streamingRun: SubAgentRun = {
      startedAt: "2026-06-21T10:00:00.000Z",
      finishedAt: null,
    };

    const durCurrentFinished = run(
      "getDuration finished (current)",
      ITERATIONS,
      () => getDurationCurrent(finishedRun),
    );
    const durOptimizedFinished = run(
      "getDuration finished (proposed)",
      ITERATIONS,
      () => getDurationOptimized(finishedRun),
    );
    const durCurrentStreaming = run(
      "getDuration streaming (current)",
      ITERATIONS,
      () => getDurationCurrent(streamingRun),
    );
    const durOptimizedStreaming = run(
      "getDuration streaming (proposed)",
      ITERATIONS,
      () => getDurationOptimized(streamingRun),
    );

    const result = {
      iterations: ITERATIONS,
      intl: {
        current: summarize(intlCurrent.samples),
        optimized: summarize(intlOptimized.samples),
        speedup: Number(
          (summarize(intlCurrent.samples).meanUs /
            summarize(intlOptimized.samples).meanUs).toFixed(2),
        ),
      },
      getDurationFinished: {
        current: summarize(durCurrentFinished.samples),
        optimized: summarize(durOptimizedFinished.samples),
        speedup: Number(
          (summarize(durCurrentFinished.samples).meanUs /
            summarize(durOptimizedFinished.samples).meanUs).toFixed(2),
        ),
      },
      getDurationStreaming: {
        current: summarize(durCurrentStreaming.samples),
        optimized: summarize(durOptimizedStreaming.samples),
        speedup: Number(
          (summarize(durCurrentStreaming.samples).meanUs /
            summarize(durOptimizedStreaming.samples).meanUs).toFixed(2),
        ),
      },
    };

    // eslint-disable-next-line no-console
    console.log("\nRENDER_COST_BENCH_RESULT", JSON.stringify(result, null, 2));

    // Sanity assertions: same output
    expect(formatChatTimestampCurrent(ts)).toBe(formatChatTimestampOptimized(ts));
    expect(getDurationCurrent(finishedRun)).toBe(getDurationOptimized(finishedRun));
    expect(getDurationCurrent(streamingRun)).toBe(getDurationOptimized(streamingRun));

    // The optimized paths should be measurably faster.
    expect(result.intl.optimized.meanUs).toBeLessThan(result.intl.current.meanUs);
  });

  it("measures Zod safeParse cost for ask_questions tool args/result", async () => {
    if (process.env.BENCH_RENDER_COST !== "1") return;

    const { z } = await import("zod");
    const { questionsInputSchema } = await import("@/tools/questions-tool");

    const questionResultSchema = z.object({
      answers: z.array(
        z.object({
          question: z.string(),
          answer: z.string(),
          custom: z.boolean().optional(),
        }),
      ),
    });

    // Realistic args: 3 questions × 4 candidates each
    const args = {
      questions: [
        {
          question: "Which aspect of the market should we focus on?",
          candidates: [
            { label: "Market size", value: "size" },
            { label: "Competitors", value: "competitors" },
            { label: "Customer segments", value: "segments" },
            { label: "Pricing", value: "pricing" },
          ],
        },
        {
          question: "What time horizon for the forecast?",
          candidates: [
            { label: "1 year", value: "1y" },
            { label: "3 years", value: "3y" },
            { label: "5 years", value: "5y" },
          ],
        },
        {
          question: "Depth of analysis?",
          candidates: [
            { label: "Brief", value: "brief" },
            { label: "Detailed", value: "detailed" },
          ],
        },
      ],
    };

    const result = {
      answers: [
        { question: "Which aspect?", answer: "Market size" },
        { question: "Horizon?", answer: "3 years" },
      ],
    };

    const ITERATIONS = 2000;

    // Current: 4 safeParse per render (predicate + component)
    const current = run("4 safeParse per token (current)", ITERATIONS, () => {
      questionsInputSchema.safeParse(args);
      questionResultSchema.safeParse(result);
      questionsInputSchema.safeParse(args); // predicate duplicates
      questionResultSchema.safeParse(result);
      return null;
    });

    // Proposed: 0 safeParse after first parse (memoized)
    // Simulated cost: just returning cached booleans
    const cached = run("memoized (proposed, cache hit)", ITERATIONS, () => {
      return null;
    });

    const parsed = {
      iterations: ITERATIONS,
      fourSafeParsesPerToken: summarize(current.samples),
      memoizedCacheHit: summarize(cached.samples),
      speedup: Number(
        (summarize(current.samples).meanUs /
          summarize(cached.samples).meanUs).toFixed(2),
      ),
    };

    // eslint-disable-next-line no-console
    console.log("\nZOD_SAFEPARSE_BENCH_RESULT", JSON.stringify(parsed, null, 2));

    // Sanity: parse succeeds
    expect(questionsInputSchema.safeParse(args).success).toBe(true);
    expect(questionResultSchema.safeParse(result).success).toBe(true);
  });

  it("measures inline style object allocation cost (per-token, multiple components)", () => {
    if (process.env.BENCH_RENDER_COST !== "1") return;

    const ITERATIONS = 10000;

    // === Current pattern: inline style objects allocated per render
    // Simulates the per-token cost across SubAgentRunCard + ToolFallback +
    // SubAgentTranscriptInline before hoisting (10+ inline style objects per
    // token across these three components).
    function renderCurrentPattern() {
      // SubAgentRunCard
      const _a = { overflow: "hidden" };
      const _b = {
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        textAlign: "left",
      };
      const _c = { minWidth: 0, flex: 1 };
      const _d = {
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: "2px solid var(--mantine-color-default-border)",
        borderTopColor: "var(--mantine-color-blue-6)",
        animation: "spin 1s linear infinite",
        flexShrink: 0,
      };
      // SubAgentTranscriptInline
      const _e = { display: "flex", flexDirection: "column", gap: 8 };
      const _f = { overflowX: "auto", fontSize: 13, lineHeight: 1.55 };
      const _g = {
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "inherit",
      };
      // ToolFallback
      const _h = {
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        fontSize: 14,
        textAlign: "left",
      };
      return _a && _b && _c && _d && _e && _f && _g && _h;
    }

    // === Proposed pattern: hoisted module-level constants (just read)
    const HOISTED_A = { overflow: "hidden" };
    const HOISTED_B = {
      display: "flex",
      width: "100%",
      alignItems: "center",
      gap: 8,
      padding: "10px 12px",
      textAlign: "left",
    };
    function renderHoistedPattern() {
      return (
        HOISTED_A &&
        HOISTED_B &&
        HOISTED_A &&
        HOISTED_B &&
        HOISTED_A &&
        HOISTED_B &&
        HOISTED_A &&
        HOISTED_B
      );
    }

    const current = run(
      "8 inline style objects per render (current)",
      ITERATIONS,
      () => renderCurrentPattern(),
    );
    const hoisted = run(
      "8 hoisted constants read per render (proposed)",
      ITERATIONS,
      () => renderHoistedPattern(),
    );

    const result = {
      iterations: ITERATIONS,
      inlineAllocation: summarize(current.samples),
      hoistedRead: summarize(hoisted.samples),
      speedup: Number(
        (summarize(current.samples).meanUs /
          summarize(hoisted.samples).meanUs).toFixed(2),
      ),
    };

    // eslint-disable-next-line no-console
    console.log("\nINLINE_STYLE_BENCH_RESULT", JSON.stringify(result, null, 2));

    expect(result.hoistedRead.meanUs).toBeLessThan(result.inlineAllocation.meanUs);
  });

  it("measures getCurrentTokenCount cost (per-token useMemo recomputation)", async () => {
    if (process.env.BENCH_RENDER_COST !== "1") return;

    const { getCurrentTokenCount } = await import("@/lib/token-usage");
    type SimMessage = {
      id: string;
      role: string;
      parts: Array<Record<string, unknown>>;
    };

    // Simulate a research conversation: 20 messages, mix of user/assistant,
    // with tool-call parts containing realistic-size JSON args/result.
    const messages: SimMessage[] = [];
    for (let i = 0; i < 10; i += 1) {
      messages.push({
        id: `user-${i}`,
        role: "user",
        parts: [{ type: "text", text: `Research question ${i}: explain the trade-offs of approach ${i}.` }],
      });
      messages.push({
        id: `assistant-${i}`,
        role: "assistant",
        parts: [
          { type: "text", text: `# Findings ${i}\n\nHere is a summary with some detail.` },
          {
            type: "tool-web_search",
            toolCallId: `call-${i}`,
            state: "output-available",
            args: { query: `research topic ${i}` },
            inputText: JSON.stringify({ query: `research topic ${i}` }),
            output: {
              results: Array.from({ length: 8 }, (_, j) => ({
                title: `Result ${j}`,
                url: `https://example.com/${j}`,
                content: "Lorem ipsum dolor sit amet. ".repeat(50),
              })),
            },
            outputText: JSON.stringify({ results: [] }),
          },
          {
            type: "tool-extract_page_content",
            toolCallId: `call-${i}-x`,
            state: "output-available",
            args: { url: `https://example.com/page-${i}` },
            inputText: JSON.stringify({ url: "..." }),
            output: { success: true, content: "Extracted text. ".repeat(200) },
            outputText: "...",
          },
          { type: "text", text: `Based on the research, the answer is detailed above.` },
        ],
      });
    }

    const ITERATIONS = 500;

    // Current: recomputed per token during streaming
    const current = run(
      "getCurrentTokenCount (20 msg, tool-heavy)",
      ITERATIONS,
      () => getCurrentTokenCount(messages),
    );

    // Proposed: cached / not recomputed (just return previous number)
    let cached = 0;
    const cached_run = run(
      "cached (memo bails out via [length, status] dep)",
      ITERATIONS,
      () => cached,
    );

    const result = {
      iterations: ITERATIONS,
      messageCount: messages.length,
      recomputePerToken: summarize(current.samples),
      cachedBailout: summarize(cached_run.samples),
      speedup: Number(
        (summarize(current.samples).meanUs /
          summarize(cached_run.samples).meanUs).toFixed(2),
      ),
    };

    // eslint-disable-next-line no-console
    console.log("\nTOKEN_COUNT_BENCH_RESULT", JSON.stringify(result, null, 2));

    expect(current.result).toBeGreaterThan(0);
    expect(result.cachedBailout.meanUs).toBeLessThan(result.recomputePerToken.meanUs);
  });
});
