import { describe, expect, it, vi } from "vitest";
import type { ModelMessage, ToolExecutionOptions, ToolSet, UIMessage } from "ai";
import {
  applyToolCallRequirementSafeguards,
  formatToolCallRequirementViolation,
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

  it("still hides create_research_plan when no previous tool calls exist", () => {
    const activeTools = getActiveToolNamesForMessages(fakeTools(), [
      userMessage("Research the market"),
    ]);

    expect(activeTools).not.toContain("create_research_plan");
  });

  it("enables gated tools when all prerequisites were called previously", () => {
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

  it("allows execution after all required previous tool calls", () => {
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

  it("formatToolCallRequirementViolation formats a single missing tool", () => {
    const message = formatToolCallRequirementViolation({
      toolName: "create_research_plan",
      requiredPreviousTools: ["ask_questions"],
      missingPreviousTools: ["ask_questions"],
      instruction:
        "Call ask_questions first to clarify the research scope, then retry create_research_plan.",
    });

    expect(message).toContain("create_research_plan");
    expect(message).toContain("Missing required previous tool call:");
    expect(message).toContain("`ask_questions`");
    expect(message).toMatch(/^\S/);
  });

  it("formatToolCallRequirementViolation formats multiple missing tools with plural", () => {
    const message = formatToolCallRequirementViolation({
      toolName: "create_research_plan",
      requiredPreviousTools: ["ask_questions", "other_tool"],
      missingPreviousTools: ["ask_questions", "other_tool"],
      instruction:
        "Call ask_questions and other_tool first, then retry create_research_plan.",
    });

    expect(message).toContain("create_research_plan");
    expect(message).toContain("Missing required previous tool calls:");
    expect(message).toContain("`ask_questions`");
    expect(message).toContain("`other_tool`");
  });

  it("appends prerequisite description to gated tools via applyToolCallRequirementSafeguards", () => {
    const tools = applyToolCallRequirementSafeguards({
      ask_questions: {
        description: "Ask the user multiple-choice questions.",
      },
      create_research_plan: {
        description: "Create a research plan.",
      },
    } as unknown as ToolSet);

    expect(tools.ask_questions.description).toBe(
      "Ask the user multiple-choice questions.",
    );

    expect(tools.create_research_plan.description).toContain(
      "Prerequisite: before calling this tool, call",
    );
    expect(tools.create_research_plan.description).toContain("`ask_questions`");
    expect(tools.create_research_plan.description).not.toContain(
      "`rename_research_folder`",
    );
  });

  it("hides extract_page_content when no search tool has been called", () => {
    const activeTools = getActiveToolNamesForMessages(fakeToolsWithExtract(), [
      userMessage("Research the market"),
    ]);

    expect(activeTools).toContain("brave_search");
    expect(activeTools).not.toContain("extract_page_content");
  });

  it("shows extract_page_content after aggregate_search was called", () => {
    const activeTools = getActiveToolNamesForMessages(fakeToolsWithExtract(), [
      userMessage("Research the market"),
      assistantToolCallMessage("aggregate_search"),
    ]);

    expect(activeTools).toContain("extract_page_content");
  });

  it("shows extract_page_content after brave_search was called", () => {
    const activeTools = getActiveToolNamesForMessages(fakeToolsWithExtract(), [
      userMessage("Research the market"),
      assistantToolCallMessage("brave_search"),
    ]);

    expect(activeTools).toContain("extract_page_content");
  });

  it("shows extract_page_content after serper_search was called", () => {
    const activeTools = getActiveToolNamesForMessages(fakeToolsWithExtract(), [
      userMessage("Research the market"),
      assistantToolCallMessage("serper_search"),
    ]);

    expect(activeTools).toContain("extract_page_content");
  });

  it("still hides extract_page_content when only unrelated tools were called", () => {
    const activeTools = getActiveToolNamesForMessages(fakeToolsWithExtract(), [
      userMessage("Research the market"),
      assistantToolCallMessage("ask_questions"),
    ]);

    expect(activeTools).not.toContain("extract_page_content");
  });

  it("blocks extract_page_content execution when no search tool was called", () => {
    const execute = vi.fn(() => "extracted");
    const tools = applyToolCallRequirementSafeguards({
      extract_page_content: {
        description: "Extract a web page.",
        execute,
      },
    } as unknown as ToolSet);

    expect(() =>
      executeTool(tools, "extract_page_content", [
        { role: "user", content: "Research the market" },
      ]),
    ).toThrow(ToolCallRequirementError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("allows extract_page_content execution after a search tool was called", () => {
    const execute = vi.fn(() => "extracted");
    const tools = applyToolCallRequirementSafeguards({
      extract_page_content: {
        description: "Extract a web page.",
        execute,
      },
    } as unknown as ToolSet);

    expect(
      executeTool(tools, "extract_page_content", [
        { role: "user", content: "Research the market" },
        modelToolCallMessage("brave_search"),
      ]),
    ).toBe("extracted");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("allows extract_page_content execution after aggregate_search was called", () => {
    const execute = vi.fn(() => "extracted");
    const tools = applyToolCallRequirementSafeguards({
      extract_page_content: {
        description: "Extract a web page.",
        execute,
      },
    } as unknown as ToolSet);

    expect(
      executeTool(tools, "extract_page_content", [
        { role: "user", content: "Research the market" },
        modelToolCallMessage("aggregate_search"),
      ]),
    ).toBe("extracted");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("allows extract_page_content execution after any search tool (serper) was called", () => {
    const execute = vi.fn(() => "extracted");
    const tools = applyToolCallRequirementSafeguards({
      extract_page_content: {
        description: "Extract a web page.",
        execute,
      },
    } as unknown as ToolSet);

    expect(
      executeTool(tools, "extract_page_content", [
        { role: "user", content: "Research the market" },
        modelToolCallMessage("serper_search"),
      ]),
    ).toBe("extracted");
    expect(execute).toHaveBeenCalledOnce();
  });

  it("formatToolCallRequirementViolation formats an anyOf violation", () => {
    const message = formatToolCallRequirementViolation({
      toolName: "extract_page_content",
      anyOfPreviousTools: [
        "aggregate_search",
        "brave_search",
        "exa_search",
        "serper_search",
        "tavily_search",
        "searxng_search",
      ],
      missingAnyOfTools: [
        "aggregate_search",
        "brave_search",
        "exa_search",
        "serper_search",
        "tavily_search",
        "searxng_search",
      ],
      instruction:
        "Run a web search first to find URLs to extract from, then retry extract_page_content.",
    });

    expect(message).toContain("extract_page_content");
    expect(message).toContain("web search");
    expect(message).toContain("`aggregate_search`");
    expect(message).toContain("`brave_search`");
    expect(message).toContain("`exa_search`");
    expect(message).toMatch(/^\S/);
  });

  it("appends anyOf prerequisite description to extract_page_content", () => {
    const tools = applyToolCallRequirementSafeguards({
      brave_search: {
        description: "Search the web.",
      },
      extract_page_content: {
        description: "Extract a web page.",
      },
    } as unknown as ToolSet);

    expect(tools.brave_search.description).toBe("Search the web.");

    expect(tools.extract_page_content.description).toContain(
      "Prerequisite: before calling this tool, call a web search tool first.",
    );
  });
});

function fakeToolsWithExtract() {
  return {
    aggregate_search: {},
    brave_search: {},
    serper_search: {},
    extract_page_content: {},
  } as unknown as ToolSet;
}

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
