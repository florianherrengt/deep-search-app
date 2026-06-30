import {
  isToolUIPart,
  type ToolChoice,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { TOOL_NAMES } from "@/lib/tool-names";
import { CURRENCIES, type Currency } from "@/lib/settings-store";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import getSymbolFromCurrency from "currency-symbol-map";
import {
  evaluateToolCallRequirementForResponse,
  WEB_SEARCH_TOOL_NAMES,
  type ToolCallRequirementViolation,
} from "@/lib/tool-call-requirements";
import {
  asksUserForInput as pkgAsksUserForInput,
  isResearchLikeRequest as pkgIsResearchLikeRequest,
  reviewResearchCheckpoint as pkgReviewResearchCheckpoint,
  researchCheckpointInputSchema as pkgResearchCheckpointInputSchema,
  researchCheckpointResultSchema as pkgResearchCheckpointResultSchema,
  type ResearchCheckpointInput,
  type ResearchCheckpointResult,
} from "deep-search-core/research-orchestrator";

// ─── Re-exports from deep-search-core/research-orchestrator (backward compatibility) ───

export { pkgAsksUserForInput as asksUserForInput };
export { pkgIsResearchLikeRequest as isResearchLikeRequest };
export { pkgReviewResearchCheckpoint as reviewResearchCheckpoint };
export { pkgResearchCheckpointInputSchema as researchCheckpointInputSchema };
export { pkgResearchCheckpointResultSchema as researchCheckpointResultSchema };
export type { ResearchCheckpointInput, ResearchCheckpointResult };

// ─── App-level guardrail schema & types (includes currency_conversion) ───

export const guardrailEventSchema = z.object({
  kind: z.enum([
    "question_tool",
    "research_checkpoint",
    "tool_call_requirement",
    "currency_conversion",
  ]),
  status: z.enum(["retrying", "warning", "passed"]),
  title: z.string(),
  message: z.string(),
  reason: z.string().optional(),
  attempt: z.number().optional(),
});

export type GuardrailEvent = z.infer<typeof guardrailEventSchema>;

export type GuardName =
  | "question_tool"
  | "research_checkpoint"
  | "tool_call_requirement"
  | "currency_conversion";

export type GuardDecision<TOOLS extends ToolSet = ToolSet> =
  | { action: "accept" }
  | {
      action: "retry";
      guard: GuardName;
      event: GuardrailEvent;
      retryInstruction: string;
      toolChoice?: ToolChoice<TOOLS>;
    };

// ─── Currency detection ───

const CURRENCY_SYMBOL_TO_CODES: Record<string, string> = (() => {
  const map: Record<string, string[]> = {};
  const currencySymbolMap = getSymbolFromCurrency.currencySymbolMap;
  for (const [code, symbol] of Object.entries(currencySymbolMap)) {
    if (typeof symbol !== "string" || symbol.length === 0) continue;
    if (!map[symbol]) map[symbol] = [];
    map[symbol].push(code);
  }
  return Object.fromEntries(
    Object.entries(map).map(([sym, codes]) => [sym, codes.join(", ")]),
  );
})();

const CURRENCY_CODE_PATTERN = new RegExp(
  `\\b\\d[\\d,.]*\\s*(${CURRENCIES.join("|")})\\b` +
    `|` +
    `\\b(${CURRENCIES.join("|")})\\s+\\d[\\d,.]*\\b`,
  "gi",
);

const AMOUNT_WORD_PATTERN =
  "(?:\\d[\\d,.]*|(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)(?:[-\\s]+(?:and\\s+)?(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion))*)";

const CURRENCY_NAME_PATTERNS: Array<{
  pattern: string;
  codes: Currency[];
}> = [
  {
    pattern: "dollars?",
    codes: ["USD", "CAD", "AUD", "NZD", "SGD", "HKD"],
  },
  { pattern: "(?:u\\.?s\\.?|american)\\s+dollars?", codes: ["USD"] },
  { pattern: "canadian\\s+dollars?", codes: ["CAD"] },
  { pattern: "australian\\s+dollars?", codes: ["AUD"] },
  { pattern: "new\\s+zealand\\s+dollars?", codes: ["NZD"] },
  { pattern: "singapore\\s+dollars?", codes: ["SGD"] },
  { pattern: "hong\\s+kong\\s+dollars?", codes: ["HKD"] },
  { pattern: "euros?", codes: ["EUR"] },
  { pattern: "(?:british\\s+pounds?|pounds?\\s+sterling|sterling)", codes: ["GBP"] },
  { pattern: "yen", codes: ["JPY"] },
  { pattern: "yuan", codes: ["CNY"] },
  { pattern: "rupees?", codes: ["INR"] },
  { pattern: "francs?", codes: ["CHF"] },
];

const CURRENCY_SYMBOL_MATCHERS: Array<{
  pattern: RegExp;
  codesArr: string[];
  codesStr: string;
}> = (() => {
  const entries: Array<{
    pattern: RegExp;
    codesArr: string[];
    codesStr: string;
  }> = [];
  for (const [symbol, codesStr] of Object.entries(CURRENCY_SYMBOL_TO_CODES)) {
    const pattern = currencySymbolPattern(symbol);
    if (!pattern) continue;
    entries.push({ pattern, codesArr: codesStr.split(", "), codesStr });
  }
  return entries;
})();

const CURRENCY_NAME_MATCHERS: Array<{
  regex: RegExp;
  codes: Currency[];
}> = CURRENCY_NAME_PATTERNS.map(({ pattern, codes }) => ({
  regex: new RegExp(`\\b${AMOUNT_WORD_PATTERN}\\s+(?:${pattern})\\b`, "gi"),
  codes,
}));

const RESEARCH_TOOL_NAMES = new Set<string>([
  ...WEB_SEARCH_TOOL_NAMES,
  TOOL_NAMES.extract_page_content,
]);

const RESEARCH_CHECKPOINT_TOOL = TOOL_NAMES.research_checkpoint;

function currencySymbolPattern(symbol: string): RegExp | null {
  if (/^[A-Za-z]$/.test(symbol)) return null;

  const escaped = escapeRegex(symbol);
  if (/^[A-Za-z0-9]+$/.test(symbol)) {
    return new RegExp(
      `\\b${escaped}\\s+[\\d,.]+\\b|\\b[\\d,.]+\\s+${escaped}\\b`,
      "g",
    );
  }

  return new RegExp(
    `${escaped}\\s*[\\d,.]+\\b|\\b[\\d,.]+\\s*${escaped}`,
    "g",
  );
}

export function detectForeignCurrencyMentions(
  text: string,
  targetCurrency: Currency,
): string[] {
  const matches = new Set<string>();

  for (const { pattern, codesArr } of CURRENCY_SYMBOL_MATCHERS) {
    if (codesArr.includes(targetCurrency)) continue;
    for (const m of text.matchAll(pattern)) {
      matches.add(m[0]);
    }
  }

  for (const m of text.matchAll(CURRENCY_CODE_PATTERN)) {
    const code = (m[1] || m[2]).toUpperCase();
    if (code !== targetCurrency) {
      matches.add(m[0]);
    }
  }

  for (const { regex, codes } of CURRENCY_NAME_MATCHERS) {
    if (codes.includes(targetCurrency)) continue;
    for (const m of text.matchAll(regex)) {
      matches.add(m[0]);
    }
  }

  return [...matches];
}

function stripCodeBlocksAndQuotes(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Helpers ───

function getToolNameFromPart(part: UIMessage["parts"][number]) {
  if (!isToolUIPart(part)) return null;
  return part.type.slice("tool-".length);
}

function hasToolCall(message: UIMessage, toolName: string) {
  return message.parts.some((part) => getToolNameFromPart(part) === toolName);
}

function hasDeepResearchToolCall(message: UIMessage) {
  return message.parts.some((part) => {
    const name = getToolNameFromPart(part);
    return name ? RESEARCH_TOOL_NAMES.has(name) : false;
  });
}

function hasResearchCheckpoint(message: UIMessage) {
  return hasToolCall(message, RESEARCH_CHECKPOINT_TOOL);
}

function getMessageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
        part.type === "text",
    )
    .filter((part) => !isSubAgentOutputTextPart(part))
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function getLatestUserText(messages: UIMessage[]): string {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  return getMessageText(latestUserMessage);
}

function getCurrentTurnMessages(
  messages: UIMessage[],
  responseMessage: UIMessage,
) {
  const latestUserIndex = messages.reduce(
    (latest, message, index) => (message.role === "user" ? index : latest),
    -1,
  );

  return [
    ...(latestUserIndex === -1 ? messages : messages.slice(latestUserIndex)),
    responseMessage,
  ];
}

function shouldContinueFromLatestTool(message: UIMessage) {
  const lastToolIndex = message.parts.reduce(
    (latest, part, index) => (isToolUIPart(part) ? index : latest),
    -1,
  );
  if (lastToolIndex === -1) return false;

  return !message.parts
    .slice(lastToolIndex + 1)
    .some(
      (part) =>
        part.type === "text" &&
        part.text.trim().length > 0 &&
        !isSubAgentOutputTextPart(part),
    );
}

function toolRequirementRetry<TOOLS extends ToolSet>(
  violation: ToolCallRequirementViolation,
): GuardDecision<TOOLS> {
  if (violation.missingAnyOfTools && violation.missingAnyOfTools.length > 0) {
    const label = violation.prerequisiteLabel ?? "a required tool";
    return {
      action: "retry",
      guard: "tool_call_requirement",
      event: {
        kind: "tool_call_requirement",
        status: "retrying",
        title: "Tool prerequisite enforced",
        message: `Prompted the agent to call ${label} before ${violation.toolName}.`,
        reason: `The agent tried to call ${violation.toolName} before ${label}. Valid options: ${violation.missingAnyOfTools.join(", ")}.`,
      },
      retryInstruction: `Your previous response tried to call ${violation.toolName} too early. ${violation.instruction}`,
      toolChoice: "required" as ToolChoice<TOOLS>,
    };
  }

  const missingTools = violation.missingPreviousTools ?? [];
  const nextTool = missingTools[0];
  return {
    action: "retry",
    guard: "tool_call_requirement",
    event: {
      kind: "tool_call_requirement",
      status: "retrying",
      title: "Tool prerequisite enforced",
      message: `Prompted the agent to call ${nextTool} before ${violation.toolName}.`,
      reason: `The agent tried to call ${violation.toolName} before required previous tool calls: ${missingTools.join(", ")}.`,
    },
    retryInstruction: `Your previous response tried to call ${violation.toolName} too early. ${violation.instruction}`,
    toolChoice: {
      type: "tool",
      toolName: nextTool,
    } as ToolChoice<TOOLS>,
  };
}

// ─── Wrapped evaluation ───

export function evaluateAssistantStep<TOOLS extends ToolSet>({
  messages,
  responseMessage,
  targetCurrency,
}: {
  messages: UIMessage[];
  responseMessage: UIMessage;
  targetCurrency?: Currency;
}): GuardDecision<TOOLS> {
  if (targetCurrency) {
    const text = getMessageText(responseMessage);
    if (text && !hasToolCall(responseMessage, TOOL_NAMES.currency_conversion)) {
      const foreignMentions = detectForeignCurrencyMentions(
        stripCodeBlocksAndQuotes(text),
        targetCurrency,
      );
      if (foreignMentions.length > 0) {
        const currentTurnMessages = getCurrentTurnMessages(messages, responseMessage);
        const currencyToolAlreadyCalled = currentTurnMessages.some((message) =>
          hasToolCall(message, TOOL_NAMES.currency_conversion),
        );
        return {
          action: "retry",
          guard: "currency_conversion",
          event: {
            kind: "currency_conversion",
            status: "retrying",
            title: "Currency conversion enforced",
            message: `Convert all currencies to ${targetCurrency}.`,
            reason: foreignMentions[0],
          },
          retryInstruction: currencyToolAlreadyCalled
            ? `Your response still contains foreign currency amounts. Rewrite using only ${targetCurrency}. Do not include original foreign amounts, exchange rates, or ≈.`
            : `Convert all foreign currency amounts to ${targetCurrency}. Use the currency_conversion tool. Do not include original foreign amounts, exchange rates, or ≈. Reason: ${foreignMentions[0]}`,
        };
      }
    }
  }

  const toolRequirementViolation = evaluateToolCallRequirementForResponse({
    messages,
    responseMessage,
  });
  if (toolRequirementViolation) {
    return toolRequirementRetry(toolRequirementViolation);
  }

  const text = getMessageText(responseMessage);
  if (!text) return { action: "accept" };
  const userText = getLatestUserText(messages);
  const currentTurnMessages = getCurrentTurnMessages(messages, responseMessage);

  if (
    !hasToolCall(responseMessage, TOOL_NAMES.ask_questions) &&
    pkgAsksUserForInput(text)
  ) {
    return {
      action: "retry",
      guard: "question_tool",
      event: {
        kind: "question_tool",
        status: "retrying",
        title: "Question tool enforced",
        message: "Prompted the agent to ask this with the question tool.",
        reason: "The agent asked for user input in plain text.",
      },
      retryInstruction:
        "Your previous response asked the user for input in plain text. Convert that request into an ask_questions tool call now. Do not answer in plain text.",
      toolChoice: {
        type: "tool",
        toolName: TOOL_NAMES.ask_questions,
      } as ToolChoice<TOOLS>,
    };
  }

  if (shouldContinueFromLatestTool(responseMessage)) {
    return { action: "accept" };
  }

  if (!pkgIsResearchLikeRequest(userText)) return { action: "accept" };

  if (currentTurnMessages.some(hasResearchCheckpoint)) {
    return { action: "accept" };
  }

  if (!currentTurnMessages.some(hasDeepResearchToolCall)) {
    return {
      action: "retry",
      guard: "research_checkpoint",
      event: {
        kind: "research_checkpoint",
        status: "retrying",
        title: "Research depth reminder",
        message:
          "Prompted the agent to consider whether more research is needed.",
        reason: "The answer did not show enough research tool use.",
      },
      retryInstruction:
        "Your previous response answered a research-like request without showing research. Reconsider whether you searched deeply enough. If more evidence would materially improve the answer, use search and page-reading tools before answering. You may call research_checkpoint for plain-text guidance when ready.",
      toolChoice: "required" as ToolChoice<TOOLS>,
    };
  }

  return {
    action: "retry",
    guard: "research_checkpoint",
    event: {
      kind: "research_checkpoint",
      status: "retrying",
      title: "Research checkpoint guidance",
      message: "Prompted the agent to get advisory checkpoint guidance.",
      reason: "The answer did not include a research checkpoint.",
    },
    retryInstruction:
      "Before finalizing this research answer, call research_checkpoint once for plain-text guidance. Use the guidance to decide whether further research would materially improve the answer; do not wait for an approval status.",
    toolChoice: {
      type: "tool",
      toolName: RESEARCH_CHECKPOINT_TOOL,
    } as ToolChoice<TOOLS>,
  };
}
