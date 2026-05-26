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

export const guardrailEventSchema = z.object({
  kind: z.enum([
    "question_tool",
    "research_checkpoint",
    "tool_call_requirement",
  ]),
  status: z.enum(["retrying", "warning", "passed"]),
  title: z.string(),
  message: z.string(),
  reason: z.string().optional(),
  attempt: z.number().optional(),
});

export type GuardrailEvent = z.infer<typeof guardrailEventSchema>;

export const researchSourceSchema = z.object({
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

export const researchCheckpointResultSchema = z.object({
  approved: z.boolean(),
  severity: z.enum(["none", "minor", "major"]),
  visibleSummary: z.string(),
  missingAngles: z.array(z.string()),
  weakClaims: z.array(z.string()),
  requiredNextActions: z.array(z.string()),
});

export type ResearchCheckpointInput = z.infer<
  typeof researchCheckpointInputSchema
>;
export type ResearchCheckpointResult = z.infer<
  typeof researchCheckpointResultSchema
>;

export type GuardName =
  | "question_tool"
  | "research_checkpoint"
  | "tool_call_requirement";

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
  /\bchoose\b/i,
  /\bpick\b/i,
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

const RESEARCH_TOOL_NAMES = new Set([
  "brave_search",
  "exa_search",
  "serper_search",
  "tavily_search",
  "searxng_search",
  "extract_page_content",
  "save_research_file",
]);

const RESEARCH_CHECKPOINT_TOOL = "research_checkpoint";

export function stripCodeBlocksAndQuotes(text: string) {
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

  const userDirected = /\b(you|your|you'd|you'll|yourself)\b/i.test(
    normalized,
  );
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
  const strongImperativeRequest =
    /\bplease\s+(provide|confirm)\b/i.test(normalized) ||
    /\b(let me know|tell me|before i continue|to proceed)\b/i.test(
      normalized,
    );

  return requestsInput && (userDirected || strongImperativeRequest);
}

export function getMessageText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function getLatestUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return getMessageText(message);
  }
  return "";
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

export function getToolNameFromPart(part: UIMessage["parts"][number]) {
  if (!isToolUIPart(part)) return null;
  return part.type.slice("tool-".length);
}

export function hasToolCall(message: UIMessage, toolName: string) {
  return message.parts.some((part) => getToolNameFromPart(part) === toolName);
}

export function hasDeepResearchToolCall(message: UIMessage) {
  return message.parts.some((part) => {
    const name = getToolNameFromPart(part);
    return name ? RESEARCH_TOOL_NAMES.has(name) : false;
  });
}

export function hasApprovedResearchCheckpoint(message: UIMessage) {
  return message.parts.some((part) => {
    if (getToolNameFromPart(part) !== RESEARCH_CHECKPOINT_TOOL) return false;
    if (!("state" in part) || part.state !== "output-available") return false;
    return isApprovedCheckpointOutput(part.output);
  });
}

export function hasRejectedResearchCheckpoint(message: UIMessage) {
  return message.parts.some((part) => {
    if (getToolNameFromPart(part) !== RESEARCH_CHECKPOINT_TOOL) return false;
    if (!("state" in part) || part.state !== "output-available") return false;
    return isResearchCheckpointOutput(part.output) && !part.output.approved;
  });
}

export function evaluateAssistantStep<TOOLS extends ToolSet>({
  messages,
  responseMessage,
}: {
  messages: UIMessage[];
  responseMessage: UIMessage;
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

  if (!hasToolCall(responseMessage, "ask_questions") && asksUserForInput(text)) {
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
      toolChoice: { type: "tool", toolName: "ask_questions" } as ToolChoice<TOOLS>,
    };
  }

  if (shouldContinueFromLatestTool(responseMessage)) {
    return { action: "accept" };
  }

  const userText = getLatestUserText(messages);
  if (!isResearchLikeRequest(userText)) return { action: "accept" };

  const currentTurnMessages = getCurrentTurnMessages(messages, responseMessage);

  if (currentTurnMessages.some(hasApprovedResearchCheckpoint)) {
    return { action: "accept" };
  }

  if (!currentTurnMessages.some(hasDeepResearchToolCall)) {
    return {
      action: "retry",
      guard: "research_checkpoint",
      event: {
        kind: "research_checkpoint",
        status: "retrying",
        title: "Research depth enforced",
        message: "Prompted the agent to research before answering.",
        reason: "The answer did not show enough research tool use.",
      },
      retryInstruction:
        "Your previous response answered a research-like request without enough research. Continue with search and page-reading tools before answering. When ready, call research_checkpoint.",
      toolChoice: "required" as ToolChoice<TOOLS>,
    };
  }

  if (
    !currentTurnMessages.some((message) =>
      hasToolCall(message, RESEARCH_CHECKPOINT_TOOL),
    ) ||
    currentTurnMessages.some(hasRejectedResearchCheckpoint)
  ) {
    return {
      action: "retry",
      guard: "research_checkpoint",
      event: {
        kind: "research_checkpoint",
        status: "retrying",
        title: "Research checkpoint enforced",
        message: "Prompted the agent to run a research checkpoint.",
        reason: "The answer did not include an approved research checkpoint.",
      },
      retryInstruction:
        "Before finalizing this research answer, call research_checkpoint with the searches, opened sources, verified claims, unresolved questions, confidence, and readiness.",
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

function getCurrentTurnMessages(messages: UIMessage[], responseMessage: UIMessage) {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  return [
    ...(latestUserIndex === -1 ? messages : messages.slice(latestUserIndex)),
    responseMessage,
  ];
}

export function validateResearchCheckpoint(
  input: ResearchCheckpointInput,
): ResearchCheckpointResult {
  if (!input.readyToAnswer) {
    return rejection("major", "Research checkpoint needs more work.", [
      "Continue researching until readyToAnswer is true.",
    ]);
  }

  if (input.searchesRun.length === 0) {
    return rejection("major", "Research checkpoint needs search evidence.", [
      "Run at least one real search query.",
    ]);
  }

  if (input.sourcesOpened.length < 2) {
    return rejection("major", "Research checkpoint needs more sources.", [
      "Open and inspect at least two relevant sources.",
    ]);
  }

  if (input.claimsVerified.length < 2) {
    return rejection("major", "Research checkpoint needs verified claims.", [
      "Verify the key claims that will appear in the answer.",
    ]);
  }

  if (input.unresolvedQuestions.length > 0) {
    return rejection(
      "major",
      "Research checkpoint still has unresolved questions.",
      input.unresolvedQuestions,
    );
  }

  if (input.confidence === "low") {
    return rejection("major", "Research checkpoint confidence is too low.", [
      "Continue research until confidence is medium or high.",
    ]);
  }

  return {
    approved: true,
    severity: "none",
    visibleSummary: "Research checkpoint passed.",
    missingAngles: [],
    weakClaims: [],
    requiredNextActions: [],
  };
}

function shouldContinueFromLatestTool(message: UIMessage) {
  let lastToolIndex = -1;
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    if (isToolUIPart(message.parts[index])) {
      lastToolIndex = index;
      break;
    }
  }

  if (lastToolIndex === -1) return false;

  return !message.parts
    .slice(lastToolIndex + 1)
    .some((part) => part.type === "text" && part.text.trim().length > 0);
}

export async function reviewResearchCheckpoint(
  input: ResearchCheckpointInput,
  judge?: (
    input: ResearchCheckpointInput,
  ) => Promise<ResearchCheckpointResult>,
): Promise<ResearchCheckpointResult> {
  const deterministic = validateResearchCheckpoint(input);
  if (!deterministic.approved) return deterministic;
  if (!judge) return deterministic;

  try {
    return researchCheckpointResultSchema.parse(await judge(input));
  } catch {
    return {
      approved: true,
      severity: "minor",
      visibleSummary:
        "Research checkpoint passed basic checks; judge review was unavailable.",
      missingAngles: [],
      weakClaims: [],
      requiredNextActions: [],
    };
  }
}

function rejection(
  severity: "minor" | "major",
  visibleSummary: string,
  requiredNextActions: string[],
): ResearchCheckpointResult {
  return {
    approved: false,
    severity,
    visibleSummary,
    missingAngles: [],
    weakClaims: [],
    requiredNextActions,
  };
}

function isResearchCheckpointOutput(
  output: unknown,
): output is ResearchCheckpointResult {
  return researchCheckpointResultSchema.safeParse(output).success;
}

function isApprovedCheckpointOutput(output: unknown) {
  return isResearchCheckpointOutput(output) && output.approved;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
