export interface SubAgentRun {
  id: string;
  name: string;
  toolName: string;
  status: "running" | "complete" | "error";
  startedAt: string;
  finishedAt: string | null;
  text: string;
  toolCalls: SubAgentToolCall[];
  error: string | null;
  parentMessageId: string;
}

export interface SubAgentToolCall {
  toolName: string;
  args: unknown;
  result?: unknown;
  status: "running" | "complete" | "error";
}

export type SubAgentEvent =
  | { type: "start"; id: string; name: string; toolName: string; parentMessageId: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "tool-call"; id: string; toolCall: SubAgentToolCall }
  | { type: "tool-result"; id: string; toolCallIndex: number; result: unknown }
  | { type: "complete"; id: string }
  | { type: "error"; id: string; error: string };

export const MAX_SUB_AGENT_TEXT_LENGTH = 10_000;

let nextSubAgentId = 0;

export function createSubAgentId(): string {
  return `sa-${Date.now()}-${nextSubAgentId++}`;
}
