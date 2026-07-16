import { tool, zodSchema } from "ai";
import { z } from "zod";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import {
  searchChatHistoryHybrid,
  searchResearchMemoriesHybrid,
} from "@/lib/chat-history-search";

const ResearchChatMatchSchema = z.object({
  result_type: z.literal("research_chat"),
  folder_name: z.string(),
  chat_id: z.string(),
  title: z.string(),
  matched_query: z.string(),
  updated_at: z.string().nullable(),
  score: z.number(),
  relevant_memories: z.array(z.string()),
});

const ResearchMemoryMatchSchema = z.object({
  result_type: z.literal("memory"),
  source_folder: z.string(),
  memory: z.string(),
  updated_at: z.string().nullable(),
  score: z.number(),
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
      "Search the user's saved research and per-folder memories using local keyword and semantic retrieval. This does not search the web. A research_chat result is an exact prior chat and may justify continuing its folder. A memory result is only a relevant stored user fact; use it silently when useful and never ask to continue a folder because of a memory-only result. The current research folder is excluded because its context is already supplied separately.",
    strict: true,
    inputSchema: zodSchema(searchResearchInputSchema),
    outputSchema: zodSchema(
      z.array(
        z.discriminatedUnion("result_type", [
          ResearchChatMatchSchema,
          ResearchMemoryMatchSchema,
        ]),
      ),
    ),
    execute: async ({ query, limit }, options) => {
      const rawCurrentFolder = await getResearchFolder?.();
      const currentFolder = rawCurrentFolder
        ? SafePathSegmentSchema.parse(rawCurrentFolder)
        : null;

      const searchOptions = {
        abortSignal: options?.abortSignal,
        limit: limit ?? 8,
        exclude: currentFolder ? { folderName: currentFolder } : undefined,
      };
      const [matches, memoryMatches] = await Promise.all([
        searchChatHistoryHybrid(query, searchOptions),
        searchResearchMemoriesHybrid(query, searchOptions),
      ]);

      const matchedFolders = new Set(matches.map((match) => match.folderName));
      const memoriesByFolder = new Map<string, string[]>();
      for (const memoryMatch of memoryMatches) {
        const memories = memoriesByFolder.get(memoryMatch.folderName) ?? [];
        if (!memories.includes(memoryMatch.memory)) {
          memories.push(memoryMatch.memory);
          memoriesByFolder.set(memoryMatch.folderName, memories);
        }
      }

      const researchMatches = matches.map((match) => ({
        result_type: "research_chat" as const,
        folder_name: match.folderName,
        chat_id: match.chatId,
        title: match.title,
        matched_query: match.matchedText,
        updated_at: match.updatedAt,
        score: match.score,
        relevant_memories: memoriesByFolder.get(match.folderName) ?? [],
      }));
      const memoryOnlyMatches = memoryMatches.flatMap((match) =>
        matchedFolders.has(match.folderName)
          ? []
          : [
              {
                result_type: "memory" as const,
                source_folder: match.folderName,
                memory: match.memory,
                updated_at: match.updatedAt,
                score: match.score,
              },
            ],
      );

      return [...researchMatches, ...memoryOnlyMatches];
    },
  });
}
