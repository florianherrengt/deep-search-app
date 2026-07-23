import type { UIMessage } from "ai";
import { z } from "zod";
import {
  appendAppFile,
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

export const SEARCH_RESULTS_SUBFOLDER = "search-results";
const CHATS_SUBFOLDER = "chats";
const LEGACY_CHAT_TRANSCRIPT_ID = "legacy-chat";
const LEGACY_CHAT_TRANSCRIPT_FILENAME = "chat.json";
const CHAT_FILE_EXTENSION = ".json";
const CHAT_INDEX_FILENAME = "index.json";
const CHAT_INDEX_VERSION = 1;

type WriteQueues = Map<string, Promise<unknown>>;

const indexQueues: WriteQueues = new Map();
const folderMutationQueues: WriteQueues = new Map();

function serializedWrite<T>(
  queues: WriteQueues,
  queueName: "index",
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(
    () => fn(),
    (prevError) => {
      console.warn(
        `[research-history] previous ${queueName} write failed for "${key}", proceeding`,
        prevError instanceof Error ? prevError.message : prevError,
      );
      return fn();
    },
  );
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }).catch(() => {});
  return next;
}

function serializedIndexWrite<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return serializedWrite(indexQueues, "index", key, fn);
}

function serializedFolderMutation<T>(
  folderNames: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(folderNames)].sort((a, b) => a.localeCompare(b));
  const previous = keys.map((key) => {
    const pending = folderMutationQueues.get(key) ?? Promise.resolve();
    return pending.catch((prevError) => {
      console.warn(
        `[research-history] previous folder mutation failed for "${key}", proceeding`,
        prevError instanceof Error ? prevError.message : prevError,
      );
    });
  });
  const next = Promise.all(previous).then(() => fn());

  // Reserve every folder synchronously behind the same barrier. Sorting makes
  // multi-folder operations deterministic, while the shared promise prevents
  // lock-order inversion for concurrent moves in opposite directions.
  for (const key of keys) {
    folderMutationQueues.set(key, next);
  }
  void next.finally(() => {
    for (const key of keys) {
      if (folderMutationQueues.get(key) === next) {
        folderMutationQueues.delete(key);
      }
    }
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
  provisional: boolean;
  messages: UIMessage[];
}

interface ParsedChatFile {
  format: "jsonl" | "legacy";
  messages: UIMessage[];
  meta: {
    id?: string;
    title?: string;
    createdAt?: string | null;
    updatedAt?: string | null;
    provisional?: boolean;
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseChatFileContent(content: string): ParsedChatFile | null {
  const single = tryParseJson(content);

  if (Array.isArray(single)) {
    return { format: "legacy", messages: single as UIMessage[], meta: {} };
  }
  if (
    single &&
    typeof single === "object" &&
    Array.isArray((single as Record<string, unknown>).messages)
  ) {
    const obj = single as Record<string, unknown>;
    return {
      format: "legacy",
      messages: obj.messages as UIMessage[],
      meta: {
        id: asString(obj.id),
        title: asString(obj.title),
        createdAt:
          typeof obj.createdAt === "string" || obj.createdAt === null
            ? obj.createdAt
            : undefined,
        updatedAt:
          typeof obj.updatedAt === "string" || obj.updatedAt === null
            ? obj.updatedAt
            : undefined,
        provisional:
          typeof obj.provisional === "boolean" ? obj.provisional : undefined,
      },
    };
  }

  let meta: ParsedChatFile["meta"] | null = null;
  const messages: unknown[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = tryParseJson(trimmed);
    if (parsed == null) continue;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>)._meta === 1
    ) {
      const m = parsed as Record<string, unknown>;
      meta = {
        id: asString(m.id),
        title: asString(m.title),
        createdAt:
          typeof m.createdAt === "string" || m.createdAt === null
            ? m.createdAt
            : undefined,
        updatedAt:
          typeof m.updatedAt === "string" || m.updatedAt === null
            ? m.updatedAt
            : undefined,
        provisional:
          typeof m.provisional === "boolean" ? m.provisional : undefined,
      };
    } else {
      messages.push(parsed);
    }
  }

  if (meta) {
    return { format: "jsonl", messages: messages as UIMessage[], meta };
  }
  return null;
}

function messageId(message: unknown): string {
  if (
    message &&
    typeof message === "object" &&
    "id" in message &&
    typeof (message as Record<string, unknown>).id === "string"
  ) {
    return (message as Record<string, unknown>).id as string;
  }
  return "";
}

function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i += 1;
  return i;
}

