import { create, insertMultiple, search } from "@orama/orama";

export const CHAT_HISTORY_EMBEDDING_DIMENSIONS = 384;

const BASE_SCHEMA = {
  id: "string",
  recordKind: "enum",
  chatKey: "enum",
  folderName: "enum",
  folderLabel: "string",
  chatId: "enum",
  chatTitle: "string",
  query: "string",
  updatedAt: "string",
  updatedAtTimestamp: "number",
} as const;

const VECTOR_SCHEMA = {
  ...BASE_SCHEMA,
  embedding: `vector[${CHAT_HISTORY_EMBEDDING_DIMENSIONS}]` as const,
};

const SEARCH_PROPERTIES = ["query", "chatTitle", "folderLabel"] as const;
const SEARCH_BOOST = {
  query: 4,
  chatTitle: 2,
  folderLabel: 1,
} as const;

export interface ChatHistorySearchRecord {
  id: string;
  recordKind: "chat" | "memory";
  folderName: string;
  chatId: string;
  title: string;
  query: string;
  updatedAt: string | null;
}

export interface ChatHistorySearchResult {
  recordKind: "chat" | "memory";
  folderName: string;
  chatId: string;
  title: string;
  matchedText: string;
  updatedAt: string | null;
  score: number;
}

export interface ChatHistorySearchOptions {
  limit?: number;
  exclude?: { folderName: string };
  recordKind?: "chat" | "memory";
}

export interface ChatHistoryHybridSearchOptions extends ChatHistorySearchOptions {
  similarity?: number;
}

interface ChatSearchDocument {
  id: string;
  recordKind: "chat" | "memory";
  chatKey: string;
  folderName: string;
  folderLabel: string;
  chatId: string;
  chatTitle: string;
  query: string;
  updatedAt: string;
  updatedAtTimestamp: number;
}

interface ChatSearchVectorDocument extends ChatSearchDocument {
  embedding: number[];
}

type EmbeddingsByRecordId = Record<string, number[]>;

export class ChatHistorySearchIndex {
  private constructor(
    private readonly keywordIndex: ReturnType<typeof createKeywordIndex>,
    private readonly vectorIndex: ReturnType<typeof createVectorIndex> | null,
  ) {}

  static async create(
    records: ChatHistorySearchRecord[],
    options: { embeddings?: EmbeddingsByRecordId } = {},
  ): Promise<ChatHistorySearchIndex> {
    const keywordIndex = createKeywordIndex();
    const keywordDocuments = records.map(toSearchDocument);
    await Promise.resolve(insertMultiple(keywordIndex, keywordDocuments));

    const embeddings = options.embeddings;
    if (!embeddings) {
      return new ChatHistorySearchIndex(keywordIndex, null);
    }

    const vectorDocuments = records.flatMap((record) => {
      const embedding = embeddings[record.id];
      if (!isValidEmbedding(embedding)) return [];
      return [{ ...toSearchDocument(record), embedding }];
    });

    if (vectorDocuments.length === 0) {
      return new ChatHistorySearchIndex(keywordIndex, null);
    }

    const vectorIndex = createVectorIndex();
    await Promise.resolve(insertMultiple(vectorIndex, vectorDocuments));
    return new ChatHistorySearchIndex(keywordIndex, vectorIndex);
  }

  async searchKeyword(
    query: string,
    options: ChatHistorySearchOptions = {},
  ): Promise<ChatHistorySearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];

    const result = await Promise.resolve(
      search(this.keywordIndex, {
        term: normalizedQuery,
        properties: [...SEARCH_PROPERTIES],
        boost: SEARCH_BOOST,
        tolerance: keywordTolerance(normalizedQuery),
        limit: normalizeLimit(options.limit),
        distinctOn: "chatKey",
        where: searchWhere(options),
      }),
    );

    return result.hits.map((hit) => toSearchResult(hit.document, hit.score));
  }

  async searchHybrid(
    query: string,
    queryEmbedding: number[],
    options: ChatHistoryHybridSearchOptions = {},
  ): Promise<ChatHistorySearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];
    if (!this.vectorIndex || !isValidEmbedding(queryEmbedding)) {
      return this.searchKeyword(normalizedQuery, options);
    }

    const result = await Promise.resolve(
      search(this.vectorIndex, {
        mode: "hybrid",
        term: normalizedQuery,
        vector: {
          value: queryEmbedding,
          property: "embedding",
        },
        properties: [...SEARCH_PROPERTIES],
        tolerance: keywordTolerance(normalizedQuery),
        similarity: options.similarity ?? 0.5,
        limit: Math.max(normalizeLimit(options.limit) * 4, 20),
        where: searchWhere(options),
      }),
    );

    return groupChatResults(
      result.hits.map((hit) => toSearchResult(hit.document, hit.score)),
      normalizeLimit(options.limit),
    );
  }
}

function createKeywordIndex() {
  return create({ schema: BASE_SCHEMA, language: "english" });
}

function createVectorIndex() {
  return create({ schema: VECTOR_SCHEMA, language: "english" });
}

function toSearchDocument(record: ChatHistorySearchRecord): ChatSearchDocument {
  return {
    id: record.id,
    chatKey:
      record.recordKind === "chat"
        ? chatKey(record.folderName, record.chatId)
        : record.id,
    recordKind: record.recordKind,
    folderName: record.folderName,
    folderLabel: record.folderName.replace(/[-_]+/g, " "),
    chatId: record.chatId,
    chatTitle: record.title,
    query: record.query,
    updatedAt: record.updatedAt ?? "",
    updatedAtTimestamp: sortableTimestamp(record.updatedAt),
  };
}

function toSearchResult(
  document: unknown,
  score: number,
): ChatHistorySearchResult {
  const value = document as ChatSearchDocument | ChatSearchVectorDocument;
  return {
    recordKind: value.recordKind as "chat" | "memory",
    folderName: value.folderName,
    chatId: value.chatId,
    title: value.chatTitle,
    matchedText: value.query,
    updatedAt: value.updatedAt || null,
    score,
  };
}

function groupChatResults(results: ChatHistorySearchResult[], limit: number) {
  const bestByChat = new Map<string, ChatHistorySearchResult>();
  for (const result of results) {
    const key = resultKey(result);
    const current = bestByChat.get(key);
    if (!current || result.score > current.score) {
      bestByChat.set(key, result);
    }
  }
  return [...bestByChat.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function searchWhere(options: ChatHistorySearchOptions) {
  const conditions = [
    ...(options.exclude
      ? [{ folderName: { nin: [options.exclude.folderName] } }]
      : []),
    ...(options.recordKind
      ? [{ recordKind: { eq: options.recordKind } }]
      : []),
  ];
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { and: conditions };
}

function chatKey(folderName: string, chatId: string) {
  return JSON.stringify([folderName, chatId]);
}

function resultKey(result: ChatHistorySearchResult) {
  return result.recordKind === "chat"
    ? chatKey(result.folderName, result.chatId)
    : JSON.stringify([result.folderName, result.matchedText]);
}

function normalizeLimit(limit?: number) {
  if (limit == null) return 10;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function keywordTolerance(query: string) {
  return query.length >= 4 ? 1 : 0;
}

function sortableTimestamp(value: string | null) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isValidEmbedding(value: number[] | undefined): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === CHAT_HISTORY_EMBEDDING_DIMENSIONS &&
    value.every(Number.isFinite)
  );
}
