import type { UIMessage } from "ai";
import { readAppFile } from "@/lib/app-file-storage";
import { isRecord } from "@/lib/json";
import {
  listResearchChats,
  listResearchFolders,
  readResearchChatMessages,
  SEARCH_RESULTS_SUBFOLDER,
  type ResearchChatSummary,
  type ResearchFolder,
} from "@/lib/research-history";
import { parseResearchMemories } from "@/lib/research-memory";
import type { ChatHistorySearchRecord } from "@/lib/chat-history-search-index";

const MAX_INDEXED_MEMORY_FACTS = 200;
const MAX_INDEXED_MEMORY_FACT_CHARACTERS = 1_000;
const MAX_INDEXED_MEMORY_TOTAL_CHARACTERS = 64_000;

interface ChatHistoryCorpusDependencies {
  listResearchFolders: () => Promise<ResearchFolder[]>;
  listResearchChats: (folderName: string) => Promise<ResearchChatSummary[]>;
  readResearchChatMessages: (
    folderName: string,
    chatId: string,
  ) => Promise<UIMessage[]>;
  readAppFile: typeof readAppFile;
}

const DEFAULT_DEPENDENCIES: ChatHistoryCorpusDependencies = {
  listResearchFolders,
  listResearchChats,
  readResearchChatMessages,
  readAppFile,
};

export async function loadChatHistorySearchRecords(
  dependencies: ChatHistoryCorpusDependencies = DEFAULT_DEPENDENCIES,
): Promise<ChatHistorySearchRecord[]> {
  const folders = await dependencies.listResearchFolders();
  const records = await Promise.all(
    folders.map(async (folder) => {
      const memoryRecordsPromise = loadMemoryRecords(folder, dependencies);
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
        return [...chatRecords.flat(), ...(await memoryRecordsPromise)];
      } catch (error) {
        console.warn("[chat-history-search] failed to list folder chats", {
          folderName: folder.name,
          error: error instanceof Error ? error.message : "unknown",
        });
        return memoryRecordsPromise;
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
          recordKind: "chat",
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

export async function createResearchMemorySearchRecords(
  folderName: string,
  content: string | null,
  updatedAt: string | null,
): Promise<ChatHistorySearchRecord[]> {
  const memories = boundIndexedMemories(parseResearchMemories(content));
  return Promise.all(
    memories.map(async (memory) => ({
      id: await createResearchMemoryRecordId(folderName, memory),
      recordKind: "memory" as const,
      folderName,
      chatId: "",
      title: "",
      query: memory,
      updatedAt,
    })),
  );
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
    recordKind: "chat",
    folderName,
    chatId: chat.id,
    title: chat.title,
    query,
    updatedAt,
  };
}

async function loadMemoryRecords(
  folder: ResearchFolder,
  dependencies: ChatHistoryCorpusDependencies,
): Promise<ChatHistorySearchRecord[]> {
  try {
    const content = await dependencies.readAppFile({
      subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${folder.name}`,
      filename: "memories.md",
    });
    return await createResearchMemorySearchRecords(
      folder.name,
      content,
      folder.updatedAt ?? null,
    );
  } catch (error) {
    console.warn("[chat-history-search] failed to read folder memories", {
      folderName: folder.name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return [];
  }
}

function boundIndexedMemories(memories: readonly string[]) {
  const result: string[] = [];
  let remainingCharacters = MAX_INDEXED_MEMORY_TOTAL_CHARACTERS;

  for (const memory of memories) {
    if (
      result.length >= MAX_INDEXED_MEMORY_FACTS ||
      remainingCharacters <= 0
    ) {
      break;
    }
    const bounded = memory.slice(
      0,
      Math.min(MAX_INDEXED_MEMORY_FACT_CHARACTERS, remainingCharacters),
    );
    if (!bounded) continue;
    result.push(bounded);
    remainingCharacters -= bounded.length;
  }

  return result;
}

async function createResearchMemoryRecordId(
  folderName: string,
  memory: string,
) {
  const bytes = new TextEncoder().encode(`${folderName}\u0000${memory}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return JSON.stringify([folderName, "memory", hash]);
}
