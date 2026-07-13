import { ChatHistoryEmbeddingClient } from "@/lib/chat-history-embedding-client";
import {
  loadChatHistoryEmbeddingCache,
  saveChatHistoryEmbeddingCache,
} from "@/lib/chat-history-embedding-cache";
import { loadChatHistorySearchRecords } from "@/lib/chat-history-search-corpus";
import type {
  ChatHistorySearchOptions,
  ChatHistorySearchResult,
} from "@/lib/chat-history-search-index";
import {
  ChatHistorySearchService,
  type ChatHistoryHybridSearchServiceOptions,
} from "@/lib/chat-history-search-service";
import { subscribeResearchLibraryChanged } from "@/lib/research-library-events";

let service: ChatHistorySearchService | null = null;
let embeddingClient: ChatHistoryEmbeddingClient | null = null;

export async function warmChatHistorySearch(): Promise<void> {
  await requestPersistentStorage();
  await getService().warmKeywordIndex();
}

export function searchChatHistoryKeyword(
  query: string,
  options: ChatHistoryHybridSearchServiceOptions = {},
): Promise<ChatHistorySearchResult[]> {
  return getService().searchKeyword(query, options);
}

export function searchChatHistoryHybrid(
  query: string | string[],
  options: ChatHistoryHybridSearchServiceOptions = {},
): Promise<ChatHistorySearchResult[]> {
  return getService().searchHybrid(query, options);
}

export type { ChatHistorySearchOptions, ChatHistorySearchResult };

function getService() {
  if (!service) {
    service = new ChatHistorySearchService({
      loadRecords: loadChatHistorySearchRecords,
      embed: (texts, abortSignal) => getEmbeddingClient().embed(texts, abortSignal),
      loadEmbeddingCache: loadChatHistoryEmbeddingCache,
      saveEmbeddingCache: saveChatHistoryEmbeddingCache,
      subscribeChanges: (listener) =>
        subscribeResearchLibraryChanged(() => listener()),
    });
  }
  return service;
}

function getEmbeddingClient() {
  if (!embeddingClient) embeddingClient = new ChatHistoryEmbeddingClient();
  return embeddingClient;
}

async function requestPersistentStorage() {
  try {
    await globalThis.navigator?.storage?.persist?.();
  } catch {
    // Search remains functional when durable browser storage is unavailable.
  }
}