export async function listResearchFolders(): Promise<ResearchFolder[]> {
  const folders = await listAppSubfolders({
    subfolder: SEARCH_RESULTS_SUBFOLDER,
  });

  const summaries = await Promise.all(
    folders.map(async (name) => {
      try {
        return {
          name,
          updatedAt: await getResearchFolderUpdatedAt(name),
        };
      } catch (error) {
        console.warn(
          `[research-history] Failed to read update timestamp for "${name}":`,
          error,
        );
        return { name, updatedAt: null };
      }
    }),
  );

  return summaries.sort(compareResearchFolders);
}

export async function listResearchChats(
  folderName: string,
): Promise<ResearchChatSummary[]> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  return serializedFolderMutation([parsedFolderName], async () => {
    const indexedChats = await readResearchChatIndex(parsedFolderName);

    if (indexedChats) {
      return indexedChats.sort(compareResearchChats);
    }

    const chats = await collectResearchChatSummaries(parsedFolderName);
    if (chats.length > 0) {
      await serializedIndexWrite(parsedFolderName, async () => {
        const current = await readResearchChatIndex(parsedFolderName);
        if (current) return;
        await writeResearchChatIndex(parsedFolderName, chats).catch((error) => {
          console.error(
            `[research-history] Failed to write chat index for "${parsedFolderName}" after rebuild:`,
            error,
          );
        });
      });
    }
    return chats;
  });
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

async function collectResearchChatSummaries(
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
          provisional: false,
          messages: legacyMessages,
        })
      : null;

  return [...storedChats, legacyChat]
    .filter((chat): chat is ResearchChatSummary => chat !== null)
    .sort(compareResearchChats);
}


export async function saveResearchChatMessages(
  folderName: string,
  chatId: string,
  messages: UIMessage[],
  options?: { title?: string; provisional?: boolean },
): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const parsedChatId =
    chatId === LEGACY_CHAT_TRANSCRIPT_ID
      ? LEGACY_CHAT_TRANSCRIPT_ID
      : SafePathSegmentSchema.parse(chatId);

  await serializedFolderMutation([parsedFolderName], () =>
    saveResearchChatMessagesUnlocked(
      parsedFolderName,
      parsedChatId,
      messages,
      options,
    ),
  );
}

async function saveResearchChatMessagesUnlocked(
  parsedFolderName: string,
  parsedChatId: string,
  messages: UIMessage[],
  options?: { title?: string; provisional?: boolean },
): Promise<void> {
  if (parsedChatId === LEGACY_CHAT_TRANSCRIPT_ID) {
    await writeAppFile({
      subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
      filename: LEGACY_CHAT_TRANSCRIPT_FILENAME,
      content: JSON.stringify(messages),
    });
    await upsertResearchChatSummary(parsedFolderName, {
      id: LEGACY_CHAT_TRANSCRIPT_ID,
      title: options?.title ?? createChatTitle(messages),
      createdAt: null,
      updatedAt: null,
      messageCount: messages.length,
      legacy: true,
    });
    return;
  }

  const now = new Date().toISOString();
  const subfolder = researchChatsSubfolder(parsedFolderName);
  const filename = researchChatFilename(parsedChatId);

  const existingContent = await readAppFile({ subfolder, filename });
  const parsed = existingContent ? parseChatFileContent(existingContent) : null;
  const onDiskIds = parsed ? parsed.messages.map(messageId) : [];
  const newIds = messages.map(messageId);
  const prefix = commonPrefixLength(onDiskIds, newIds);
  const createdAt =
    parsed?.meta.createdAt ?? dateFromResearchChatId(parsedChatId) ?? now;

  const title =
    options?.title ?? parsed?.meta.title ?? createChatTitle(messages);

  const meta = {
    _meta: 1 as const,
    id: parsedChatId,
    title,
    createdAt,
    updatedAt: now,
    count: messages.length,
    provisional: options?.provisional ?? parsed?.meta.provisional ?? false,
  };

  const canAppend =
    parsed?.format === "jsonl" &&
    prefix === onDiskIds.length &&
    messages.length > onDiskIds.length;

  if (canAppend) {
    const appended = messages.slice(onDiskIds.length);
    const chunk =
      appended.map((m) => JSON.stringify(m)).join("\n") +
      "\n" +
      JSON.stringify(meta) +
      "\n";
    await appendAppFile({ subfolder, filename, content: chunk });
  } else {
    const lines = [
      JSON.stringify(meta),
      ...messages.map((m) => JSON.stringify(m)),
    ];
    await writeAppFile({
      subfolder,
      filename,
      content: lines.join("\n") + "\n",
    });
  }

  await upsertResearchChatSummary(parsedFolderName, {
    id: parsedChatId,
    title,
    createdAt,
    updatedAt: now,
    messageCount: messages.length,
  });
}

export async function initializeResearchFolder(
  folderName: string,
): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  await serializedFolderMutation([parsedFolderName], () =>
    createAppSubfolder({
      subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
    }),
  );
}

