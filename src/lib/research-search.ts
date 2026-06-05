import { invoke } from "@tauri-apps/api/core";
import { abortablePromise } from "@/lib/abort";

interface ResearchSearchMock {
  searchResearch?: (
    apiKey: string,
    query: string | string[],
    options?: { folder?: string; limit?: number; abortSignal?: AbortSignal },
  ) => Promise<SearchResult[]>;
  indexResearchFile?: (
    apiKey: string,
    folder: string,
    filename: string,
    content: string,
  ) => Promise<void>;
  registerResearchFolder?: (name: string, query: string) => Promise<number>;
  renameResearchFolderIndex?: (
    oldName: string,
    newName: string,
  ) => Promise<void>;
  deleteResearchFolderIndex?: (name: string) => Promise<void>;
  deleteResearchFileIndex?: (
    folder: string,
    filename: string,
  ) => Promise<void>;
}

declare global {
  interface Window {
    __deepSearchResearchSearchMock?: ResearchSearchMock;
  }
}

export interface AdjacentChunk {
  chunk_index: number;
  content: string;
}

export interface SearchResult {
  chunk_id: number;
  content: string;
  filename: string;
  folder_name: string;
  header_path: string | null;
  score: number;
  adjacent_chunks: AdjacentChunk[] | null;
}

export interface ResearchFolderInfo {
  id: number;
  name: string;
  query: string | null;
  created_at: string;
  chunk_count: number;
}

export async function searchResearch(
  apiKey: string,
  query: string | string[],
  options?: { folder?: string; limit?: number; abortSignal?: AbortSignal },
): Promise<SearchResult[]> {
  const abortSignal = options?.abortSignal;
  const mock = getDevResearchSearchMock();
  if (mock?.searchResearch) {
    return abortablePromise(
      mock.searchResearch(apiKey, query, options),
      abortSignal,
    );
  }

  const queries = Array.isArray(query) ? query : [query];
  return abortablePromise(
    invoke<SearchResult[]>("search_research", {
      apiKey,
      queries,
      folder: options?.folder ?? null,
      limit: options?.limit ?? 8,
    }),
    abortSignal,
  );
}

export async function indexResearchFile(
  apiKey: string,
  folder: string,
  filename: string,
  content: string,
): Promise<void> {
  const mock = getDevResearchSearchMock();
  if (mock?.indexResearchFile) {
    return mock.indexResearchFile(apiKey, folder, filename, content);
  }

  return invoke("index_research_file", { apiKey, folder, filename, content });
}

export async function registerResearchFolder(
  name: string,
  query: string,
): Promise<number> {
  const mock = getDevResearchSearchMock();
  if (mock?.registerResearchFolder) {
    return mock.registerResearchFolder(name, query);
  }

  return invoke<number>("register_research_folder", { name, query });
}

export async function renameResearchFolderIndex(
  oldName: string,
  newName: string,
): Promise<void> {
  const mock = getDevResearchSearchMock();
  if (mock?.renameResearchFolderIndex) {
    return mock.renameResearchFolderIndex(oldName, newName);
  }

  return invoke("rename_research_folder_index", { oldName, newName });
}

export async function deleteResearchFolderIndex(name: string): Promise<void> {
  const mock = getDevResearchSearchMock();
  if (mock?.deleteResearchFolderIndex) {
    return mock.deleteResearchFolderIndex(name);
  }

  return invoke("delete_research_folder_index", { name });
}

export async function deleteResearchFileIndex(
  folder: string,
  filename: string,
): Promise<void> {
  const mock = getDevResearchSearchMock();
  if (mock?.deleteResearchFileIndex) {
    return mock.deleteResearchFileIndex(folder, filename);
  }

  return invoke("delete_research_file_index", { folder, filename });
}

export async function listResearchFoldersDb(): Promise<ResearchFolderInfo[]> {
  return invoke<ResearchFolderInfo[]>("list_research_folders_db");
}

export async function backfillIndex(apiKey: string): Promise<void> {
  return invoke("backfill_index", { apiKey });
}

function getDevResearchSearchMock(): ResearchSearchMock | null {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }

  return window.__deepSearchResearchSearchMock ?? null;
}
