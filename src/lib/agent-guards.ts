import {
  isToolUIPart,
  type ToolChoice,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  evaluateToolCallRequirementForResponse,
  type ToolCallRequirementViolation,
} from "@/lib/tool-call-requirements";
import { TOOL_NAMES } from "@/lib/tool-names";
import { CURRENCIES, type Currency } from "@/lib/settings-store";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";
import getSymbolFromCurrency from "currency-symbol-map";

/**
 * Map currency symbols (e.g. "$", "€") to ISO 4217 codes.
 * Built by inverting the currency-symbol-map library, which provides ~187
 * code → symbol entries. The hand-rolled version covered only 16 of the 31
 * currencies users can pick in settings, so a user with target = "AED"
 * could not detect "د.إ 100" mentions.
 *
 * Symbols that map to multiple codes (e.g. "$" → USD/CAD/AUD/MXN/etc.)
 * are represented as a comma-separated list, and the matcher below
 * expands them into individual patterns.
 */
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

const researchSourceSchema = z.object({
  url: z.string().min(1),
  title: z.string().optional(),
  sourceType: z.enum(["primary", "secondary", "forum", "unknown"]).optional(),
  date: z.string().optional(),
});

export const researchCheckpointInputSchema = z.object({
  originalQuestion: z.string().min(1),
  searchesRun: z.array(z.string().min(1)),
  sourcesOpened: z.array(researchSourceSchema),
  claimsVerified: z.array(z.string().min(1)),
  unresolvedQuestions: z.array(z.string().min(1)),
  confidence: z.enum(["low", "medium", "high"]),
  readyToAnswer: z.boolean(),
});

export const researchCheckpointResultSchema = z.string().min(1);

export type ResearchCheckpointInput = z.infer<
  typeof researchCheckpointInputSchema
>;
export type ResearchCheckpointResult = z.infer<
  typeof researchCheckpointResultSchema
>;

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

const QUESTION_STARTERS = [
  "what",
  "which",
  "who",
  "when",
  "where",
  "why",
  "how",
  "can you",
  "could you",
  "would you",
  "do you",
  "did you",
  "are you",
  "should i",
  "should we",
  "may i",
];

const REQUEST_PATTERNS = [
  /\bplease\s+provide\b/i,
  /\bplease\s+confirm\b/i,
  /\blet me know\b/i,
  /\btell me\b/i,
  /\bi need your\b/i,
  /\bbefore i continue\b/i,
  /\bto proceed\b/i,
  /\bcan you share\b/i,
  /\bcould you share\b/i,
  /\bshare your\b/i,
  /\bsend me\b/i,
];

const RESEARCH_KEYWORDS = [
  "latest",
  "current",
  "recent",
  "today",
  "news",
  "research",
  "investigate",
  "find",
  "search",
  "source",
  "sources",
  "cite",
  "verify",
  "compare",
  "best",
  "recommend",
  "recommendation",
  "review",
  "price",
  "cost",
  "market",
  "legal",
  "law",
  "regulation",
  "medical",
  "financial",
  "travel",
  "map",
  "directions",
];

const RESEARCH_TOOL_NAMES = new Set<string>([
  TOOL_NAMES.brave_search,
  TOOL_NAMES.exa_search,
  TOOL_NAMES.serper_search,
  TOOL_NAMES.tavily_search,
  TOOL_NAMES.searxng_search,
  TOOL_NAMES.extract_page_content,
  TOOL_NAMES.create_file,
]);

const RESEARCH_CHECKPOINT_TOOL = TOOL_NAMES.research_checkpoint;

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
    pattern:
      "(?:(?:u\\.?s\\.?|american|canadian|australian|new zealand|singapore|hong kong)\\s+)?dollars?",
    codes: ["USD", "CAD", "AUD", "NZD", "SGD", "HKD"],
  },
  { pattern: "euros?", codes: ["EUR"] },
  { pattern: "(?:british\\s+pounds?|pounds?\\s+sterling|sterling)", codes: ["GBP"] },
  { pattern: "yen", codes: ["JPY"] },
  { pattern: "yuan", codes: ["CNY"] },
  { pattern: "rupees?", codes: ["INR"] },
  { pattern: "francs?", codes: ["CHF"] },
];

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

