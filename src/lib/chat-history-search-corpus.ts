import type { UIMessage } from "ai";
import { isRecord } from "@/lib/json";
import {
  listResearchChats,
  listResearchFolders,
  readResearchChatMessages,
  type ResearchChatSummary,
  type ResearchFolder,
} from "@/lib/research-history";
import type { ChatHistorySearchRecord } from "@/lib/chat-history-search-index";

interface ChatHistoryCorpusDependencies {
  listResearchFolders: () => Promise<ResearchFolder[]>;
  listResearchChats: (folderName: string) => Promise<ResearchChatSummary[]>;
  readResearchChatMessages: (
    folderName: string,
    chatId: string,
  ) => Promise<UIMessage[]>;
}

const DEFAULT_DEPENDENCIES: ChatHistoryCorpusDependencies = {
  listResearchFolders,
  listResearchChats,
  readResearchChatMessages,
};

export async function loadChatHistorySearchRecords(
  dependencies: ChatHistoryCorpusDependencies = DEFAULT_DEPENDENCIES,
): Promise<ChatHistorySearchRecord[]> {
  const folders = await dependencies.listResearchFolders();
  const records = await Promise.all(
    folders.map(async (folder) => {
      try {
        const chats = await dependencies.listResearchChats(folder.name);
        const chatRecords = await Promise.all(
          chats.map(async (chat) => {
            try {
              const messages = await dependencies.readResearchChatMessages(
                folder.name,
                chat.id,
              );
              return createChatHistorySearchRecords(folder.name, chat, messages);
            } catch (error) {
              console.warn("[chat-history-search] failed to read chat", {
                folderName: folder.name,
                chatId: chat.id,
                error: error instanceof Error ? error.message : "unknown",
              });
              return [];
            }
          }),
        );
        return chatRecords.flat();
      } catch (error) {
        console.warn("[chat-history-search] failed to list folder chats", {
          folderName: folder.name,
          error: error instanceof Error ? error.message : "unknown",
        });
        return [];
      }
    }),
  );

  return records.flat();
}

export function createChatHistorySearchRecords(
  folderName: string,
  chat: ResearchChatSummary,
  messages: UIMessage[],
): ChatHistorySearchRecord[] {
  const title = chat.title.trim();
  const updatedAt = chat.updatedAt ?? chat.createdAt;
  const records: ChatHistorySearchRecord[] = title
    ? [
        {
          id: JSON.stringify([folderName, chat.id, "title"]),
          folderName,
          chatId: chat.id,
          title: chat.title,
          query: title,
          updatedAt,
        },
      ]
    : [];

  messages.forEach((message, messageIndex) => {
    if (message.role === "user") {
      const query = message.parts
        .filter(
          (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
            part.type === "text",
        )
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join("\n");

      if (query) {
        records.push(
          createRecord({
            folderName,
            chat,
            message,
            messageIndex,
            query,
            updatedAt,
            source: "user",
            sourceIndex: 0,
          }),
        );
      }
    }

    if (message.role !== "assistant") return;

    let answerIndex = 0;
    for (const part of message.parts) {
      if (!isRecord(part) || part.type !== "tool-ask_questions") continue;
      if (part.state !== "output-available") continue;
      if (!isRecord(part.output) || part.output.skipped === true) continue;
      if (!Array.isArray(part.output.answers)) continue;

      for (const answer of part.output.answers) {
        if (!isRecord(answer) || typeof answer.answer !== "string") continue;
        const query = answer.answer.trim();
        if (!query) continue;

        records.push(
          createRecord({
            folderName,
            chat,
            message,
            messageIndex,
            query,
            updatedAt,
            source: "answer",
            sourceIndex: answerIndex,
          }),
        );
        answerIndex += 1;
      }
    }
  });

  return records;
}

function createRecord({
  folderName,
  chat,
  message,
  messageIndex,
  query,
  updatedAt,
  source,
  sourceIndex,
}: {
  folderName: string;
  chat: ResearchChatSummary;
  message: UIMessage;
  messageIndex: number;
  query: string;
  updatedAt: string | null;
  source: "user" | "answer";
  sourceIndex: number;
}): ChatHistorySearchRecord {
  return {
    id: JSON.stringify([
      folderName,
      chat.id,
      message.id,
      messageIndex,
      source,
      sourceIndex,
    ]),
    folderName,
    chatId: chat.id,
    title: chat.title,
    query,
    updatedAt,
  };
}