export async function moveResearchChatToFolder({
  fromFolderName,
  toFolderName,
  chatId,
  messages,
  requireExistingDestination = false,
}: {
  fromFolderName: string;
  toFolderName: string;
  chatId: string;
  messages: UIMessage[];
  requireExistingDestination?: boolean;
}): Promise<void> {
  const parsedFromFolderName = SafePathSegmentSchema.parse(fromFolderName);
  const parsedToFolderName = SafePathSegmentSchema.parse(toFolderName);
  const parsedChatId = SafePathSegmentSchema.parse(chatId);

  await serializedFolderMutation(
    [parsedFromFolderName, parsedToFolderName],
    () =>
      moveResearchChatToFolderUnlocked({
        parsedFromFolderName,
        parsedToFolderName,
        parsedChatId,
        messages,
        requireExistingDestination,
      }),
  );
}

async function moveResearchChatToFolderUnlocked({
  parsedFromFolderName,
  parsedToFolderName,
  parsedChatId,
  messages,
  requireExistingDestination,
}: {
  parsedFromFolderName: string;
  parsedToFolderName: string;
  parsedChatId: string;
  messages: UIMessage[];
  requireExistingDestination: boolean;
}): Promise<void> {
  if (parsedFromFolderName === parsedToFolderName) {
    await saveResearchChatMessagesUnlocked(
      parsedToFolderName,
      parsedChatId,
      messages,
    );
    return;
  }

  if (requireExistingDestination) {
    const folders = await listAppSubfolders({
      subfolder: SEARCH_RESULTS_SUBFOLDER,
    });
    if (!folders.includes(parsedToFolderName)) {
      throw new Error(
        `Research folder no longer exists: ${parsedToFolderName}`,
      );
    }
  }

  await saveResearchChatMessagesUnlocked(
    parsedToFolderName,
    parsedChatId,
    messages,
    { provisional: false },
  );

  try {
    await deleteAppFile({
      subfolder: researchChatsSubfolder(parsedFromFolderName),
      filename: researchChatFilename(parsedChatId),
    });
  } catch (error) {
    // Rollback: undo the destination write so the move is atomic from the
    // user's perspective. We must remove BOTH the destination chat file AND
    // its index entry — otherwise listResearchChats returns a ghost chat
    // whose readResearchChatMessages comes back empty.
    try {
      await deleteAppFile({
        subfolder: researchChatsSubfolder(parsedToFolderName),
        filename: researchChatFilename(parsedChatId),
      });
    } catch (rollbackDeleteError) {
      console.error(
        "[research-history] failed to rollback destination chat file after source delete failure during move",
        {
          fromFolder: parsedFromFolderName,
          toFolder: parsedToFolderName,
          chatId: parsedChatId,
          deleteError: error instanceof Error ? error.message : "unknown",
          rollbackError: rollbackDeleteError instanceof Error ? rollbackDeleteError.message : "unknown",
        },
      );
    }
    await removeResearchChatSummary(parsedToFolderName, parsedChatId).catch(
      (rollbackIndexError) => {
        console.error(
          "[research-history] failed to rollback destination chat index after source delete failure during move",
          {
            fromFolder: parsedFromFolderName,
            toFolder: parsedToFolderName,
            chatId: parsedChatId,
            rollbackError: rollbackIndexError instanceof Error ? rollbackIndexError.message : "unknown",
          },
        );
      },
    );
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
  const timestamp = date.toISOString().replace(/:/g, "-");
  return `${timestamp}--${globalThis.crypto.randomUUID()}`;
}

export async function isResearchChatProvisional(
  folderName: string,
  chatId: string,
): Promise<boolean> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const parsedChatId = SafePathSegmentSchema.parse(chatId);
  return serializedFolderMutation([parsedFolderName], async () => {
    const chat = await readStoredResearchChat(parsedFolderName, parsedChatId);
    return chat?.provisional === true;
  });
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

    const parsed = parseChatFileContent(content);
    if (!parsed) {
      return null;
    }

    const messages = StoredChatMessagesSchema.parse(parsed.messages) as UIMessage[];
    const metaId = parsed.meta.id;
    const storedChatId =
      typeof metaId === "string" &&
      SafePathSegmentSchema.safeParse(metaId).success
        ? metaId
        : chatId;

    return {
      id: storedChatId,
      title: parsed.meta.title?.trim() || createChatTitle(messages),
      createdAt: parsed.meta.createdAt ?? dateFromResearchChatId(chatId),
      updatedAt: parsed.meta.updatedAt ?? parsed.meta.createdAt ?? null,
      provisional: parsed.meta.provisional === true,
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

  await serializedFolderMutation(
    [parsedOldFolderName, parsedNewFolderName],
    () => renameResearchFolderUnlocked(parsedOldFolderName, parsedNewFolderName),
  );

  return { name: parsedNewFolderName };
}

async function renameResearchFolderUnlocked(
  parsedOldFolderName: string,
  parsedNewFolderName: string,
): Promise<void> {
  await renameAppSubfolder({
    oldSubfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedOldFolderName}`,
    newSubfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedNewFolderName}`,
  });
}

