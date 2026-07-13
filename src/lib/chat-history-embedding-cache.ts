import { z } from "zod";
import { loadStore } from "@/lib/tauri-bridge";
import {
  CHAT_HISTORY_EMBEDDING_DIMENSIONS,
} from "@/lib/chat-history-search-index";
import { CHAT_HISTORY_EMBEDDING_CACHE_KEY } from "@/lib/chat-history-embedding-config";
import type { ChatHistoryEmbeddingCache } from "@/lib/chat-history-search-service";

const STORE_FILENAME = "chat-history-search.json";
const STORE_KEY = "embedding-cache";

const StoredEmbeddingCacheSchema = z.object({
  version: z.literal(1),
  model: z.literal(CHAT_HISTORY_EMBEDDING_CACHE_KEY),
  entries: z.record(
    z.string(),
    z.object({
      fingerprint: z.string(),
      embedding: z
        .array(z.number().finite())
        .length(CHAT_HISTORY_EMBEDDING_DIMENSIONS),
    }),
  ),
});

let storePromise: ReturnType<typeof loadStore> | null = null;

export async function loadChatHistoryEmbeddingCache(): Promise<ChatHistoryEmbeddingCache> {
  try {
    const store = await getStore();
    const parsed = StoredEmbeddingCacheSchema.safeParse(
      await store.get<unknown>(STORE_KEY),
    );
    return parsed.success ? { entries: parsed.data.entries } : { entries: {} };
  } catch (error) {
    console.warn("[chat-history-search] failed to load embedding cache", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { entries: {} };
  }
}

export async function saveChatHistoryEmbeddingCache(
  cache: ChatHistoryEmbeddingCache,
): Promise<void> {
  const parsed = StoredEmbeddingCacheSchema.parse({
    version: 1,
    model: CHAT_HISTORY_EMBEDDING_CACHE_KEY,
    entries: cache.entries,
  });
  const store = await getStore();
  await store.set(STORE_KEY, parsed);
  await store.save();
}

function getStore() {
  if (!storePromise) {
    const promise = loadStore(STORE_FILENAME, { autoSave: false });
    storePromise = promise;
    void promise.catch(() => {
      if (storePromise === promise) storePromise = null;
    });
  }
  return storePromise;
}
