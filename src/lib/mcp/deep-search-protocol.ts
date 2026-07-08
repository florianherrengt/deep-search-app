import type { UIMessage } from "ai";
import { z } from "zod";
import { isRecord } from "@/lib/json";
import { isSubAgentOutputTextPart } from "@/lib/sub-agent-stream";

export const deepSearchRequestSchema = z
  .object({
    question: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    answers: z.array(z.string()).optional(),
    cancel: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.question || value.session_id), {
    message: "Provide either question or session_id.",
  })
  .refine((value) => !(value.question && value.answers), {
    message: "Provide question or answers, not both.",
  });

export type DeepSearchRequest = z.infer<typeof deepSearchRequestSchema>;

export type DeepSearchResponse =
  | { session_id: string; status: "running" }
  | { session_id: string; status: "done"; result: string }
  | { session_id: string; status: "failed"; error: string }
  | { session_id: string; status: "cancelled" };

interface PendingQuestionsPart {
  type: "tool-ask_questions";
  state: "input-available";
  input?: unknown;
}

const SKIPPED_QUESTION_ANSWER =
  "Skipped by the Deep Search MCP runner. Continue with reasonable assumptions and answer the original request without asking more questions.";

export function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${crypto.randomUUID()}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

export function skipPendingDeepSearchQuestions(messages: UIMessage[]): {
  messages: UIMessage[];
  skipped: boolean;
} {
  let skipped = false;

  const nextMessages = messages.map((message) => {
    if (message.role !== "assistant") return message;

    let messageSkipped = false;
    const nextParts = message.parts.map((part) => {
      if (!isPendingQuestionsPart(part)) return part;

      skipped = true;
      messageSkipped = true;
      return {
        ...part,
        state: "output-available",
        output: createSkippedQuestionsOutput(part.input),
      } as UIMessage["parts"][number];
    });

    return messageSkipped ? { ...message, parts: nextParts } : message;
  });

  return skipped
    ? { messages: nextMessages, skipped: true }
    : { messages, skipped: false };
}

export function getDeepSearchResultText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    const text = getAssistantResultText(message);

    if (text) return text;
  }

  return "";
}

export function normalizeDeepSearchAssistantMessage(message: UIMessage): UIMessage {
  if (message.role !== "assistant") return message;
  if (!message.parts.some(isGuardrailEventPart)) return message;

  const parts = getLatestAssistantStepParts(message.parts);
  if (parts === message.parts) return message;

  return { ...message, parts };
}

function getAssistantResultText(message: UIMessage): string {
  return getLatestAssistantStepParts(message.parts)
    .flatMap((part) => {
      if (part.type !== "text") return [];
      if (isSubAgentOutputTextPart(part)) return [];
      return [part.text];
    })
    .join("")
    .trim();
}

function getLatestAssistantStepParts(parts: UIMessage["parts"]) {
  const lastStepStartIndex = parts.reduce(
    (found, part, index) => (part.type === "step-start" ? index : found),
    -1,
  );
  if (lastStepStartIndex === -1) return parts;

  const latestStepParts = parts.slice(lastStepStartIndex);
  const hasVisibleText = latestStepParts.some((part) => {
    if (part.type !== "text") return false;
    if (isSubAgentOutputTextPart(part)) return false;
    return part.text.trim().length > 0;
  });

  return hasVisibleText ? latestStepParts : parts;
}

function isGuardrailEventPart(part: UIMessage["parts"][number]): boolean {
  return isRecord(part) && part.type === "data-guardrail_event";
}

function isPendingQuestionsPart(
  part: UIMessage["parts"][number],
): part is UIMessage["parts"][number] & PendingQuestionsPart {
  return (
    isRecord(part) &&
    part.type === "tool-ask_questions" &&
    part.state === "input-available"
  );
}

function createSkippedQuestionsOutput(input: unknown) {
  const questions = getQuestionTexts(input);

  return {
    skipped: true,
    reason:
      "MCP sessions do not pause for clarification questions. The research agent must continue with reasonable assumptions.",
    ...(questions.length > 0
      ? {
          answers: questions.map((question) => ({
            question,
            answer: SKIPPED_QUESTION_ANSWER,
          })),
        }
      : {}),
  };
}

function getQuestionTexts(input: unknown): string[] {
  if (!isRecord(input) || !Array.isArray(input.questions)) return [];

  return input.questions.flatMap((question) => {
    if (!isRecord(question) || typeof question.question !== "string") {
      return [];
    }

    const text = question.question.trim();
    return text ? [text] : [];
  });
}
