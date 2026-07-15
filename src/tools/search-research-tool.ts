import { tool, zodSchema } from "ai";
import { z } from "zod";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { searchChatHistoryHybrid } from "@/lib/chat-history-search";

const ResearchChatMatchSchema = z.object({
  folder_name: z.string(),
  chat_id: z.string(),
  title: z.string(),
  matched_query: z.string(),
  updated_at: z.string().nullable(),
  score: z.number(),
  relevant_memories: z.array(z.string()),
});

export const searchResearchInputSchema = z.object({
  query: z
    .union([z.string(), z.array(z.string())])
    .describe("Natural language search query, or multiple queries to search in parallel"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe("Max chat results (default 8)"),
});

export function createSearchResearchTool(
  getResearchFolder?: () => Promise<string | null | undefined>,
) {
  return tool({
    description:
      "Search the user's saved chat history using local keyword and semantic retrieval. This searches chat titles and user-authored messages, not the web or generated research files. Returns exact chats that can be opened. The current research folder is excluded when known.",
    strict: true,
    inputSchema: zodSchema(searchResearchInputSchema),
    outputSchema: zodSchema(z.array(ResearchChatMatchSchema)),
    execute: async ({ query, limit }, options) => {
      const rawCurrentFolder = await getResearchFolder?.();
      const currentFolder = rawCurrentFolder
        ? SafePathSegmentSchema.parse(rawCurrentFolder)
        : null;

      const matches = await searchChatHistoryHybrid(query, {
        abortSignal: options?.abortSignal,
        limit: limit ?? 8,
        exclude: currentFolder ? { folderName: currentFolder } : undefined,
      });

      return matches.map((match) => ({
        folder_name: match.folderName,
        chat_id: match.chatId,
        title: match.title,
        matched_query: match.matchedText,
        updated_at: match.updatedAt,
        score: match.score,
        // Kept for compatibility with the existing research prompt/tool shape.
        relevant_memories: [],
      }));
    },
  });
}
