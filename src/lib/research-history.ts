import type { UIMessage } from "ai";
import { z } from "zod";
import {
  createAppSubfolder,
  deleteAppFile,
  deleteAppSubfolder,
  listAppFiles,
  listAppSubfolders,
  readAppFile,
  renameAppSubfolder,
  SafePathSegmentSchema,
  writeAppFile,
} from "@/lib/app-file-storage";
import { tryParseJson } from "@/lib/json";
import {
  deleteResearchFolderIndex,
  renameResearchFolderIndex,
} from "@/lib/research-search";

export const SEARCH_RESULTS_SUBFOLDER = "search-results";
const CHATS_SUBFOLDER = "chats";
const LEGACY_CHAT_TRANSCRIPT_ID = "legacy-chat";
const LEGACY_CHAT_TRANSCRIPT_FILENAME = "chat.json";
const CHAT_FILE_EXTENSION = ".json";
const CHAT_INDEX_FILENAME = "index.json";
const CHAT_INDEX_VERSION = 1;

const indexQueues = new Map<string, Promise<unknown>>();

function serializedIndexWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = indexQueues.get(key) ?? Promise.resolve();
  const next = prev.then(
    () => fn(),
    (prevError) => {
      console.warn(
        `[research-history] previous index write failed for "${key}", proceeding`,
        prevError instanceof Error ? prevError.message : prevError,
      );
      return fn();
    },
  );
  indexQueues.set(key, next);
  void next.finally(() => {
    if (indexQueues.get(key) === next) indexQueues.delete(key);
  }).catch(() => {});
  return next;
}

export interface ResearchFolder {
  name: string;
  updatedAt?: string | null;
}

export interface ResearchChatSummary {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number;
  legacy?: boolean;
}

const StoredChatMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.unknown()),
  })
  .passthrough();

const StoredChatMessagesSchema = z.array(StoredChatMessageSchema);

const StoredResearchChatSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    messages: StoredChatMessagesSchema,
  })
  .passthrough();

const ResearchChatSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    messageCount: z.number().int().nonnegative(),
    legacy: z.boolean().optional(),
  })
  .passthrough();

const ResearchChatIndexSchema = z.object({
  version: z.literal(CHAT_INDEX_VERSION),
  chats: z.array(ResearchChatSummarySchema),
});

interface StoredResearchChat {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: UIMessage[];
}

export async function listResearchFolders(): Promise<ResearchFolder[]> {
  const folders = await listAppSubfolders({
    subfolder: SEARCH_RESULTS_SUBFOLDER,
  });

  const summaries = await Promise.all(
    folders.map(async (name) => ({
      name,
      updatedAt: await getResearchFolderUpdatedAt(name),
    })),
  );

  return summaries.sort(compareResearchFolders);
}

export async function listResearchChats(
  folderName: string,
): Promise<ResearchChatSummary[]> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const indexedChats = await readResearchChatIndex(parsedFolderName);

  if (indexedChats) {
    return indexedChats.sort(compareResearchChats);
  }

  return rebuildResearchChatIndex(parsedFolderName);
}

export async function readResearchChatMessages(
  folderName: string,
  chatId?: string | null,
): Promise<UIMessage[]> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  if (!chatId) {
    const [latestChat] = await listResearchChats(parsedFolderName);
    if (!latestChat) {
      return [];
    }

    return readResearchChatMessages(parsedFolderName, latestChat.id);
  }

  if (chatId === LEGACY_CHAT_TRANSCRIPT_ID) {
    return readLegacyResearchChatMessages(parsedFolderName);
  }

  const parsedChatId = SafePathSegmentSchema.parse(chatId);
  const chat = await readStoredResearchChat(parsedFolderName, parsedChatId);
  return chat?.messages ?? [];
}

