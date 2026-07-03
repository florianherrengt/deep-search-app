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
  });

export type DeepSearchRequest = z.infer<typeof deepSearchRequestSchema>;

export type DeepSearchResponse =
  | { session_id: string; status: "running" }
  | { session_id: string; status: "questions"; questions: DeepSearchQuestion[] }
  | { session_id: string; status: "done"; result: string }
  | { session_id: string; status: "failed"; error: string }
  | { session_id: string; status: "cancelled" };

export interface DeepSearchQuestion {
  text: string;
  options?: string[];
}

interface PendingQuestionsPart {
  type: "tool-ask_questions";
  state: "input-available";
  input?: unknown;
}

export function createUserMessage(text: string): UIMessage {
  return {
    id: `user-${crypto.randomUUID()}`,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

export function getPendingDeepSearchQuestions(
  messages: UIMessage[],
): DeepSearchQuestion[] {
  const part = getLatestPendingQuestionsPart(messages);
  if (!part) return [];

  const input = part.input;
  if (!isRecord(input) || !Array.isArray(input.questions)) return [];

  return input.questions.flatMap((question) => {
    if (!isRecord(question) || typeof question.question !== "string") {
      return [];
    }

    const options = Array.isArray(question.candidates)
      ? question.candidates.flatMap((candidate) => {
          if (!isRecord(candidate) || typeof candidate.value !== "string") {
            return [];
          }
          return [candidate.value];
        })
      : [];

    return [
      {
        text: question.question,
        ...(options.length > 0 ? { options } : {}),
      },
    ];
  });
}

export function answerPendingDeepSearchQuestions(
  messages: UIMessage[],
  answers: string[],
): UIMessage[] {
  const target = findLatestPendingQuestionsPart(messages);
  if (!target) {
    throw new Error("No pending questions for this research session.");
  }

  const input = target.part.input;
  if (!isRecord(input) || !Array.isArray(input.questions)) {
    throw new Error("Pending questions are malformed.");
  }

  const outputAnswers = input.questions.flatMap((question, index) => {
    if (!isRecord(question) || typeof question.question !== "string") return [];
    const answer = answers[index]?.trim();
    if (!answer) return [];
    return [{ question: question.question, answer }];
  });

  if (outputAnswers.length === 0) {
    throw new Error("At least one answer is required.");
  }

  return messages.map((message, messageIndex) => {
    if (messageIndex !== target.messageIndex) return message;

    return {
      ...message,
      parts: message.parts.map((part, partIndex) => {
        if (partIndex !== target.partIndex) return part;

        return {
          ...part,
          state: "output-available",
          output: { answers: outputAnswers },
        } as UIMessage["parts"][number];
      }),
    };
  });
}

export function getDeepSearchResultText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    const text = message.parts
      .flatMap((part) => {
        if (part.type !== "text") return [];
        if (isSubAgentOutputTextPart(part)) return [];
        return [part.text];
      })
      .join("")
      .trim();

    if (text) return text;
  }

  return "";
}

function getLatestPendingQuestionsPart(messages: UIMessage[]) {
  return findLatestPendingQuestionsPart(messages)?.part ?? null;
}

function findLatestPendingQuestionsPart(messages: UIMessage[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") continue;

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex];
      if (!isRecord(part) || part.type !== "tool-ask_questions") continue;
      if (part.state !== "input-available") continue;
      return {
        messageIndex,
        partIndex,
        part: part as unknown as PendingQuestionsPart,
      };
    }
  }

  return null;
}