function detectForeignCurrencyMentions(
  text: string,
  targetCurrency: Currency,
): string[] {
  const matches = new Set<string>();

  for (const [symbol, codes] of Object.entries(CURRENCY_SYMBOL_TO_CODES)) {
    if (codes.split(", ").includes(targetCurrency)) continue;
    const symbolPattern = currencySymbolPattern(symbol);
    if (!symbolPattern) continue;
    for (const m of text.matchAll(symbolPattern)) {
      matches.add(`${m[0]} (${codes})`);
    }
  }

  for (const m of text.matchAll(CURRENCY_CODE_PATTERN)) {
    const code = (m[1] || m[2]).toUpperCase();
    if (code !== targetCurrency) {
      matches.add(m[0]);
    }
  }

  for (const { pattern, codes } of CURRENCY_NAME_PATTERNS) {
    if (codes.includes(targetCurrency)) continue;
    const currencyNamePattern = new RegExp(
      `\\b${AMOUNT_WORD_PATTERN}\\s+(?:${pattern})\\b`,
      "gi",
    );
    for (const m of text.matchAll(currencyNamePattern)) {
      matches.add(`${m[0]} (${codes.join(", ")})`);
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

function normalizeForDetection(text: string) {
  return stripCodeBlocksAndQuotes(text)
    .replace(/\bwhy\?\s+because\b/gi, "because")
    .split("\n")
    .filter((line) => !/^\s*(open\s+)?questions?\s*:/i.test(line))
    .join("\n")
    .toLowerCase();
}

export function asksUserForInput(text: string): boolean {
  const normalized = normalizeForDetection(text);
  if (!normalized.trim()) return false;

  if (/\bthe question is\b/.test(normalized)) return false;

  const userDirected = /\b(you|your|you'd|you'll|yourself)\b/i.test(normalized);
  const questionSentences = normalized.match(
    /(?:^|[.!?]\s+|\n\s*)[^.!?\n]{1,260}\?/g,
  );
  const starterPattern = new RegExp(
    `^\\s*(${QUESTION_STARTERS.map(escapeRegex).join("|")})\\b`,
    "i",
  );
  const startsLikeQuestion = (questionSentences ?? []).some((sentence) => {
    const trimmed = sentence.replace(/^[.!?]\s+/, "").trim();
    return (
      starterPattern.test(trimmed) &&
      (/\b(you|your|you'd|you'll|yourself)\b/i.test(trimmed) ||
        /\b(should|could|can|may)\s+i\b/i.test(trimmed) ||
        /\bshould\s+we\b/i.test(trimmed))
    );
  });

  if (startsLikeQuestion) return true;

  const requestsInput = REQUEST_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
  const choiceNeedsReply =
    /(?:^|[.!?]\s+|\n\s*)(?:please\s+)?(?:choose|pick)\b[\s\S]{0,120}\b(?:before i continue|to proceed|so i can|then i can|and i(?:'ll| will| can))\b/i.test(
      normalized,
    );
  const strongImperativeRequest =
    /\bplease\s+(provide|confirm)\b/i.test(normalized) ||
    /\b(let me know|tell me|before i continue|to proceed)\b/i.test(normalized);

  return (
    choiceNeedsReply ||
    (requestsInput && (userDirected || strongImperativeRequest))
  );
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

export function isResearchLikeRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(hi|hello|thanks|thank you|ok|okay)\b/.test(normalized)) return false;

  if (RESEARCH_KEYWORDS.some((word) => normalized.includes(word))) return true;

  return (
    normalized.length >= 40 &&
    /^(what|who|when|where|why|how|which)\b/.test(normalized)
  );
}

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

export function evaluateAssistantStep<TOOLS extends ToolSet>({
  messages,
  responseMessage,
  targetCurrency,
}: {
  messages: UIMessage[];
  responseMessage: UIMessage;
  targetCurrency?: Currency;
}): GuardDecision<TOOLS> {
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
    asksUserForInput(text)
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

  if (
    targetCurrency &&
    !hasToolCall(responseMessage, TOOL_NAMES.currency_conversion)
  ) {
    const foreignMentions = detectForeignCurrencyMentions(
      stripCodeBlocksAndQuotes(text),
      targetCurrency,
    );
    if (foreignMentions.length > 0) {
      const conversionNeed = formatCurrencyConversionNeed(
        foreignMentions,
        targetCurrency,
      );
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
          message: conversionNeed,
          reason: `Foreign currency amounts found: ${foreignMentions.join(", ")}. Target currency: ${targetCurrency}. ${conversionNeed}`,
        },
        retryInstruction: currencyToolAlreadyCalled
          ? `Your response still contains foreign currency amounts. ${conversionNeed} You have already used currency_conversion in this turn; rewrite the answer using only ${targetCurrency} amounts. Do not include the original foreign amounts, exchange rates, or ≈.`
          : `Your response contains foreign currency amounts. ${conversionNeed} Use the currency_conversion tool before responding. In the final answer, show only ${targetCurrency} amounts; do not include the original foreign amounts, exchange rates, or ≈.`,
        ...(currencyToolAlreadyCalled
          ? {}
          : { toolChoice: "required" as ToolChoice<TOOLS> }),
      };
    }
  }

  if (shouldContinueFromLatestTool(responseMessage)) {
    return { action: "accept" };
  }

  if (!isResearchLikeRequest(userText)) return { action: "accept" };

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

  if (!currentTurnMessages.some(hasResearchCheckpoint)) {
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

  return { action: "accept" };
}

function toolRequirementRetry<TOOLS extends ToolSet>(
  violation: ToolCallRequirementViolation,
): GuardDecision<TOOLS> {
  const nextTool = violation.missingPreviousTools[0];
  return {
    action: "retry",
    guard: "tool_call_requirement",
    event: {
      kind: "tool_call_requirement",
      status: "retrying",
      title: "Tool prerequisite enforced",
      message: `Prompted the agent to call ${nextTool} before ${violation.toolName}.`,
      reason: `The agent tried to call ${violation.toolName} before required previous tool calls: ${violation.missingPreviousTools.join(", ")}.`,
    },
    retryInstruction: `Your previous response tried to call ${violation.toolName} too early. ${violation.instruction}`,
    toolChoice: {
      type: "tool",
      toolName: nextTool,
    } as ToolChoice<TOOLS>,
  };
}

function formatCurrencyConversionNeed(
  mentions: string[],
  targetCurrency: Currency,
) {
  return `Convert ${formatList(mentions)} to ${targetCurrency}.`;
}

function formatList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
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

function validateResearchCheckpoint(
  input: ResearchCheckpointInput,
): ResearchCheckpointResult {
  const guidance: string[] = [];

  if (!input.readyToAnswer) {
    guidance.push("You marked the research as not ready to answer.");
  }

  if (input.searchesRun.length === 0) {
    guidance.push(
      "Run at least one real search query before relying on the answer.",
    );
  }

  if (input.sourcesOpened.length < 2) {
    guidance.push(
      "Open and inspect more than one relevant source when the topic depends on external facts.",
    );
  }

  if (input.claimsVerified.length < 2) {
    guidance.push(
      "List the key claims you verified, especially dates, prices, numbers, and source-specific facts.",
    );
  }

  if (input.unresolvedQuestions.length > 0) {
    guidance.push(
      `Resolve or explicitly disclose these open questions: ${input.unresolvedQuestions.join("; ")}.`,
    );
  }

  if (input.confidence === "low") {
    guidance.push(
      "Confidence is low; do more research or make the uncertainty prominent in the final answer.",
    );
  }

  if (guidance.length === 0) {
    return "Research checkpoint guidance: You appear ready to answer. Synthesize the verified claims, cite the sources you opened, and state any residual uncertainty.";
  }

  return `Research checkpoint guidance:\n${guidance.map((item) => `- ${item}`).join("\n")}`;
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

export async function reviewResearchCheckpoint(
  input: ResearchCheckpointInput,
  judge?: (input: ResearchCheckpointInput) => Promise<ResearchCheckpointResult>,
): Promise<ResearchCheckpointResult> {
  const fallbackGuidance = validateResearchCheckpoint(input);
  if (!judge) return fallbackGuidance;

  try {
    const guidance = researchCheckpointResultSchema.parse(await judge(input));
    return guidance.trim() || fallbackGuidance;
  } catch {
    return fallbackGuidance;
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