async function rebuildResearchChatIndex(
  folderName: string,
): Promise<ResearchChatSummary[]> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const subfolder = researchChatsSubfolder(parsedFolderName);
  const filenames = await listAppFiles({ subfolder });

  const storedChats = await Promise.all(
    filenames
      .filter(isResearchChatTranscriptFilename)
      .map(async (filename) => {
        const chatId = filename.slice(0, -CHAT_FILE_EXTENSION.length);
        const parsedChatId = SafePathSegmentSchema.safeParse(chatId);
        if (!parsedChatId.success) return null;

        const chat = await readStoredResearchChat(
          parsedFolderName,
          parsedChatId.data,
        );

        if (!chat) return null;
        return toResearchChatSummary(chat);
      }),
  );

  const legacyMessages = await readLegacyResearchChatMessages(parsedFolderName);
  const legacyChat =
    legacyMessages.length > 0
      ? toResearchChatSummary({
          id: LEGACY_CHAT_TRANSCRIPT_ID,
          title: createChatTitle(legacyMessages),
          createdAt: null,
          updatedAt: null,
          messages: legacyMessages,
        })
      : null;

  const chats = [...storedChats, legacyChat]
    .filter((chat): chat is ResearchChatSummary => chat !== null)
    .sort(compareResearchChats);

  if (chats.length > 0) {
    await writeResearchChatIndex(parsedFolderName, chats).catch((error) => {
      console.error(
        `[research-history] Failed to write chat index for "${parsedFolderName}" after rebuild:`,
        error,
      );
    });
  }

  return chats;
}

export async function saveResearchChatMessages(
  folderName: string,
  chatId: string,
  messages: UIMessage[],
): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  if (chatId === LEGACY_CHAT_TRANSCRIPT_ID) {
    await writeAppFile({
      subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
      filename: LEGACY_CHAT_TRANSCRIPT_FILENAME,
      content: JSON.stringify(messages, null, 2),
    });
    await upsertResearchChatSummary(parsedFolderName, {
      id: LEGACY_CHAT_TRANSCRIPT_ID,
      title: createChatTitle(messages),
      createdAt: null,
      updatedAt: null,
      messageCount: messages.length,
      legacy: true,
    });
    return;
  }

  const parsedChatId = SafePathSegmentSchema.parse(chatId);
  const existingSummary = await readExistingResearchChatSummary(
    parsedFolderName,
    parsedChatId,
  );
  const now = new Date().toISOString();
  const createdAt =
    existingSummary?.createdAt ?? dateFromResearchChatId(parsedChatId) ?? now;
  const summary: ResearchChatSummary = {
    id: parsedChatId,
    title: createChatTitle(messages),
    createdAt,
    updatedAt: now,
    messageCount: messages.length,
  };

  await writeAppFile({
    subfolder: researchChatsSubfolder(parsedFolderName),
    filename: researchChatFilename(parsedChatId),
    content: JSON.stringify(
      {
        id: parsedChatId,
        title: summary.title,
        createdAt,
        updatedAt: now,
        messages,
      },
      null,
      2,
    ),
  });

  await upsertResearchChatSummary(parsedFolderName, summary);
}

export async function initializeResearchFolder(
  folderName: string,
): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  await createAppSubfolder({
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
  });
}

export async function moveResearchChatToFolder({
  fromFolderName,
  toFolderName,
  chatId,
  messages,
}: {
  fromFolderName: string;
  toFolderName: string;
  chatId: string;
  messages: UIMessage[];
}): Promise<void> {
  const parsedFromFolderName = SafePathSegmentSchema.parse(fromFolderName);
  const parsedToFolderName = SafePathSegmentSchema.parse(toFolderName);

  if (parsedFromFolderName === parsedToFolderName) {
    await saveResearchChatMessages(parsedToFolderName, chatId, messages);
    return;
  }

  await saveResearchChatMessages(parsedToFolderName, chatId, messages);

  const parsedChatId = SafePathSegmentSchema.parse(chatId);
  try {
    await deleteAppFile({
      subfolder: researchChatsSubfolder(parsedFromFolderName),
      filename: researchChatFilename(parsedChatId),
    });
  } catch (error) {
    try {
      await deleteAppFile({
        subfolder: researchChatsSubfolder(parsedToFolderName),
        filename: researchChatFilename(parsedChatId),
      });
    } catch (rollbackError) {
      console.error(
        "[research-history] failed to rollback destination after source delete failure during move",
        {
          fromFolder: parsedFromFolderName,
          toFolder: parsedToFolderName,
          chatId: parsedChatId,
          deleteError: error instanceof Error ? error.message : "unknown",
          rollbackError: rollbackError instanceof Error ? rollbackError.message : "unknown",
        },
      );
    }
    throw errorWithCause(
      `Failed to move chat "${parsedChatId}" from "${parsedFromFolderName}" to "${parsedToFolderName}": source deletion failed`,
      error,
    );
  }

  await removeResearchChatSummary(parsedFromFolderName, parsedChatId).catch(
    (error) => {
      console.warn(
        "[research-history] failed to remove chat from source folder index during move",
        {
          fromFolder: parsedFromFolderName,
          chatId: parsedChatId,
          error: error instanceof Error ? error.message : "unknown",
        },
      );
    },
  );
}

