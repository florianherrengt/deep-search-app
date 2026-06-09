import type { UIMessage } from "ai";
import { isRecord } from "@/lib/json";

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
