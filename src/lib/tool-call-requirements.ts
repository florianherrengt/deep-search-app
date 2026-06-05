import {
  isToolUIPart,
  type ModelMessage,
  type ToolExecutionOptions,
  type ToolSet,
  type UIMessage,
} from "ai";

export interface ToolCallRequirement {
  requiredPreviousTools: readonly string[];
  instruction: string;
}

export interface ToolCallRequirementViolation {
  toolName: string;
  requiredPreviousTools: readonly string[];
  missingPreviousTools: readonly string[];
  instruction: string;
}

export const TOOL_CALL_REQUIREMENTS = {
  create_research_plan: {
    requiredPreviousTools: ["ask_questions", "rename_research_folder"],
    instruction:
      "Call ask_questions first, then rename_research_folder to name the research folder, then retry create_research_plan.",
  },
} as const satisfies Record<string, ToolCallRequirement>;

export class ToolCallRequirementError extends Error {
  readonly violation: ToolCallRequirementViolation;

  constructor(violation: ToolCallRequirementViolation) {
    super(formatToolCallRequirementViolation(violation));
    this.name = "ToolCallRequirementError";
    this.violation = violation;
  }
}

export function applyToolCallRequirementSafeguards<TOOLS extends ToolSet>(
  tools: TOOLS,
): TOOLS {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, tool]) => {
      const execute = tool.execute;
      return [
        toolName,
        {
          ...tool,
          description: appendRequirementDescription(
            toolName,
            tool.description,
          ),
          ...(execute
            ? {
                execute: ((input: unknown, options: ToolExecutionOptions) => {
                  const violation = evaluateToolCallRequirementForModelMessages(
                    toolName,
                    options.messages,
                  );
                  if (violation) {
                    throw new ToolCallRequirementError(violation);
                  }

                  return execute.call(tool, input, options);
                }) as typeof execute,
              }
            : {}),
        },
      ];
    }),
  ) as TOOLS;
}

export function getActiveToolNamesForMessages<TOOLS extends ToolSet>(
  tools: TOOLS,
  messages: UIMessage[],
): Array<Extract<keyof TOOLS, string>> {
  return (Object.keys(tools) as Array<Extract<keyof TOOLS, string>>).filter(
    (toolName) =>
      !evaluateToolCallRequirementForUIMessages(toolName, messages),
  );
}

export function evaluateToolCallRequirementForResponse({
  messages,
  responseMessage,
}: {
  messages: UIMessage[];
  responseMessage: UIMessage;
}): ToolCallRequirementViolation | null {
  for (const toolName of getToolCallNamesFromUIMessage(responseMessage)) {
    const violation = evaluateToolCallRequirementForUIMessages(
      toolName,
      messages,
    );
    if (violation) return violation;
  }

  return null;
}

export function evaluateToolCallRequirementForUIMessages(
  toolName: string,
  messages: UIMessage[],
): ToolCallRequirementViolation | null {
  const requirement = getToolCallRequirement(toolName);
  if (!requirement) return null;

  return evaluateToolCallRequirement(
    toolName,
    requirement,
    getToolCallNamesFromUIMessages(messages),
  );
}

export function evaluateToolCallRequirementForModelMessages(
  toolName: string,
  messages: ModelMessage[],
): ToolCallRequirementViolation | null {
  const requirement = getToolCallRequirement(toolName);
  if (!requirement) return null;

  return evaluateToolCallRequirement(
    toolName,
    requirement,
    getToolCallNamesFromModelMessages(messages),
  );
}

export function getToolCallNamesFromUIMessages(messages: UIMessage[]): string[] {
  return messages.flatMap(getToolCallNamesFromUIMessage);
}

export function getToolCallNamesFromModelMessages(
  messages: ModelMessage[],
): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content)) {
      return [];
    }

    return message.content.flatMap((part) =>
      part.type === "tool-call" ? [part.toolName] : [],
    );
  });
}

export function formatToolCallRequirementViolation(
  violation: ToolCallRequirementViolation,
) {
  return `${violation.toolName} cannot run yet. Missing required previous tool call${violation.missingPreviousTools.length === 1 ? "" : "s"}: ${formatToolNames(violation.missingPreviousTools)}. ${violation.instruction}`;
}

function evaluateToolCallRequirement(
  toolName: string,
  requirement: ToolCallRequirement,
  previousToolNames: string[],
): ToolCallRequirementViolation | null {
  const previous = new Set(previousToolNames);
  const missingPreviousTools = requirement.requiredPreviousTools.filter(
    (requiredTool) => !previous.has(requiredTool),
  );

  if (missingPreviousTools.length === 0) return null;

  return {
    toolName,
    requiredPreviousTools: requirement.requiredPreviousTools,
    missingPreviousTools,
    instruction: requirement.instruction,
  };
}

function getToolCallRequirement(toolName: string) {
  return TOOL_CALL_REQUIREMENTS[
    toolName as keyof typeof TOOL_CALL_REQUIREMENTS
  ];
}

function appendRequirementDescription(
  toolName: string,
  description: string | undefined,
) {
  const requirement = getToolCallRequirement(toolName);
  if (!requirement) return description;

  return `${description ?? toolName}\n\nPrerequisite: before calling this tool, call ${formatToolNames(requirement.requiredPreviousTools)} first.`;
}

function getToolCallNamesFromUIMessage(message: UIMessage): string[] {
  return message.parts.flatMap((part) =>
    isToolUIPart(part) ? [part.type.slice("tool-".length)] : [],
  );
}

function formatToolNames(toolNames: readonly string[]) {
  return toolNames.map((toolName) => `\`${toolName}\``).join(", ");
}