export function createResearchChatId(date = new Date()): string {
  return date.toISOString().replace(/:/g, "-");
}

async function readStoredResearchChat(
  folderName: string,
  chatId: string,
): Promise<StoredResearchChat | null> {
  try {
    const content = await readAppFile({
      subfolder: researchChatsSubfolder(folderName),
      filename: researchChatFilename(chatId),
    });

    if (!content) {
      return null;
    }

    const parsed = StoredResearchChatSchema.parse(tryParseJson(content));
    const messages = parsed.messages as UIMessage[];
    const storedChatId =
      typeof parsed.id === "string" &&
      SafePathSegmentSchema.safeParse(parsed.id).success
        ? parsed.id
        : chatId;

    return {
      id: storedChatId,
      title: parsed.title?.trim() || createChatTitle(messages),
      createdAt: parsed.createdAt ?? dateFromResearchChatId(chatId),
      updatedAt: parsed.updatedAt ?? parsed.createdAt ?? null,
      messages,
    };
  } catch (error) {
    console.warn(
      `[research-history] Failed to read stored chat "${chatId}" in "${folderName}":`,
      error,
    );
    return null;
  }
}

export async function renameResearchFolder(
  oldFolderName: string,
  newFolderName: string,
): Promise<ResearchFolder> {
  const parsedOldFolderName = SafePathSegmentSchema.parse(oldFolderName);
  const parsedNewFolderName = SafePathSegmentSchema.parse(newFolderName.trim());

  await renameAppSubfolder({
    oldSubfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedOldFolderName}`,
    newSubfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedNewFolderName}`,
  });
  try {
    await renameResearchFolderIndex(parsedOldFolderName, parsedNewFolderName);
  } catch (indexError) {
    console.error(
      `[research-history] Failed to rename search index after folder rename from "${parsedOldFolderName}" to "${parsedNewFolderName}". Folder renamed on disk but search index is stale.`,
      indexError instanceof Error ? indexError.message : "unknown",
    );
    try {
      await renameAppSubfolder({
        oldSubfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedNewFolderName}`,
        newSubfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedOldFolderName}`,
      });
    } catch (rollbackError) {
      console.error(
        `[research-history] Failed to rollback folder rename after index rename failure. Folder "${parsedNewFolderName}" has a stale search index.`,
        rollbackError instanceof Error ? rollbackError.message : "unknown",
      );
    }
    throw errorWithCause(
      `Failed to rename search index for folder "${parsedOldFolderName}" → "${parsedNewFolderName}"`,
      indexError,
    );
  }

  return { name: parsedNewFolderName };
}

export async function deleteResearchFolder(folderName: string): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  await deleteAppSubfolder({
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
  });
  try {
    await deleteResearchFolderIndex(parsedFolderName);
  } catch (indexError) {
    console.error(
      `[research-history] Failed to delete search index for folder "${parsedFolderName}". Folder deleted from disk but search index entries may be orphaned.`,
      indexError instanceof Error ? indexError.message : "unknown",
    );
    throw errorWithCause(
      `Failed to delete search index for folder "${parsedFolderName}"`,
      indexError,
    );
  }
}

export function compareResearchFolders(
  a: ResearchFolder,
  b: ResearchFolder,
) {
  const dateDiff = sortableDate(b.updatedAt) - sortableDate(a.updatedAt);
  return dateDiff || a.name.localeCompare(b.name);
}

function researchChatsSubfolder(folderName: string) {
  return `${SEARCH_RESULTS_SUBFOLDER}/${folderName}/${CHATS_SUBFOLDER}`;
}

function researchChatFilename(chatId: string) {
  return `${chatId}${CHAT_FILE_EXTENSION}`;
}

