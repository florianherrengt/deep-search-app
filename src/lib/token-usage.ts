import type { UIMessage } from "ai";

interface TokenUsageData {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

const CHARS_PER_TOKEN = 4;

function extractPartText(part: unknown): string {
  if (typeof part !== "object" || part === null) return "";
  const p = part as Record<string, unknown>;

  if (p.type === "text" && typeof p.text === "string") return p.text;
  if (p.type === "reasoning" && typeof p.text === "string") return p.text;
  if (
    typeof p.type === "string" &&
    (p.type as string).startsWith("tool-")
  ) {
    const args = JSON.stringify(p.args ?? "");
    const result = JSON.stringify(p.result ?? "");
    return args + result;
  }
  if (
    typeof p.type === "string" &&
    (p.type as string).startsWith("data-") &&
    typeof p.data === "object"
  ) {
    return JSON.stringify(p.data ?? "");
  }
  return "";
}

export function estimateMessageTokens(messages: UIMessage[]): number {
  let totalChars = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      totalChars += extractPartText(part).length;
    }
  }
  const overhead = messages.length * 4;
  return Math.ceil((totalChars + overhead) / CHARS_PER_TOKEN);
}

export function getLatestTokenUsage(
  messages: UIMessage[],
): TokenUsageData | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;

    for (let j = message.parts.length - 1; j >= 0; j--) {
      const part = message.parts[j] as Record<string, unknown>;
      if (
        part.type === "data-token_usage" &&
        typeof part.data === "object" &&
        part.data !== null &&
        "inputTokens" in part.data &&
        typeof (part.data as Record<string, unknown>).inputTokens === "number"
      ) {
        return part.data as TokenUsageData;
      }
    }
  }
  return undefined;
}

export function getCurrentTokenCount(messages: UIMessage[]): number {
  const providerUsage = getLatestTokenUsage(messages);
  if (providerUsage && providerUsage.inputTokens > 0) {
    return providerUsage.inputTokens;
  }
  return estimateMessageTokens(messages);
}
