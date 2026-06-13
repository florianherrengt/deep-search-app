import { describe, it } from "vitest";
import type { UIMessage } from "ai";

function makeRealisticMessages(count: number): UIMessage[] {
  const messages: UIMessage[] = [];
  const samplePageContent =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(120);

  for (let i = 0; i < count; i += 1) {
    messages.push({
      id: `user-${i}`,
      role: "user",
      parts: [{ type: "text", text: `Research question number ${i}: explain the trade-offs.` }],
    } as UIMessage);

    messages.push({
      id: `assistant-${i}`,
      role: "assistant",
      parts: [
        { type: "text", text: `# Findings for question ${i}\n\nHere is a summary.` },
        {
          type: `tool-search_research`,
          toolCallId: `call-${i}`,
          state: "output-available",
          input: { query: `query ${i}` },
          inputText: JSON.stringify({ query: `query ${i}` }),
          output: { results: Array.from({ length: 8 }, (_, j) => ({ title: `result ${j}`, url: `https://example.com/${j}`, content: samplePageContent })) },
          outputText: JSON.stringify({ results: [] }),
        },
        { type: "text", text: `Based on the research, the answer to question ${i} is detailed above.` },
      ],
    } as unknown as UIMessage);
  }
  return messages;
}

describe("chat messages JSON serialization perf", { concurrent: false }, () => {
  it("compares pretty vs compact stringify", () => {
    if (process.env.BENCH_JSON_WRITE !== "1") return;

    const messages = makeRealisticMessages(40);
    const envelope = { id: "chat-id", title: "title", createdAt: "now", updatedAt: "now", messages };
    const ITERATIONS = 50;
    const WARMUP = 5;

    const pretty = (v: unknown) => JSON.stringify(v, null, 2);
    const compact = (v: unknown) => JSON.stringify(v);

    for (let i = 0; i < WARMUP; i += 1) {
      pretty(envelope);
      compact(envelope);
    }

    const prettySamples: number[] = [];
    const compactSamples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const ps = performance.now();
      const prettyOut = pretty(envelope);
      prettySamples.push(performance.now() - ps);

      const cs = performance.now();
      const compactOut = compact(envelope);
      compactSamples.push(performance.now() - cs);
      void prettyOut;
      void compactOut;
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const prettyBytes = pretty(envelope).length;
    const compactBytes = compact(envelope).length;

    const result = {
      messageCount: messages.length,
      prettyMeanMs: Number(mean(prettySamples).toFixed(3)),
      compactMeanMs: Number(mean(compactSamples).toFixed(3)),
      prettyBytes,
      compactBytes,
      sizeReductionPct: Number((((prettyBytes - compactBytes) / prettyBytes) * 100).toFixed(1)),
    };

    console.log("[bench:json-write]", JSON.stringify(result));
  });

  it("measures incremental append vs full-rewrite serialize cost", () => {
    if (process.env.BENCH_JSON_WRITE !== "1") return;

    const fullConversation = makeRealisticMessages(40);
    const newMessages = makeRealisticMessages(1).slice(-2);

    const ITERATIONS = 200;
    const WARMUP = 10;

    const serialize = (msgs: unknown[]) => JSON.stringify(msgs);

    for (let i = 0; i < WARMUP; i += 1) {
      serialize(fullConversation);
      serialize(newMessages);
    }

    const fullSamples: number[] = [];
    const appendSamples: number[] = [];
    for (let i = 0; i < ITERATIONS; i += 1) {
      const fs = performance.now();
      serialize(fullConversation);
      fullSamples.push(performance.now() - fs);

      const as = performance.now();
      serialize(newMessages);
      appendSamples.push(performance.now() - as);
    }

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const fullBytes = serialize(fullConversation).length;
    const appendBytes = serialize(newMessages).length;

    const result = {
      fullMessages: fullConversation.length,
      newMessages: newMessages.length,
      fullRewriteMeanMs: Number(mean(fullSamples).toFixed(3)),
      appendMeanMs: Number(mean(appendSamples).toFixed(3)),
      fullBytes,
      appendBytes,
      appendIsXFaster: Number((mean(fullSamples) / mean(appendSamples)).toFixed(1)),
    };

    console.log("[bench:json-write-incremental]", JSON.stringify(result));
  });
});
