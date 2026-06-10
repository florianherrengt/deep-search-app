import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { shouldContinueAfterToolResult } from "@/lib/transport";
import { SUB_AGENT_TEXT_PROVIDER_METADATA } from "@/lib/sub-agent-stream";

describe("shouldContinueAfterToolResult", () => {
  it("continues when the latest assistant step ends with completed tool output", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Find current pricing"),
          assistantMessage([{ type: "step-start" }, toolPart("brave_search")]),
        ],
      }),
    ).toBe(true);
  });

  it("does not keep auto-submitting after an empty model step follows a tool", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Find current pricing"),
          assistantMessage([
            { type: "step-start" },
            toolPart("brave_search"),
            { type: "text", text: "", state: "done" },
            { type: "step-start" },
            { type: "text", text: "", state: "done" },
          ]),
        ],
      }),
    ).toBe(false);
  });

  it("continues when a completed tool is followed by an empty text boundary in the same step", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Find current pricing"),
          assistantMessage([
            { type: "step-start" },
            toolPart("brave_search"),
            { type: "text", text: "", state: "done" },
          ]),
        ],
      }),
    ).toBe(true);
  });

  it("ignores sub-agent progress text after a completed tool", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Verify this"),
          assistantMessage([
            { type: "step-start" },
            toolPart("facts_check"),
            {
              type: "text",
              text: "Verification found no high-risk factual errors.",
              providerMetadata: SUB_AGENT_TEXT_PROVIDER_METADATA,
            },
          ]),
        ],
      }),
    ).toBe(true);
  });

  it("does not continue after assistant output follows the completed tool", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Find current pricing"),
          assistantMessage([
            { type: "step-start" },
            toolPart("brave_search"),
            { type: "text", text: "The current price is $10.", state: "done" },
          ]),
        ],
      }),
    ).toBe(false);
  });

  it("continues when the latest tool is in output-error state", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Find current pricing"),
          assistantMessage([{ type: "step-start" }, errorToolPart("brave_search")]),
        ],
      }),
    ).toBe(true);
  });

  it("does not continue when the last message is not from assistant", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [userMessage("Find current pricing")],
      }),
    ).toBe(false);
  });

  it("does not continue when parts array is empty", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Find current pricing"),
          assistantMessage([]),
        ],
      }),
    ).toBe(false);
  });

  it("does not continue when the last tool in the step is incomplete", () => {
    expect(
      shouldContinueAfterToolResult({
        messages: [
          userMessage("Find current pricing"),
          assistantMessage([
            { type: "step-start" },
            incompleteToolPart("brave_search"),
          ]),
        ],
      }),
    ).toBe(false);
  });
});

function userMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantMessage(parts: UIMessage["parts"]): UIMessage {
  return {
    id: "assistant",
    role: "assistant",
    parts,
  };
}

function toolPart(toolName: string): UIMessage["parts"][number] {
  return {
    type: `tool-${toolName}`,
    toolCallId: `${toolName}-1`,
    state: "output-available",
    input: { query: "pricing" },
    output: "result",
    providerExecuted: false,
  } as UIMessage["parts"][number];
}

function errorToolPart(toolName: string): UIMessage["parts"][number] {
  return {
    type: `tool-${toolName}`,
    toolCallId: `${toolName}-1`,
    state: "output-error",
    input: { query: "pricing" },
    providerExecuted: false,
    errorText: "Fetch failed",
  } as UIMessage["parts"][number];
}

function incompleteToolPart(toolName: string): UIMessage["parts"][number] {
  return {
    type: `tool-${toolName}`,
    toolCallId: `${toolName}-1`,
    state: "input-streaming",
    input: { query: "pricing" },
    providerExecuted: false,
  } as UIMessage["parts"][number];
}
