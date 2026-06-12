import { type Tool } from "ai";
import { createSubAgentId, type SubAgentToolCall } from "./sub-agent-types";
import { emitSubAgentEvent, getParentMessageId } from "./sub-agent-emitter";

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  ask_questions: "Ask Questions",
  disambiguate: "Disambiguate",
  brave_search: "Brave Search",
  exa_search: "Exa Search",
  serper_search: "Serper Search",
  tavily_search: "Tavily Search",
  searxng_search: "SearXNG Search",
  extract_page_content: "Content Extraction",
  create_file: "Create File",
  read_file: "Read File",
  update_file: "Update File",
  move_file: "Move File",
  delete_file: "Delete File",
  list_files: "List Files",
  research_checkpoint: "Research Checkpoint",
  sequential_thinking: "Sequential Thinking",
  load_skill: "Load Skill",
  search_research: "Research Recall",
  switch_research_folder: "Switch Folder",
  create_research_plan: "Research Plan",
  facts_check: "Facts Check",
  currency_conversion: "Currency Conversion",
  memory_agent: "Memory Extraction",
  retrieval_agent: "Research Recall",
  name_folder: "Folder Naming",
};

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

export function wrapToolWithSubAgentTracking<T extends Tool>(
  toolName: string,
  originalTool: T,
): T {
  const displayName = getToolDisplayName(toolName);
  const originalExecute = originalTool.execute;

  if (!originalExecute) return originalTool;

  const wrappedExecute = async (input: unknown, options: unknown) => {
    const parentMessageId = getParentMessageId() ?? "unknown";
    const subAgentId = createSubAgentId();

    emitSubAgentEvent({
      type: "start",
      id: subAgentId,
      name: displayName,
      toolName,
      parentMessageId,
    });

    const toolCall: SubAgentToolCall = {
      toolName,
      args: input,
      status: "running",
    };

    emitSubAgentEvent({ type: "tool-call", id: subAgentId, toolCall });

    try {
      const result = await originalExecute(input as Parameters<typeof originalExecute>[0], options as Parameters<typeof originalExecute>[1]);

      emitSubAgentEvent({
        type: "tool-result",
        id: subAgentId,
        toolCallIndex: 0,
        result,
      });

      emitSubAgentEvent({ type: "complete", id: subAgentId });

      return result;
    } catch (error) {
      emitSubAgentEvent({
        type: "tool-result",
        id: subAgentId,
        toolCallIndex: 0,
        result: error instanceof Error ? error.message : String(error),
        status: "error",
      });

      emitSubAgentEvent({
        type: "error",
        id: subAgentId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  };

  return {
    ...originalTool,
    execute: wrappedExecute,
  } as T;
}