async function readLegacyResearchChatMessages(
  folderName: string,
): Promise<UIMessage[]> {
  const content = await readAppFile({
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${folderName}`,
    filename: LEGACY_CHAT_TRANSCRIPT_FILENAME,
  });

  if (!content) {
    return [];
  }

  try {
    const parsed = StoredChatMessagesSchema.parse(tryParseJson(content));
    return parsed as UIMessage[];
  } catch (error) {
    console.warn(
      `[research-history] Failed to parse legacy chat in "${folderName}":`,
      error,
    );
    return [];
  }
}

async function readResearchChatIndex(
  folderName: string,
): Promise<ResearchChatSummary[] | null> {
  const content = await readAppFile({
    subfolder: researchChatsSubfolder(folderName),
    filename: CHAT_INDEX_FILENAME,
  });

  if (!content) {
    return null;
  }

  try {
    const parsed = ResearchChatIndexSchema.parse(tryParseJson(content));
    return parsed.chats
      .map(normalizeResearchChatSummary)
      .filter((chat): chat is ResearchChatSummary => chat !== null);
  } catch (error) {
    console.warn(
      `[research-history] Failed to parse chat index in "${folderName}":`,
      error,
    );
    return null;
  }
}

async function writeResearchChatIndex(
  folderName: string,
  chats: ResearchChatSummary[],
): Promise<void> {
  await writeAppFile({
    subfolder: researchChatsSubfolder(folderName),
    filename: CHAT_INDEX_FILENAME,
    emitChange: false,
    content: JSON.stringify(
      {
        version: CHAT_INDEX_VERSION,
        chats: chats.map(normalizeResearchChatSummary).filter(Boolean),
      },
      null,
      2,
    ),
  });
}

async function upsertResearchChatSummary(
  folderName: string,
  summary: ResearchChatSummary,
): Promise<void> {
  return serializedIndexWrite(folderName, async () => {
    const existingChats =
      (await readResearchChatIndex(folderName)) ??
      (await rebuildResearchChatIndex(folderName));
    const nextChats = [
      summary,
      ...existingChats.filter((chat) => chat.id !== summary.id),
    ].sort(compareResearchChats);

    await writeResearchChatIndex(folderName, nextChats);
  });
}

async function removeResearchChatSummary(
  folderName: string,
  chatId: string,
): Promise<void> {
  return serializedIndexWrite(folderName, async () => {
    const existingChats = await readResearchChatIndex(folderName);
    if (!existingChats) return;
    const nextChats = existingChats.filter((chat) => chat.id !== chatId);
    if (nextChats.length === existingChats.length) return;
    await writeResearchChatIndex(folderName, nextChats);
  });
}

async function readExistingResearchChatSummary(
  folderName: string,
  chatId: string,
): Promise<ResearchChatSummary | null> {
  const indexedChats = await readResearchChatIndex(folderName);
  const indexedChat = indexedChats?.find((chat) => chat.id === chatId);
  if (indexedChat) {
    return indexedChat;
  }

  const chat = await readStoredResearchChat(folderName, chatId);
  return chat ? toResearchChatSummary(chat) : null;
}

function toResearchChatSummary(chat: StoredResearchChat): ResearchChatSummary {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
    ...(chat.id === LEGACY_CHAT_TRANSCRIPT_ID ? { legacy: true } : {}),
  };
}

async function getResearchFolderUpdatedAt(folderName: string) {
  const [latestChat] = await listResearchChats(folderName);
  return latestChat?.updatedAt ?? latestChat?.createdAt ?? null;
}

function normalizeResearchChatSummary(
  chat: ResearchChatSummary,
): ResearchChatSummary | null {
  const parsedId = SafePathSegmentSchema.safeParse(chat.id);
  if (!parsedId.success) {
    return null;
  }

  return {
    id: parsedId.data,
    title: chat.title.trim() || "Untitled chat",
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messageCount,
    ...(chat.legacy ? { legacy: true } : {}),
  };
}

function isResearchChatTranscriptFilename(filename: string) {
  return (
    filename !== CHAT_INDEX_FILENAME && filename.endsWith(CHAT_FILE_EXTENSION)
  );
}

function compareResearchChats(
  a: ResearchChatSummary,
  b: ResearchChatSummary,
) {
  return sortableChatDate(b) - sortableChatDate(a);
}

function sortableChatDate(chat: ResearchChatSummary) {
  const value = chat.updatedAt ?? chat.createdAt;
  return sortableDate(value);
}

function sortableDate(value?: string | null) {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}

function createChatTitle(messages: UIMessage[]) {
  const firstUserText = messages
    .filter((message) => message.role === "user")
    .flatMap((message) => message.parts)
    .map(getTextFromMessagePart)
    .find((text) => text.length > 0);

  if (!firstUserText) {
    return "Untitled chat";
  }

  const singleLine = firstUserText.replace(/\s+/g, " ").trim();
  return singleLine.length > 56 ? `${singleLine.slice(0, 53)}...` : singleLine;
}

function getTextFromMessagePart(part: unknown) {
  if (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
  ) {
    return part.text.trim();
  }

  return "";
}

function dateFromResearchChatId(chatId: string) {
  const normalized = chatId.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)$/,
    "$1:$2:$3",
  );
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : normalized;
}
