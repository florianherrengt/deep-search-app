import type { ModelMessage, ToolSet, UIMessage } from "ai";
import {
  TOOL_CALL_REQUIREMENTS,
  applyToolCallRequirementSafeguards as applyCoreToolCallRequirementSafeguards,
  evaluateToolCallRequirementForModelMessages as evaluateCoreToolCallRequirementForModelMessages,
  evaluateToolCallRequirementForResponse as evaluateCoreToolCallRequirementForResponse,
  evaluateToolCallRequirementForUIMessages as evaluateCoreToolCallRequirementForUIMessages,
  formatToolCallRequirementViolation,
  getActiveToolNamesForMessages as getCoreActiveToolNamesForMessages,
  getToolCallNamesFromModelMessages as getCoreToolCallNamesFromModelMessages,
  getToolCallNamesFromUIMessages as getCoreToolCallNamesFromUIMessages,
  ToolCallRequirementError,
} from "deep-search-core/research-orchestrator";

export type {
  ToolCallRequirement,
  ToolCallRequirementViolation,
} from "deep-search-core/research-orchestrator";

export {
  TOOL_CALL_REQUIREMENTS,
  formatToolCallRequirementViolation,
  ToolCallRequirementError,
};

export function applyToolCallRequirementSafeguards<TOOLS extends ToolSet>(
  tools: TOOLS,
): TOOLS {
  return applyCoreToolCallRequirementSafeguards(
    tools as unknown as Parameters<
      typeof applyCoreToolCallRequirementSafeguards
    >[0],
  ) as unknown as TOOLS;
}

export function getActiveToolNamesForMessages<TOOLS extends ToolSet>(
  tools: TOOLS,
  messages: UIMessage[],
): Array<Extract<keyof TOOLS, string>> {
  return getCoreActiveToolNamesForMessages(
    tools as unknown as Parameters<typeof getCoreActiveToolNamesForMessages>[0],
    messages as unknown as Parameters<
      typeof getCoreActiveToolNamesForMessages
    >[1],
  ) as Array<Extract<keyof TOOLS, string>>;
}

export function evaluateToolCallRequirementForResponse(args: {
  messages: UIMessage[];
  responseMessage: UIMessage;
}) {
  return evaluateCoreToolCallRequirementForResponse(
    args as unknown as Parameters<
      typeof evaluateCoreToolCallRequirementForResponse
    >[0],
  );
}

export function evaluateToolCallRequirementForUIMessages(
  toolName: string,
  messages: UIMessage[],
) {
  return evaluateCoreToolCallRequirementForUIMessages(
    toolName,
    messages as unknown as Parameters<
      typeof evaluateCoreToolCallRequirementForUIMessages
    >[1],
  );
}

export function evaluateToolCallRequirementForModelMessages(
  toolName: string,
  messages: ModelMessage[],
) {
  return evaluateCoreToolCallRequirementForModelMessages(
    toolName,
    messages as unknown as Parameters<
      typeof evaluateCoreToolCallRequirementForModelMessages
    >[1],
  );
}

export function getToolCallNamesFromUIMessages(messages: UIMessage[]) {
  return getCoreToolCallNamesFromUIMessages(
    messages as unknown as Parameters<typeof getCoreToolCallNamesFromUIMessages>[0],
  );
}

export function getToolCallNamesFromModelMessages(messages: ModelMessage[]) {
  return getCoreToolCallNamesFromModelMessages(
    messages as unknown as Parameters<
      typeof getCoreToolCallNamesFromModelMessages
    >[0],
  );
}