export async function deleteResearchFolder(folderName: string): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  await serializedFolderMutation([parsedFolderName], () =>
    deleteResearchFolderUnlocked(parsedFolderName),
  );
}

export interface DeleteDisposableResearchFolderResult {
  deleted: boolean;
  remainingRootFiles: string[];
  remainingChatFiles: string[];
  remainingSubfolders: string[];
}

export async function deleteResearchFolderIfDisposable(
  folderName: string,
  options: { ignoredRootFiles?: readonly string[] } = {},
): Promise<DeleteDisposableResearchFolderResult> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const ignoredRootFiles = new Set(
    (options.ignoredRootFiles ?? []).map((filename) =>
      SafePathSegmentSchema.parse(filename),
    ),
  );

  return serializedFolderMutation([parsedFolderName], async () => {
    const [rootFiles, chatFiles, subfolders] = await Promise.all([
      listAppFiles({
        subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
      }),
      listAppFiles({
        subfolder: researchChatsSubfolder(parsedFolderName),
      }),
      listAppSubfolders({
        subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
      }),
    ]);
    const remainingRootFiles = rootFiles.filter(
      (filename) => !ignoredRootFiles.has(filename),
    );
    const remainingChatFiles = chatFiles.filter(
      (filename) => filename !== CHAT_INDEX_FILENAME,
    );
    const remainingSubfolders = subfolders.filter(
      (subfolder) => subfolder !== CHATS_SUBFOLDER,
    );

    if (
      remainingRootFiles.length > 0 ||
      remainingChatFiles.length > 0 ||
      remainingSubfolders.length > 0
    ) {
      return {
        deleted: false,
        remainingRootFiles,
        remainingChatFiles,
        remainingSubfolders,
      };
    }

    await deleteResearchFolderUnlocked(parsedFolderName);
    return {
      deleted: true,
      remainingRootFiles: [],
      remainingChatFiles: [],
      remainingSubfolders: [],
    };
  });
}

async function deleteResearchFolderUnlocked(
  parsedFolderName: string,
): Promise<void> {
  await deleteAppSubfolder({
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
  });
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
    content: JSON.stringify({
      version: CHAT_INDEX_VERSION,
      chats: chats.map(normalizeResearchChatSummary).filter(Boolean),
    }),
  });
}

async function upsertResearchChatSummary(
  folderName: string,
  summary: ResearchChatSummary,
): Promise<void> {
  return serializedIndexWrite(folderName, async () => {
    const existingChats =
      (await readResearchChatIndex(folderName)) ??
      (await collectResearchChatSummaries(folderName));
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

async function getResearchFolderUpdatedAt(folderName: string): Promise<string | null> {
  // listResearchFolders() calls this once per folder just to read the most
  // recent chat's updatedAt. The full listResearchChats() path does an
  // O(chats) Zod schema validation + normalizeResearchChatSummary pass and
  // an O(chats log chats) sort — none of which is needed to find a max.
  //
  // This dedicated path reads the raw index JSON and scans for the max
  // sortable timestamp in a single O(chats) pass. If anything looks off
  // (missing/corrupt index, schema version mismatch), it falls back to the
  // full listResearchChats() path so correctness is never compromised.
  const content = await readAppFile({
    subfolder: researchChatsSubfolder(folderName),
    filename: CHAT_INDEX_FILENAME,
  });

  if (content) {
    const parsed = tryParseJson(content) as
      | {
          version?: unknown;
          chats?: Array<{
            updatedAt?: string | null;
            createdAt?: string | null;
          }>;
        }
      | null;

    if (parsed && parsed.version === CHAT_INDEX_VERSION && Array.isArray(parsed.chats)) {
      let best = 0;
      for (const chat of parsed.chats) {
        const value = chat?.updatedAt ?? chat?.createdAt;
        if (!value) continue;
        const ts = Date.parse(value);
        if (!Number.isNaN(ts) && ts > best) best = ts;
      }
      if (best > 0) return new Date(best).toISOString();
      // Index exists but no chat has a usable timestamp — fall through to
      // the full path so legacy chats (null timestamps) are handled too.
    }
  }

  // Fallback: no index, corrupt index, or only null-timestamp entries.
  // This preserves the existing behaviour for fresh folders (index not yet
  // built) and legacy chats with null createdAt/updatedAt.
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
  const match = chatId.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)(?:--[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i,
  );
  if (!match) return null;

  const normalized = match[1].replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}\.\d{3}Z)$/,
    "$1:$2:$3",
  );
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? null : normalized;
}
