import { describe, it, expect } from "vitest";
import {
  getLatestTokenUsage,
  estimateMessageTokens,
  getCurrentTokenCount,
} from "@/lib/token-usage";
import type { UIMessage } from "ai";

function makeMessage(parts: unknown[]): UIMessage {
  return {
    id: "msg-1",
    role: "assistant",
    parts: parts as UIMessage["parts"],
    metadata: {},
  };
}

function makeUserMessage(text: string): UIMessage {
  return {
    id: "msg-user",
    role: "user",
    parts: [{ type: "text", text }] as UIMessage["parts"],
    metadata: {},
  };
}

describe("getLatestTokenUsage", () => {
  it("returns undefined when there are no messages", () => {
    expect(getLatestTokenUsage([])).toBeUndefined();
  });

  it("returns undefined when no token_usage data part exists", () => {
    const messages = [
      makeMessage([{ type: "text", text: "hello", state: "done" }]),
    ];
    expect(getLatestTokenUsage(messages)).toBeUndefined();
  });

  it("returns the token_usage data from the latest assistant message", () => {
    const usage = {
      inputTokens: 1500,
      outputTokens: 500,
      totalTokens: 2000,
    };
    const messages = [
      makeMessage([
        { type: "text", text: "first", state: "done" },
        { type: "data-token_usage", data: usage },
      ]),
    ];
    expect(getLatestTokenUsage(messages)).toEqual(usage);
  });

  it("returns the latest token_usage when multiple exist", () => {
    const oldUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
    };
    const newUsage = {
      inputTokens: 3000,
      outputTokens: 800,
      totalTokens: 3800,
    };
    const messages = [
      makeMessage([
        { type: "data-token_usage", data: oldUsage },
        { type: "text", text: "first response", state: "done" },
      ]),
      makeUserMessage("continue"),
      makeMessage([
        { type: "text", text: "second response", state: "done" },
        { type: "data-token_usage", data: newUsage },
      ]),
    ];
    expect(getLatestTokenUsage(messages)).toEqual(newUsage);
  });

  it("skips non-assistant messages", () => {
    const usage = {
      inputTokens: 500,
      outputTokens: 100,
      totalTokens: 600,
    };
    const messages = [
      makeUserMessage("hi"),
      makeMessage([{ type: "data-token_usage", data: usage }]),
    ];
    expect(getLatestTokenUsage(messages)).toEqual(usage);
  });

  it("returns undefined when inputTokens is undefined", () => {
    const messages = [
      makeMessage([
        {
          type: "data-token_usage",
          data: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
        },
      ]),
    ];
    expect(getLatestTokenUsage(messages)).toBeUndefined();
  });
});

describe("estimateMessageTokens", () => {
  it("returns 0 for empty messages", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it("estimates tokens from text parts with exact formula", () => {
    const messages = [makeUserMessage("hello world")];
    expect(estimateMessageTokens(messages)).toBe(4);
  });

  it("estimates tokens for messages with mixed part types", () => {
    const messages = [
      makeUserMessage("hi"),
      makeMessage([
        { type: "reasoning", text: "Let me think about this." },
        {
          type: "tool-brave_search",
          args: { query: "test" },
          result: { title: "result" },
        },
        { type: "text", text: "Here is the answer." },
      ] as unknown[]),
    ];
    const tokens = estimateMessageTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("getCurrentTokenCount", () => {
  it("uses provider usage when available", () => {
    const messages = [
      makeMessage([
        {
          type: "data-token_usage",
          data: { inputTokens: 5000, outputTokens: 500, totalTokens: 5500 },
        },
      ]),
    ];
    expect(getCurrentTokenCount(messages)).toBe(5000);
  });

  it("falls back to estimate when provider usage is unavailable", () => {
    const messages = [makeUserMessage("hello world")];
    const tokens = getCurrentTokenCount(messages);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(100);
  });

  it("falls back to estimate when provider usage has 0 inputTokens", () => {
    const messages = [
      makeUserMessage("this is a longer message for estimation"),
      makeMessage([
        {
          type: "data-token_usage",
          data: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      ]),
    ];
    const tokens = getCurrentTokenCount(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it("falls back to estimate when provider usage has negative inputTokens", () => {
    const messages = [
      makeUserMessage("hello world"),
      makeMessage([
        {
          type: "data-token_usage",
          data: { inputTokens: -1, outputTokens: 0, totalTokens: -1 },
        },
      ]),
    ];
    const tokens = getCurrentTokenCount(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});
