import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  createInterruptedToolRepairDiagnostic,
  repairInterruptedToolCallMessages,
} from "@/lib/tool-call-repair";

describe("repairInterruptedToolCallMessages", () => {
  it("drops assistant messages that contain interrupted tool calls", () => {
    const messages = [
      userMessage("Find pricing"),
      assistantMessage("assistant-interrupted", [
        { type: "text", text: "Checking..." },
        interruptedTool("call-1", "brave_search", { query: "pricing" }),
      ]),
      userMessage("Try with another model"),
    ];

    const result = repairInterruptedToolCallMessages(messages);

    expect(result.repaired).toBe(true);
    expect(result.messages.map((message) => message.id)).toEqual([
      "user-Find pricing",
      "user-Try with another model",
    ]);
    expect(result.droppedMessageIds).toEqual(["assistant-interrupted"]);
    expect(result.repairs).toEqual([
      expect.objectContaining({
        messageId: "assistant-interrupted",
        toolCallId: "call-1",
        toolName: "brave_search",
        state: "input-available",
      }),
    ]);
  });

  it("keeps a pending tool call at the end when only stale calls are repaired", () => {
    const messages = [
      userMessage("Ask me a question"),
      assistantMessage("assistant-question", [
        interruptedTool("question-1", "ask_questions", {
          questions: [{ question: "Which market?", candidates: [] }],
        }),
      ]),
    ];

    const result = repairInterruptedToolCallMessages(messages, {
      onlyWhenFollowedByUserMessage: true,
    });

    expect(result.repaired).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("drops a pending tool call once a later user message makes it stale", () => {
    const messages = [
      userMessage("Ask me a question"),
      assistantMessage("assistant-question", [
        interruptedTool("question-1", "ask_questions", {
          questions: [{ question: "Which market?", candidates: [] }],
        }),
      ]),
      userMessage("Ignore that and continue"),
    ];

    const result = repairInterruptedToolCallMessages(messages, {
      onlyWhenFollowedByUserMessage: true,
    });

    expect(result.repaired).toBe(true);
    expect(result.messages.map((message) => message.id)).toEqual([
      "user-Ask me a question",
      "user-Ignore that and continue",
    ]);
  });

  it("keeps completed and provider-executed tool parts", () => {
    const messages = [
      assistantMessage("assistant-complete", [
        completedTool("call-output", "brave_search"),
        errorTool("call-error", "extract_page_content"),
        providerExecutedTool("call-provider", "web_search"),
      ]),
    ];

    const result = repairInterruptedToolCallMessages(messages);

    expect(result.repaired).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it("creates a visible diagnostic for repaired calls", () => {
    const result = repairInterruptedToolCallMessages([
      assistantMessage("assistant-interrupted", [
        interruptedTool("call-1", "brave_search", { query: "pricing" }),
      ]),
    ]);

    expect(createInterruptedToolRepairDiagnostic(result)).toEqual(
      expect.objectContaining({
        kind: "interrupted_tool_repair",
        status: "warning",
        droppedMessageCount: 1,
        toolCallCount: 1,
        toolCallIds: ["call-1"],
      }),
    );
  });
});

function userMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantMessage(
  id: string,
  parts: UIMessage["parts"],
): UIMessage {
  return { id, role: "assistant", parts };
}

function interruptedTool(
  toolCallId: string,
  toolName: string,
  input: unknown,
): UIMessage["parts"][number] {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "input-available",
    input,
    providerExecuted: false,
  } as UIMessage["parts"][number];
}

function completedTool(
  toolCallId: string,
  toolName: string,
): UIMessage["parts"][number] {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "output-available",
    input: { query: "pricing" },
    output: "results",
    providerExecuted: false,
  } as UIMessage["parts"][number];
}

function errorTool(
  toolCallId: string,
  toolName: string,
): UIMessage["parts"][number] {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "output-error",
    input: { url: "https://example.com" },
    errorText: "failed",
    providerExecuted: false,
  } as UIMessage["parts"][number];
}

function providerExecutedTool(
  toolCallId: string,
  toolName: string,
): UIMessage["parts"][number] {
  return {
    type: `tool-${toolName}`,
    toolCallId,
    state: "input-available",
    input: { query: "pricing" },
    providerExecuted: true,
  } as UIMessage["parts"][number];
}
