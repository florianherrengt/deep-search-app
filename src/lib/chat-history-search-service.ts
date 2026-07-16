import { isAbortError } from "@/lib/abort";
import {
  ChatHistorySearchIndex,
  CHAT_HISTORY_EMBEDDING_DIMENSIONS,
  type ChatHistorySearchOptions,
  type ChatHistorySearchRecord,
  type ChatHistorySearchResult,
} from "@/lib/chat-history-search-index";

const EMBEDDING_BATCH_SIZE = 16;

interface EmbeddingCacheEntry {
  fingerprint: string;
  embedding: number[];
}

export interface ChatHistoryEmbeddingCache {
  entries: Record<string, EmbeddingCacheEntry>;
}

export interface ChatHistorySearchServiceDependencies {
  loadRecords: () => Promise<ChatHistorySearchRecord[]>;
  embed: (texts: string[], abortSignal?: AbortSignal) => Promise<number[][]>;
  loadEmbeddingCache: () => Promise<ChatHistoryEmbeddingCache>;
  saveEmbeddingCache: (cache: ChatHistoryEmbeddingCache) => Promise<void>;
  subscribeChanges: (listener: () => void) => () => void;
}

interface LoadedKeywordIndex {
  generation: number;
  records: ChatHistorySearchRecord[];
  index: ChatHistorySearchIndex;
}

interface LoadedSemanticIndex extends LoadedKeywordIndex {
  embeddings: Record<string, number[]>;
}

export interface ChatHistoryHybridSearchServiceOptions
  extends ChatHistorySearchOptions {
  abortSignal?: AbortSignal;
}

