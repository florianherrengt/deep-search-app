import { describe, expect, it, vi } from "vitest";
import type { ModelMessage, ToolExecutionOptions, ToolSet, UIMessage } from "ai";
import {
  applyToolCallRequirementSafeguards,
  getActiveToolNamesForMessages,
  ToolCallRequirementError,
} from "@/lib/tool-call-requirements";

describe("tool call requirements", () => {
  it("keeps ungated tools active and hides tools with missing prerequisites", () => {
    const activeTools = getActiveToolNamesForMessages(fakeTools(), [
      userMessage("Research the market"),
    ]);

    expect(activeTools).toContain("ask_questions");
    expect(activeTools).toContain("disambiguate");
    expect(activeTools).not.toContain("create_research_plan");
  });

  it("enables gated tools when prerequisites were called previously", () => {
    const activeTools = getActiveToolNamesForMessages(fakeTools(), [
      userMessage("Research the market"),
      assistantToolCallMessage("ask_questions"),
    ]);

    expect(activeTools).toContain("create_research_plan");
  });

  it("lets old prerequisite calls unlock later user turns", () => {
    const activeTools = getActiveToolNamesForMessages(fakeTools(), [
      userMessage("Research the market"),
      assistantToolCallMessage("ask_questions"),
      userMessage("Now research a different market"),
    ]);

    expect(activeTools).toContain("create_research_plan");
  });

  it("blocks execution as a backstop when a gated tool is called too early", () => {
    const execute = vi.fn(() => "plan");
    const tools = applyToolCallRequirementSafeguards({
      create_research_plan: {
        description: "Create a research plan.",
        execute,
      },
    } as unknown as ToolSet);

    expect(() =>
      executeTool(tools, "create_research_plan", [
        { role: "user", content: "Research the market" },
      ]),
    ).toThrow(ToolCallRequirementError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows execution after the required previous tool call", () => {
    const execute = vi.fn(() => "plan");
    const tools = applyToolCallRequirementSafeguards({
      create_research_plan: {
        description: "Create a research plan.",
        execute,
      },
    } as unknown as ToolSet);

    expect(
      executeTool(tools, "create_research_plan", [
        { role: "user", content: "Research the market" },
        modelToolCallMessage("ask_questions"),
      ]),
    ).toBe("plan");
    expect(execute).toHaveBeenCalledOnce();
  });
});

function fakeTools() {
  return {
    ask_questions: {},
    disambiguate: {},
    create_research_plan: {},
  } as unknown as ToolSet;
}

function executeTool(
  tools: ToolSet,
  toolName: string,
  messages: ModelMessage[],
) {
  const execute = tools[toolName]?.execute;
  if (!execute) throw new Error(`Missing execute for ${toolName}`);

  return execute(
    { query: "Research the market" },
    {
      toolCallId: "call-1",
      messages,
    } satisfies ToolExecutionOptions,
  );
}

function userMessage(text: string): UIMessage {
  return {
    id: `user-${text}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantToolCallMessage(toolName: string): UIMessage {
  return {
    id: `assistant-${toolName}`,
    role: "assistant",
    parts: [
      {
        type: `tool-${toolName}`,
        toolCallId: `call-${toolName}`,
        state: "input-available",
        input: {},
      } as UIMessage["parts"][number],
    ],
  };
}

function modelToolCallMessage(toolName: string): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId: `call-${toolName}`,
        toolName,
        input: {},
      },
    ],
  };
}
