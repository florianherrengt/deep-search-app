import type { UIMessage } from "ai";
import { isRecord } from "@/lib/json";
import { TOOL_NAMES } from "@/lib/tool-names";

export function getResearchChatRecallFolders(
  messages: readonly UIMessage[],
): Set<string> {
  const folders = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isRecord(part)) continue;
      const toolPart = part as Record<string, unknown>;
      if (toolPart.type !== `tool-${TOOL_NAMES.search_research}`) {
        continue;
      }
      const output = Array.isArray(toolPart.output)
        ? toolPart.output
        : Array.isArray(toolPart.result)
          ? toolPart.result
          : [];

      for (const result of output) {
        if (!isRecord(result)) continue;
        const isResearchChat =
          result.result_type === "research_chat" ||
          (result.result_type == null && typeof result.folder_name === "string");
        if (isResearchChat && typeof result.folder_name === "string") {
          folders.add(result.folder_name);
        }
      }
    }
  }

  return folders;
}

export function getContinuationFoldersOffered(message: UIMessage): string[] {
  const folders = new Set<string>();

  for (const part of message.parts) {
    if (!isRecord(part)) continue;
    const toolPart = part as Record<string, unknown>;
    if (toolPart.type !== `tool-${TOOL_NAMES.ask_questions}`) {
      continue;
    }
    for (const folder of getResearchContinuationCandidates(toolPart.input)
      .folders) {
      folders.add(folder);
    }
  }

  return [...folders];
}

export function getAuthorizedResearchFolderSwitches(
  messages: readonly UIMessage[],
): Set<string> {
  const currentTurnMessages = getCurrentTurnMessages(messages);
  const recalledFolders = getResearchChatRecallFolders(currentTurnMessages);
  const authorizedFolders = new Set<string>();

  for (const message of currentTurnMessages) {
    for (const part of message.parts) {
      if (!isRecord(part)) continue;
      const toolPart = part as Record<string, unknown>;
      if (toolPart.type !== `tool-${TOOL_NAMES.ask_questions}`) continue;
      if (toolPart.state !== "output-available") continue;
      if (!isRecord(toolPart.output) || !Array.isArray(toolPart.output.answers)) {
        continue;
      }
      const offeredFolders = getResearchContinuationCandidates(toolPart.input).folders;
      if (offeredFolders.size === 0) continue;

      for (const answer of toolPart.output.answers) {
        if (!isRecord(answer) || typeof answer.answer !== "string") continue;
        if (!answer.answer.startsWith("continue:")) continue;
        const folder = answer.answer.slice("continue:".length).trim();
        if (offeredFolders.has(folder) && recalledFolders.has(folder)) {
          authorizedFolders.add(folder);
        }
      }
    }
  }

  return authorizedFolders;
}

function getCurrentTurnMessages(messages: readonly UIMessage[]) {
  const latestUserIndex = messages.reduce(
    (latest, message, index) => (message.role === "user" ? index : latest),
    -1,
  );
  return latestUserIndex === -1 ? messages : messages.slice(latestUserIndex);
}

export function getResearchContinuationCandidates(input: unknown): {
  folders: Set<string>;
  allowsNew: boolean;
} {
  const folders = new Set<string>();
  let allowsNew = false;
  if (!isRecord(input) || !Array.isArray(input.questions)) {
    return { folders, allowsNew };
  }

  for (const question of input.questions) {
    if (!isRecord(question) || !Array.isArray(question.candidates)) continue;
    for (const candidate of question.candidates) {
      if (!isRecord(candidate) || typeof candidate.value !== "string") continue;
      if (candidate.value === "new") {
        allowsNew = true;
        continue;
      }
      if (!candidate.value.startsWith("continue:")) continue;
      const folder = candidate.value.slice("continue:".length).trim();
      if (folder) folders.add(folder);
    }
  }

  return { folders, allowsNew };
}
