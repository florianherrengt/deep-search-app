import { generateText, tool, zodSchema, type LanguageModel } from "ai";
import { z } from "zod";
import { extractPageContent } from "@/tools/extract-page-content-tool";

const URL_PATTERN = /https?:\/\/[^\s)\]>"')]+/g;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?>]+$/, "")))];
}

export const factsCheckInputSchema = z.object({
  originalPrompt: z
    .string()
    .min(1)
    .describe(
      "The original research objective, including the user's questions and clarifications.",
    ),
  finalResearch: z
    .string()
    .min(1)
    .describe(
      "The final research answer/report to fact-check. Must include the source URLs cited in the text.",
    ),
});

export type FactsCheckInput = z.infer<typeof factsCheckInputSchema>;

const FACTS_CHECK_SYSTEM = `You are a fact-checking assistant. You will receive:
1. A research answer that contains factual claims and source URLs.
2. The content extracted from each cited source.

Your job is to check whether the high-risk factual claims in the research answer are supported by the cited sources. Focus on:
- Exact numbers, prices, dimensions, dates, quantities, statistics
- Named entities, product availability, regulatory/legal claims
- Any claim that would materially change the answer if wrong

Ignore narrative, style, opinions, and generic explanations.

For each claim you check, state:
- The claim from the research answer
- What the source actually says (quote if possible)
- Whether the claim is confirmed, contradicted, or unverifiable from the sources

If all checked claims are confirmed, say so. If something is wrong or unsupported, state the incorrect claim, the corrected information, and the basis for the correction. If a source could not be fetched, say so explicitly.

Return plain text, not JSON.`;

export function createFactsCheckTool(model: LanguageModel) {
  return tool({
    description:
      "Call this before giving the final answer. It extracts source URLs from the research text, opens each one, and checks whether the high-risk factual claims are supported by those sources.",
    strict: true,
    inputSchema: zodSchema(factsCheckInputSchema),
    outputSchema: zodSchema(
      z.string().describe("Plain-text fact-check notes"),
    ),
    execute: async (input, options) => {
      const urls = extractUrls(input.finalResearch);

      if (urls.length === 0) {
        return "No source URLs found in the research text. Fact-check could not be performed.";
      }

      const fetchResults = await Promise.allSettled(
        urls.map(async (url) => {
          const content = await extractPageContent(url, {
            summarize: false,
            abortSignal: options?.abortSignal,
          });
          return { url, content };
        }),
      );

      const sourceSections: string[] = [];
      for (let i = 0; i < fetchResults.length; i++) {
        const result = fetchResults[i];
        const url = urls[i];
        if (result.status === "fulfilled" && result.value.content) {
          sourceSections.push(
            `--- Source ${i + 1}: ${url} ---\n${result.value.content}`,
          );
        } else {
          const reason =
            result.status === "rejected"
              ? result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
              : "empty content";
          sourceSections.push(
            `--- Source ${i + 1}: ${url} ---\n[Could not fetch: ${reason}]`,
          );
        }
      }

      const prompt = [
        "Original research objective:",
        input.originalPrompt,
        "",
        "Research answer to fact-check:",
        input.finalResearch,
        "",
        "Cited source contents:",
        ...sourceSections,
      ].join("\n");

      const { text } = await generateText({
        model,
        system: FACTS_CHECK_SYSTEM,
        prompt,
        abortSignal: options?.abortSignal,
      });

      return text.trim() || "Fact-check completed, but no notes were returned.";
    },
  });
}
