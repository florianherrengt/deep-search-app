import {
  streamText,
  stepCountIs,
  tool,
  zodSchema,
  type LanguageModel,
  type ToolSet,
} from "ai";
import { z } from "zod";
import { createBraveSearchTool } from "@/tools/brave-search-tool";
import { createExaSearchTool } from "@/tools/exa-search-tool";
import { createSerperSearchTool } from "@/tools/serper-search-tool";
import { createTavilySearchTool } from "@/tools/tavily-search-tool";
import { createSearXNGSearchTool } from "@/tools/searxng-search-tool";
import { collectSubAgentTextStream } from "@/lib/sub-agent-stream";
import {
  extractPageContent,
  extractPageContentInputSchema,
} from "@/tools/extract-page-content-tool";
import { isValidServiceUrl } from "@/lib/url-validation";

interface VerificationSearchKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
}

export const verifiedResearchInputSchema = z.object({
  originalPrompt: z
    .string()
    .min(1)
    .describe(
      "The original research objective, including the user's questions and clarifications. Do not include the full conversation history.",
    ),
  finalResearch: z
    .string()
    .min(1)
    .describe(
      "The final research answer/report to verify. Do not include working notes or source dumps.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "Optional short summary of what the research set out to answer.",
    ),
});

export type VerifiedResearchInput = z.infer<
  typeof verifiedResearchInputSchema
>;

const VERIFIER_SYSTEM = `You are an isolated factual verification subagent.

You do not know the previous conversation, prior tool calls, notes, or sources. You only know the original research objective and the final research answer supplied in this request.

Verify only high-risk factual claims:
- exact numbers, dimensions, prices, dates, quantities, statistics, rankings, and comparisons
- named entities, current/latest claims, product availability, legal/regulatory, medical, financial, and safety claims
- factual claims that would materially change the answer if wrong

Ignore low-risk narrative, style, opinions, generic explanations, and claims that are not material.

Use fresh searches and page reads when tools are available. Do not trust citations, URLs, or source names in the final answer; treat them only as possible leads and independently verify the claims.

Return plain text, not JSON. If the checked high-risk claims appear correct, say that verification found no high-risk factual errors. If something is wrong or unsupported, state the incorrect claim, the corrected information, and the basis for the correction. If fresh verification is limited because no search tools are available, say that explicitly.`;

export function createVerifiedResearchIsGoodTool(
  model: LanguageModel,
  searchKeys?: VerificationSearchKeys,
) {
  return tool({
    description:
      "Call this when the research is done and before giving the final answer. It runs an isolated verifier that sees only the original research objective, an optional summary, and the final research answer, then fresh-checks high-risk factual claims.",
    strict: true,
    inputSchema: zodSchema(verifiedResearchInputSchema),
    outputSchema: zodSchema(z.string().describe("Plain-text verification notes")),
    execute: async (input, options) => {
      return verifyResearch(model, input, searchKeys, {
        abortSignal: options?.abortSignal,
        streamContext: options?.experimental_context,
      });
    },
  });
}

async function verifyResearch(
  model: LanguageModel,
  input: VerifiedResearchInput,
  searchKeys?: VerificationSearchKeys,
  options?: {
    abortSignal?: AbortSignal;
    streamContext?: unknown;
  },
) {
  const verificationTools = createVerificationTools(model, searchKeys);
  const toolNames = Object.keys(verificationTools);
  const freshSearchStatus = toolNames.some((name) => name.endsWith("_search"))
    ? `Fresh search tools available: ${toolNames.join(", ")}`
    : "No fresh search tools are configured. You may read URLs present in the final answer if useful, but you must clearly state that fresh web-search verification was not available.";

  const result = streamText({
    model,
    system: VERIFIER_SYSTEM,
    prompt: [
      freshSearchStatus,
      "",
      "Original research objective:",
      input.originalPrompt,
      "",
      input.summary ? `Research summary:\n${input.summary}\n` : "",
      "Final research answer to verify:",
      input.finalResearch,
    ].join("\n"),
    tools: verificationTools,
    activeTools: toolNames as Array<keyof typeof verificationTools>,
    stopWhen: stepCountIs(8),
    abortSignal: options?.abortSignal,
  });
  const text = await collectSubAgentTextStream({
    stream: result.fullStream,
    context: options?.streamContext,
  });

  return text.trim() || "Verification completed, but no notes were returned.";
}

function createVerificationTools(
  model: LanguageModel,
  searchKeys?: VerificationSearchKeys,
) {
  return {
    ...(searchKeys?.braveApiKey
      ? { brave_search: createBraveSearchTool(searchKeys.braveApiKey) }
      : {}),
    ...(searchKeys?.exaApiKey
      ? { exa_search: createExaSearchTool(searchKeys.exaApiKey) }
      : {}),
    ...(searchKeys?.serperApiKey
      ? { serper_search: createSerperSearchTool(searchKeys.serperApiKey) }
      : {}),
    ...(searchKeys?.tavilyApiKey
      ? { tavily_search: createTavilySearchTool(searchKeys.tavilyApiKey) }
      : {}),
    ...(searchKeys?.searxngBaseUrl && isValidServiceUrl(searchKeys.searxngBaseUrl)
      ? { searxng_search: createSearXNGSearchTool(searchKeys.searxngBaseUrl) }
      : {}),
    read_verification_page: createVerificationPageReader(model),
  } as const satisfies ToolSet;
}

function createVerificationPageReader(model: LanguageModel) {
  return tool({
    description:
      "Read a web page for the isolated verification pass. Use this after fresh search results to inspect a source before deciding whether a high-risk claim is correct.",
    strict: true,
    inputSchema: zodSchema(extractPageContentInputSchema),
    outputSchema: zodSchema(z.string().describe("Extracted page content")),
    execute: async ({ url, query, summarize, method }, options) => {
      return extractPageContent(url, {
        query,
        summarize,
        method,
        model,
        abortSignal: options?.abortSignal,
      });
    },
  });
}
