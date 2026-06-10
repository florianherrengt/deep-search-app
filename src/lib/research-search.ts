import { invoke } from "@tauri-apps/api/core";
import { abortablePromise } from "@/lib/abort";

export interface EmbeddingConfig {
  api_key: string;
  base_url: string;
  model: string;
  dimensions: number;
  query_prefix: string;
}

export interface RerankerConfig {
  api_key: string;
  base_url: string;
  model: string;
}

interface ResearchSearchMock {
  searchResearch?: (
    embeddingConfig: EmbeddingConfig,
    rerankerConfig: RerankerConfig,
    query: string | string[],
    options?: { folder?: string; limit?: number; abortSignal?: AbortSignal },
  ) => Promise<SearchResult[]>;
  searchResearchWithDiagnostics?: (
    embeddingConfig: EmbeddingConfig,
    rerankerConfig: RerankerConfig,
    query: string | string[],
    options?: { folder?: string; limit?: number; abortSignal?: AbortSignal },
  ) => Promise<SearchWithDiagnostics>;
  indexResearchFile?: (
    embeddingConfig: EmbeddingConfig,
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
  reindexFolder?: (
    embeddingConfig: EmbeddingConfig,
    folder: string,
  ) => Promise<number>;
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
  snippet?: string | null;
}

export interface StageLatencies {
  total_ms: number;
  embedding_ms: number;
  knn_ms: number;
  fts_ms: number;
  rrf_ms: number;
  mmr_ms: number;
  reranker_ms: number;
  metadata_ms: number;
}

export interface SearchDiagnostics {
  query: string;
  knn_candidate_count: number;
  fts_candidate_count: number;
  fused_candidate_count: number;
  mmr_candidate_count: number;
  reranked_candidate_count: number;
  metadata_match_count: number;
  final_result_count: number;
  reranker_threshold: number;
  latency_stage_ms: StageLatencies;
  error: string | null;
}

export interface SearchWithDiagnostics {
  results: SearchResult[];
  diagnostics: SearchDiagnostics[];
}

export interface ResearchFolderInfo {
  id: number;
  name: string;
  query: string | null;
  created_at: string;
  chunk_count: number;
}

export async function searchResearch(
  embeddingConfig: EmbeddingConfig,
  rerankerConfig: RerankerConfig,
  query: string | string[],
  options?: { folder?: string; limit?: number; filenames?: string[]; abortSignal?: AbortSignal },
): Promise<SearchResult[]> {
  const abortSignal = options?.abortSignal;
  const mock = getDevResearchSearchMock();
  if (mock?.searchResearch) {
    return abortablePromise(
      mock.searchResearch(embeddingConfig, rerankerConfig, query, options),
      abortSignal,
    );
  }

  const queries = Array.isArray(query) ? query : [query];
  return abortablePromise(
    invoke<SearchResult[]>("search_research", {
      embeddingConfig,
      rerankerConfig,
      queries,
      folder: options?.folder ?? null,
      limit: options?.limit ?? 8,
      filenames: options?.filenames ?? null,
    }),
    abortSignal,
  );
}

export async function searchResearchWithDiagnostics(
  embeddingConfig: EmbeddingConfig,
  rerankerConfig: RerankerConfig,
  query: string | string[],
  options?: { folder?: string; limit?: number; abortSignal?: AbortSignal },
): Promise<SearchWithDiagnostics> {
  const abortSignal = options?.abortSignal;
  const mock = getDevResearchSearchMock();
  if (mock?.searchResearchWithDiagnostics) {
    return abortablePromise(
      mock.searchResearchWithDiagnostics(
        embeddingConfig,
        rerankerConfig,
        query,
        options,
      ),
      abortSignal,
    );
  }

  const queries = Array.isArray(query) ? query : [query];
  return abortablePromise(
    invoke<SearchWithDiagnostics>("search_research_with_diagnostics", {
      embeddingConfig,
      rerankerConfig,
      queries,
      folder: options?.folder ?? null,
      limit: options?.limit ?? 8,
    }),
    abortSignal,
  );
}

export async function indexResearchFile(
  embeddingConfig: EmbeddingConfig,
  folder: string,
  filename: string,
  content: string,
): Promise<void> {
  const mock = getDevResearchSearchMock();
  if (mock?.indexResearchFile) {
    return mock.indexResearchFile(embeddingConfig, folder, filename, content);
  }

  return invoke("index_research_file", { embeddingConfig, folder, filename, content });
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

export async function backfillIndex(
  embeddingConfig: EmbeddingConfig,
  dimensions?: number,
): Promise<void> {
  return invoke("backfill_index", { embeddingConfig, dimensions: dimensions ?? null });
}

export async function reindexFolder(
  embeddingConfig: EmbeddingConfig,
  folder: string,
): Promise<number> {
  const mock = getDevResearchSearchMock();
  if (mock?.reindexFolder) {
    return mock.reindexFolder(embeddingConfig, folder);
  }

  return invoke<number>("reindex_folder", { embeddingConfig, folder });
}

function getDevResearchSearchMock(): ResearchSearchMock | null {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }

  return window.__deepSearchResearchSearchMock ?? null;
}
