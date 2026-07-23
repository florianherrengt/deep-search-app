import { z } from "zod";
import { CHAT_HISTORY_EMBEDDING_DIMENSIONS } from "@/lib/chat-history-embedding-config";

/**
 * Shape of a single stored/embedded vector. Backed by Zod so the persisted
 * cache, the search service, and the in-memory index all enforce the same rule.
 */
export const EmbeddingVectorSchema = z
  .array(z.number().finite())
  .length(CHAT_HISTORY_EMBEDDING_DIMENSIONS);

/**
 * Strict type guard for a single embedding vector: exactly
 * {@link CHAT_HISTORY_EMBEDDING_DIMENSIONS} finite numbers. Kept as a predicate
 * because callers use it inside `.filter()` / `.every()`.
 */
export function isValidEmbedding(
  value: number[] | undefined,
): value is number[] {
  return EmbeddingVectorSchema.safeParse(value).success;
}
