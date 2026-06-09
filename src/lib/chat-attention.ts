import type { UIMessage } from "ai";

export function hasPendingQuestionTool(messages: UIMessage[]) {
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(isPendingQuestionToolPart),
  );
}

function isPendingQuestionToolPart(part: UIMessage["parts"][number]) {
  if (!isRecord(part) || part.type !== "tool-ask_questions") return false;

  return part.state === "input-available";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
