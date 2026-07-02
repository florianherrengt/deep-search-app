import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type { AgentDiagnosticEvent } from "@/lib/agent-diagnostics";
import { isRecord } from "@/lib/json";

const COMPLETE_TOOL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

export interface InterruptedToolCallRepair {
  messageId: string;
  toolCallId: string;
  toolName: string;
  state: string;
  inputPreview?: string;
}

export interface InterruptedToolCallRepairResult {
  messages: UIMessage[];
  repairs: InterruptedToolCallRepair[];
  droppedMessageIds: string[];
  repaired: boolean;
}

interface RepairInterruptedToolCallOptions {
  onlyWhenFollowedByUserMessage?: boolean;
}

export function repairInterruptedToolCallMessages(
  messages: UIMessage[],
  options: RepairInterruptedToolCallOptions = {},
): InterruptedToolCallRepairResult {
  const repairs: InterruptedToolCallRepair[] = [];
  const droppedMessageIds: string[] = [];
  const repairedMessages: UIMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const interruptedToolCalls =
      message.role === "assistant" ? getInterruptedToolCalls(message) : [];

    if (
      interruptedToolCalls.length > 0 &&
      (!options.onlyWhenFollowedByUserMessage ||
        hasLaterUserOrSystemMessage(messages, i))
    ) {
      repairs.push(...interruptedToolCalls);
      droppedMessageIds.push(message.id);
      continue;
    }

    repairedMessages.push(message);
  }

  return {
    messages: repairs.length > 0 ? repairedMessages : messages,
    repairs,
    droppedMessageIds,
    repaired: repairs.length > 0,
  };
}

export function createInterruptedToolRepairDiagnostic(
  result: InterruptedToolCallRepairResult,
): AgentDiagnosticEvent {
  const toolCallIds = result.repairs.map((repair) => repair.toolCallId);
  const toolNames = Array.from(
    new Set(result.repairs.map((repair) => repair.toolName)),
  ).join(", ");

  return {
    kind: "interrupted_tool_repair",
    status: "warning",
    title: "Interrupted tool work discarded",
    message:
      "A previous tool call did not return a result, so that interrupted assistant step was removed before continuing.",
    reason: `Dropped ${result.droppedMessageIds.length} assistant message${result.droppedMessageIds.length === 1 ? "" : "s"} with ${result.repairs.length} unfinished tool call${result.repairs.length === 1 ? "" : "s"}${toolNames ? `: ${toolNames}` : ""}.`,
    toolCallCount: result.repairs.length,
    droppedMessageCount: result.droppedMessageIds.length,
    toolCallIds,
  };
}

export function logInterruptedToolCallRepair(
  context: string,
  result: InterruptedToolCallRepairResult,
): void {
  if (!result.repaired) return;

  console.warn(`[tool-call-repair] ${context}`, {
    droppedMessageIds: result.droppedMessageIds,
    repairs: result.repairs,
  });
}

function getInterruptedToolCalls(
  message: UIMessage,
): InterruptedToolCallRepair[] {
  const repairs: InterruptedToolCallRepair[] = [];

  for (const part of message.parts) {
    if (!isToolUIPart(part)) continue;
    if (!isInterruptedToolPart(part)) continue;

    repairs.push({
      messageId: message.id,
      toolCallId: part.toolCallId,
      toolName: getToolNameSafely(part),
      state: typeof part.state === "string" ? part.state : "unknown",
      ...previewInput(part),
    });
  }

  return repairs;
}

function isInterruptedToolPart(
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>,
): boolean {
  if (part.providerExecuted === true) return false;
  if (typeof part.state !== "string") return true;
  if (COMPLETE_TOOL_STATES.has(part.state)) return false;

  if (part.state === "approval-responded") {
    return !(
      isRecord(part.approval) &&
      typeof part.approval.approved === "boolean"
    );
  }

  return true;
}

function hasLaterUserOrSystemMessage(
  messages: UIMessage[],
  messageIndex: number,
): boolean {
  return messages
    .slice(messageIndex + 1)
    .some((message) => message.role === "user" || message.role === "system");
}

function getToolNameSafely(
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>,
): string {
  try {
    return getToolName(part);
  } catch {
    return typeof part.type === "string" ? part.type : "unknown_tool";
  }
}

function previewInput(
  part: Extract<UIMessage["parts"][number], { toolCallId: string }>,
): { inputPreview?: string } {
  const record = part as Record<string, unknown>;
  if (!("input" in record) && !("rawInput" in record)) return {};

  const input = "input" in record ? record.input : record.rawInput;
  if (input === undefined) return {};

  const preview = stringifyPreview(input, 500);
  return preview ? { inputPreview: preview } : {};
}

function stringifyPreview(value: unknown, maxLength: number): string | null {
  try {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    if (!serialized) return null;
    return serialized.length > maxLength
      ? `${serialized.slice(0, maxLength)}...`
      : serialized;
  } catch {
    const fallback = String(value);
    return fallback.length > maxLength
      ? `${fallback.slice(0, maxLength)}...`
      : fallback;
  }
}
