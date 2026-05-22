import type { UIMessage } from "ai";
import { z } from "zod";
import {
  deleteAppSubfolder,
  listAppSubfolders,
  readAppFile,
  renameAppSubfolder,
  SafePathSegmentSchema,
  writeAppFile,
} from "@/lib/app-file-storage";

export const SEARCH_RESULTS_SUBFOLDER = "search-results";
const CHAT_TRANSCRIPT_FILENAME = "chat.json";

export interface ResearchFolder {
  name: string;
}

const StoredChatMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(z.unknown()),
  })
  .passthrough();

const StoredChatMessagesSchema = z.array(StoredChatMessageSchema);

export async function listResearchFolders(): Promise<ResearchFolder[]> {
  const folders = await listAppSubfolders({
    subfolder: SEARCH_RESULTS_SUBFOLDER,
  });

  return folders.map((name) => ({ name }));
}

export async function readResearchChatMessages(
  folderName: string,
): Promise<UIMessage[]> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);
  const content = await readAppFile({
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
    filename: CHAT_TRANSCRIPT_FILENAME,
  });

  if (!content) {
    return [];
  }

  try {
    const parsed = StoredChatMessagesSchema.parse(JSON.parse(content));
    return parsed as UIMessage[];
  } catch {
    return [];
  }
}

export async function saveResearchChatMessages(
  folderName: string,
  messages: UIMessage[],
): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  await writeAppFile({
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
    filename: CHAT_TRANSCRIPT_FILENAME,
    content: JSON.stringify(messages, null, 2),
  });
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

  return { name: parsedNewFolderName };
}

export async function deleteResearchFolder(folderName: string): Promise<void> {
  const parsedFolderName = SafePathSegmentSchema.parse(folderName);

  await deleteAppSubfolder({
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${parsedFolderName}`,
  });
}
