import { invoke } from "@/lib/tauri-bridge";
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
  return invoke("index_research_file", { embeddingConfig, folder, filename, content });
}

export async function registerResearchFolder(
  name: string,
  query: string,
): Promise<number> {
  return invoke<number>("register_research_folder", { name, query });
}

export async function renameResearchFolderIndex(
  oldName: string,
  newName: string,
): Promise<void> {
  return invoke("rename_research_folder_index", { oldName, newName });
}

export async function deleteResearchFolderIndex(name: string): Promise<void> {
  return invoke("delete_research_folder_index", { name });
}

export async function deleteResearchFileIndex(
  folder: string,
  filename: string,
): Promise<void> {
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
  return invoke<number>("reindex_folder", { embeddingConfig, folder });
}
