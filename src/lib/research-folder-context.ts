import {
  listAppFiles,
  readAppFile,
  SafePathSegmentSchema,
} from "@/lib/app-file-storage";
import {
  listResearchChats,
  SEARCH_RESULTS_SUBFOLDER,
} from "@/lib/research-history";
import { parseResearchMemories } from "@/lib/research-memory";

const MAX_CONTEXT_FILES = 100;
const MAX_TOPIC_CHARACTERS = 4_000;
const MAX_CONTEXT_MEMORIES = 100;
const MAX_MEMORY_CHARACTERS = 1_000;
const MAX_TOTAL_MEMORY_CHARACTERS = 8_000;
const MAX_FILENAME_CHARACTERS = 256;
const MAX_TOTAL_FILENAME_CHARACTERS = 4_000;

export interface ResearchFolderContext {
  folderName: string;
  files: string[];
  topic: string;
  topicSource: "summary.md" | "README.md" | "chat-title" | "folder-name";
  memories: string[];
}

interface ResearchFolderContextDependencies {
  listAppFiles: typeof listAppFiles;
  listResearchChats: typeof listResearchChats;
  readAppFile: typeof readAppFile;
}

const DEFAULT_DEPENDENCIES: ResearchFolderContextDependencies = {
  listAppFiles,
  listResearchChats,
  readAppFile,
};

export async function loadResearchFolderContext(
  folderName: string,
  dependencies: ResearchFolderContextDependencies = DEFAULT_DEPENDENCIES,
): Promise<ResearchFolderContext> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const subfolder = `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`;

  const [files, summary, readme, memories, chats] = await Promise.all([
    recoverContextValue(
      () => dependencies.listAppFiles({ subfolder }),
      [],
      parsedFolderName,
      "file list",
    ),
    recoverContextValue(
      () => dependencies.readAppFile({ subfolder, filename: "summary.md" }),
      null,
      parsedFolderName,
      "summary.md",
    ),
    recoverContextValue(
      () => dependencies.readAppFile({ subfolder, filename: "README.md" }),
      null,
      parsedFolderName,
      "README.md",
    ),
    recoverContextValue(
      () => dependencies.readAppFile({ subfolder, filename: "memories.md" }),
      null,
      parsedFolderName,
      "memories.md",
    ),
    recoverContextValue(
      () => dependencies.listResearchChats(parsedFolderName),
      [],
      parsedFolderName,
      "chat titles",
    ),
  ]);

  const summaryTopic = normalizeTopic(summary);
  const readmeTopic = normalizeTopic(readme);
  const chatTopic = chats.find((chat) => chat.title.trim())?.title.trim() ?? "";
  const folderTopic = parsedFolderName.replace(/[-_]+/g, " ");
  const topic = summaryTopic || readmeTopic || chatTopic || folderTopic;
  const topicSource = summaryTopic
    ? "summary.md"
    : readmeTopic
      ? "README.md"
      : chatTopic
        ? "chat-title"
        : "folder-name";

  return {
    folderName: parsedFolderName,
    files: takeBoundedItems(files, {
      maxItems: MAX_CONTEXT_FILES,
      maxItemCharacters: MAX_FILENAME_CHARACTERS,
      maxTotalCharacters: MAX_TOTAL_FILENAME_CHARACTERS,
    }),
    topic,
    topicSource,
    memories: takeBoundedItems(parseResearchMemories(memories), {
      maxItems: MAX_CONTEXT_MEMORIES,
      maxItemCharacters: MAX_MEMORY_CHARACTERS,
      maxTotalCharacters: MAX_TOTAL_MEMORY_CHARACTERS,
    }),
  };
}

async function recoverContextValue<T>(
  load: () => Promise<T>,
  fallback: T,
  folderName: string,
  resource: string,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    console.warn("[research-folder-context] Failed to load folder context", {
      folderName,
      resource,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fallback;
  }
}

function normalizeTopic(content: string | null) {
  return content?.trim().slice(0, MAX_TOPIC_CHARACTERS) ?? "";
}

function takeBoundedItems(
  items: readonly string[],
  limits: {
    maxItems: number;
    maxItemCharacters: number;
    maxTotalCharacters: number;
  },
) {
  const result: string[] = [];
  let remainingCharacters = limits.maxTotalCharacters;

  for (const item of items) {
    if (result.length >= limits.maxItems || remainingCharacters <= 0) break;
    const bounded = item.slice(
      0,
      Math.min(limits.maxItemCharacters, remainingCharacters),
    );
    if (!bounded) continue;
    result.push(bounded);
    remainingCharacters -= bounded.length;
  }

  return result;
}
