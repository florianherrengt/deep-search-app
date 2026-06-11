export interface SubAgentRun {
  id: string;
  chatId: string;
  parentChatId: string;
  source?: "sub-agent";
  name: string;
  toolName: string;
  status: SubAgentStatus;
  startedAt: string;
  finishedAt: string | null;
  text: string;
  toolCalls: SubAgentToolCall[];
  error: string | null;
  parentMessageId: string;
}

export type SubAgentStatus = "running" | "completed" | "failed";

export interface SubAgentToolCall {
  toolCallId?: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  status: "running" | "complete" | "error";
}

export type SubAgentEvent =
  | { type: "start"; id: string; chatId?: string; source?: "sub-agent"; name: string; toolName: string; parentMessageId: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "tool-call"; id: string; toolCall: SubAgentToolCall }
  | { type: "tool-result"; id: string; toolCallIndex?: number; toolCallId?: string; result: unknown; status?: "complete" | "error" }
  | { type: "complete"; id: string }
  | { type: "error"; id: string; error: string };

export const MAX_SUB_AGENT_TEXT_LENGTH = 10_000;

const SUB_AGENT_TOOL_NAMES = new Set([
  "memory_agent",
  "name_folder",
  "retrieval_agent",
]);

export function isSubAgentRunToolName(toolName: string): boolean {
  return SUB_AGENT_TOOL_NAMES.has(toolName);
}

export function isSubAgentStartEvent(
  event: Extract<SubAgentEvent, { type: "start" }>,
): boolean {
  return event.source === "sub-agent" || isSubAgentRunToolName(event.toolName);
}

let nextSubAgentId = 0;

export function createSubAgentId(): string {
  return `sa-${Date.now()}-${nextSubAgentId++}`;
}