export class ChatHistorySearchService {
  private generation = 0;
  private keywordPromise: Promise<LoadedKeywordIndex> | null = null;
  private semanticPromise: Promise<LoadedSemanticIndex> | null = null;
  private embeddingCachePromise: Promise<ChatHistoryEmbeddingCache> | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly dependencies: ChatHistorySearchServiceDependencies) {
    this.unsubscribe = dependencies.subscribeChanges(() => this.invalidate());
  }

  dispose() {
    this.unsubscribe();
  }

  invalidate() {
    this.generation += 1;
    this.keywordPromise = null;
    this.semanticPromise = null;
  }

  async warmKeywordIndex(): Promise<void> {
    await this.ensureKeywordIndex();
  }

  async searchKeyword(
    query: string,
    options: ChatHistoryHybridSearchServiceOptions = {},
  ): Promise<ChatHistorySearchResult[]> {
    throwIfAborted(options.abortSignal);
    const loaded = await this.ensureKeywordIndex();
    throwIfAborted(options.abortSignal);
    return loaded.index.searchKeyword(query, options);
  }

  async searchHybrid(
    query: string | string[],
    options: ChatHistoryHybridSearchServiceOptions = {},
  ): Promise<ChatHistorySearchResult[]> {
    const queries = (Array.isArray(query) ? query : [query])
      .map((value) => value.trim())
      .filter(Boolean);
    if (queries.length === 0) return [];

    try {
      throwIfAborted(options.abortSignal);
      const loaded = await this.ensureSemanticIndex();
      throwIfAborted(options.abortSignal);
      const queryEmbeddings = await this.dependencies.embed(
        queries,
        options.abortSignal,
      );
      validateEmbeddingBatch(queryEmbeddings, queries.length);
      throwIfAborted(options.abortSignal);

      const perQueryLimit = Math.max(normalizeLimit(options.limit), 10);
      const resultSets = await Promise.all(
        queries.map((value, index) =>
          loaded.index.searchHybrid(value, queryEmbeddings[index], {
            ...options,
            limit: perQueryLimit,
          }),
        ),
      );

      return mergeChatResults(resultSets, normalizeLimit(options.limit));
    } catch (error) {
      if (isAbortError(error) || options.abortSignal?.aborted) throw error;
      console.warn("[chat-history-search] semantic search unavailable; using keyword search", {
        error: error instanceof Error ? error.message : "unknown",
      });

      const resultSets = await Promise.all(
        queries.map((value) => this.searchKeyword(value, options)),
      );
      return mergeChatResults(resultSets, normalizeLimit(options.limit));
    }
  }

  private async ensureKeywordIndex(): Promise<LoadedKeywordIndex> {
    while (true) {
      const generation = this.generation;
      if (!this.keywordPromise) {
        const promise = this.buildKeywordIndex(generation);
        this.keywordPromise = promise;
        void promise.catch(() => {
          if (this.keywordPromise === promise) this.keywordPromise = null;
        });
      }

      const loaded = await this.keywordPromise;
      if (loaded.generation === this.generation) return loaded;
    }
  }

  private async buildKeywordIndex(generation: number): Promise<LoadedKeywordIndex> {
    const records = await this.dependencies.loadRecords();
    const index = await ChatHistorySearchIndex.create(records);
    return { generation, records, index };
  }

  private async ensureSemanticIndex(): Promise<LoadedSemanticIndex> {
    while (true) {
      const generation = this.generation;
      if (!this.semanticPromise) {
        const promise = this.buildSemanticIndex(generation);
        this.semanticPromise = promise;
        void promise.catch(() => {
          if (this.semanticPromise === promise) this.semanticPromise = null;
        });
      }

      const loaded = await this.semanticPromise;
      if (loaded.generation === this.generation) return loaded;
    }
  }

  private async buildSemanticIndex(generation: number): Promise<LoadedSemanticIndex> {
    const keyword = await this.ensureKeywordIndex();
    const cache = await this.loadEmbeddingCache();
    const embeddings: Record<string, number[]> = {};
    const missing: ChatHistorySearchRecord[] = [];

    for (const record of keyword.records) {
      const entry = cache.entries[record.id];
      if (
        entry?.fingerprint === fingerprint(record.query) &&
        isValidEmbedding(entry.embedding)
      ) {
        embeddings[record.id] = entry.embedding;
      } else {
        missing.push(record);
      }
    }

    for (let offset = 0; offset < missing.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = missing.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      // Index construction is shared state. Do not let one cancelled search
      // tear down model loading or the reusable embedding backfill.
      const batchEmbeddings = await this.dependencies.embed(
        batch.map((record) => record.query),
      );
      validateEmbeddingBatch(batchEmbeddings, batch.length);
      batch.forEach((record, index) => {
        embeddings[record.id] = batchEmbeddings[index];
      });
    }

    const nextCache: ChatHistoryEmbeddingCache = {
      entries: Object.fromEntries(
        keyword.records.map((record) => [
          record.id,
          {
            fingerprint: fingerprint(record.query),
            embedding: embeddings[record.id],
          },
        ]),
      ),
    };
    // Keep the in-memory cache coherent across library invalidations. The
    // store is intentionally loaded once per app session.
    cache.entries = nextCache.entries;
    await this.dependencies.saveEmbeddingCache(nextCache).catch((error) => {
      console.warn("[chat-history-search] failed to save embedding cache", {
        error: error instanceof Error ? error.message : "unknown",
      });
    });

    const index = await ChatHistorySearchIndex.create(keyword.records, {
      embeddings,
    });
    return {
      generation,
      records: keyword.records,
      index,
      embeddings,
    };
  }

  private loadEmbeddingCache() {
    if (!this.embeddingCachePromise) {
      const promise = this.dependencies.loadEmbeddingCache();
      this.embeddingCachePromise = promise;
      void promise.catch(() => {
        if (this.embeddingCachePromise === promise) {
          this.embeddingCachePromise = null;
        }
      });
    }
    return this.embeddingCachePromise;
  }
}

function mergeChatResults(
  resultSets: ChatHistorySearchResult[][],
  limit: number,
) {
  const bestByChat = new Map<string, ChatHistorySearchResult>();
  for (const result of resultSets.flat()) {
    const key =
      result.recordKind === "chat"
        ? JSON.stringify([result.folderName, result.chatId])
        : JSON.stringify([result.folderName, result.matchedText]);
    const current = bestByChat.get(key);
    if (!current || result.score > current.score) {
      bestByChat.set(key, result);
    }
  }

  return [...bestByChat.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function validateEmbeddingBatch(embeddings: number[][], expectedLength: number) {
  if (
    embeddings.length !== expectedLength ||
    !embeddings.every(isValidEmbedding)
  ) {
    throw new Error("Embedding worker returned an invalid vector batch.");
  }
}

function isValidEmbedding(value: number[] | undefined): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === CHAT_HISTORY_EMBEDDING_DIMENSIONS &&
    value.every(Number.isFinite)
  );
}

function fingerprint(value: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

function normalizeLimit(limit?: number) {
  if (limit == null) return 8;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function throwIfAborted(abortSignal?: AbortSignal) {
  if (!abortSignal?.aborted) return;
  throw abortSignal.reason ?? new DOMException("Aborted", "AbortError");
}
