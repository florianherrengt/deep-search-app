import {
  isToolUIPart,
  type ModelMessage,
  type ToolExecutionOptions,
  type ToolSet,
  type UIMessage,
} from "ai";
import { TOOL_NAMES } from "@/lib/tool-names";

export interface ToolCallRequirement {
  requiredPreviousTools?: readonly string[];
  anyOfPreviousTools?: readonly string[];
  prerequisiteLabel?: string;
  instruction: string;
}

export interface ToolCallRequirementViolation {
  toolName: string;
  requiredPreviousTools?: readonly string[];
  missingPreviousTools?: readonly string[];
  anyOfPreviousTools?: readonly string[];
  missingAnyOfTools?: readonly string[];
  prerequisiteLabel?: string;
  instruction: string;
}

export const WEB_SEARCH_TOOL_NAMES = [
  TOOL_NAMES.aggregate_search,
  TOOL_NAMES.brave_search,
  TOOL_NAMES.exa_search,
  TOOL_NAMES.serper_search,
  TOOL_NAMES.tavily_search,
  TOOL_NAMES.searxng_search,
] as const;

export const TOOL_CALL_REQUIREMENTS = {
  [TOOL_NAMES.create_research_plan]: {
    requiredPreviousTools: [TOOL_NAMES.ask_questions],
    instruction:
      "Call ask_questions first to clarify the research scope, then retry create_research_plan.",
  },
  [TOOL_NAMES.extract_page_content]: {
    anyOfPreviousTools: WEB_SEARCH_TOOL_NAMES,
    prerequisiteLabel: "a web search tool",
    instruction:
      "Run a web search first to find URLs to extract from, then retry extract_page_content.",
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

export function getToolCallNamesFromUIMessages(messages: UIMessage[]) {
  return messages.flatMap(getToolCallNamesFromUIMessage);
}

export function getToolCallNamesFromModelMessages(messages: ModelMessage[]) {
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
  const parts: string[] = [`${violation.toolName} cannot run yet.`];

  if (violation.missingPreviousTools && violation.missingPreviousTools.length > 0) {
    parts.push(
      `Missing required previous tool call${
        violation.missingPreviousTools.length === 1 ? "" : "s"
      }: ${formatToolNames(violation.missingPreviousTools)}.`,
    );
  }

  if (violation.missingAnyOfTools && violation.missingAnyOfTools.length > 0) {
    parts.push(
      `Call ${violation.prerequisiteLabel ?? "at least one of these tools"} first: ${formatToolNames(
        violation.missingAnyOfTools,
      )}.`,
    );
  }

  parts.push(violation.instruction);
  return parts.join(" ");
}

function evaluateToolCallRequirement(
  toolName: string,
  requirement: ToolCallRequirement,
  previousToolNames: string[],
): ToolCallRequirementViolation | null {
  const previous = new Set(previousToolNames);

  const missingPreviousTools =
    requirement.requiredPreviousTools?.filter(
      (requiredTool) => !previous.has(requiredTool),
    ) ?? [];

  const anyOfSatisfied =
    !requirement.anyOfPreviousTools ||
    requirement.anyOfPreviousTools.some((tool) => previous.has(tool));

  if (missingPreviousTools.length === 0 && anyOfSatisfied) return null;

  return {
    toolName,
    requiredPreviousTools: requirement.requiredPreviousTools,
    missingPreviousTools:
      missingPreviousTools.length > 0 ? missingPreviousTools : undefined,
    anyOfPreviousTools: requirement.anyOfPreviousTools,
    missingAnyOfTools:
      !anyOfSatisfied ? requirement.anyOfPreviousTools : undefined,
    prerequisiteLabel: requirement.prerequisiteLabel,
    instruction: requirement.instruction,
  };
}

function getToolCallRequirement(
  toolName: string,
): ToolCallRequirement | undefined {
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

  const prereqParts: string[] = [];
  if (requirement.requiredPreviousTools && requirement.requiredPreviousTools.length > 0) {
    prereqParts.push(`call ${formatToolNames(requirement.requiredPreviousTools)}`);
  }
  if (requirement.anyOfPreviousTools && requirement.anyOfPreviousTools.length > 0) {
    prereqParts.push(
      `call ${requirement.prerequisiteLabel ?? `at least one of ${formatToolNames(requirement.anyOfPreviousTools)}`}`,
    );
  }

  return `${description ?? toolName}\n\nPrerequisite: before calling this tool, ${prereqParts.join(" and ")} first.`;
}

function getToolCallNamesFromUIMessage(message: UIMessage): string[] {
  return message.parts.flatMap((part) =>
    isToolUIPart(part) ? [part.type.slice("tool-".length)] : [],
  );
}

function formatToolNames(toolNames: readonly string[]) {
  return toolNames.map((toolName) => `\`${toolName}\``).join(", ");
}
