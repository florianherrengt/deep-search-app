import { tool, zodSchema } from "ai";
import { fetch } from "@/lib/tauri-bridge";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";

const API_URL = "https://api.duckduckgo.com/";
const MAX_RELATED_TOPICS = 8;

const OptionalStringSchema = z.string().nullable().optional();

const DuckDuckGoResponseSchema = z
  .object({
    Heading: OptionalStringSchema,
    AbstractText: OptionalStringSchema,
    Definition: OptionalStringSchema,
    Answer: OptionalStringSchema,
    Type: OptionalStringSchema,
    RelatedTopics: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

const DuckDuckGoRelatedTopicSchema = z
  .object({
    Text: OptionalStringSchema,
    Topics: z.array(z.unknown()).optional(),
  })
  .passthrough();

function cleanString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function flattenRelatedTopicText(relatedTopics: unknown[]): string[] {
  const flattened: string[] = [];

  function visit(topic: unknown) {
    const parsed = DuckDuckGoRelatedTopicSchema.safeParse(topic);
    if (!parsed.success) return;

    const text = cleanString(parsed.data.Text);
    if (text) {
      flattened.push(text);
    }

    for (const child of parsed.data.Topics ?? []) {
      visit(child);
    }
  }

  for (const topic of relatedTopics) {
    visit(topic);
  }

  return flattened;
}

async function fetchDuckDuckGo(
  term: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  return rateLimit(async () => {
    const url = new URL(API_URL);
    url.searchParams.set("q", term.trim());
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "0");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      signal: abortSignal,
    });

    if (!response.ok) {
      return "";
    }

    const raw = await response.json().catch(() => null);

    const parsed = DuckDuckGoResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return "";
    }

    const data = parsed.data;
    const lines: string[] = [];

    const heading = cleanString(data.Heading);
    const abstract = cleanString(data.AbstractText);
    const definition = cleanString(data.Definition);
    const answer = cleanString(data.Answer);

    if (heading) lines.push(heading);
    if (abstract) lines.push(abstract);
    if (definition && definition !== abstract) lines.push(definition);
    if (answer && answer !== abstract && answer !== definition)
      lines.push(answer);

    const related = flattenRelatedTopicText(data.RelatedTopics)
      .slice(0, MAX_RELATED_TOPICS)
      .filter((t) => !lines.includes(t));
    if (related.length > 0) {
      lines.push("Related: " + related.join(", "));
    }

    return lines.join("\n");
  }, abortSignal);
}

export const disambiguateInputSchema = z.object({
  terms: z.array(z.string()).describe("Specific terms to disambiguate. Only include terms that are genuinely ambiguous — e.g., acronyms with multiple expansions, words with common alternate meanings, or unfamiliar jargon. Do not include common unambiguous words."),
});

export const disambiguateTool = tool({
  description:
    "Resolve genuinely ambiguous terms — acronyms with multiple meanings, words that change meaning by context, or unfamiliar jargon. Do NOT use this as a general research or lookup tool. Pass only the specific terms that need disambiguation.",
  strict: true,
  inputSchema: zodSchema(disambiguateInputSchema),
  execute: async ({ terms }, options) => {
    const results: string[] = [];

    for (const term of terms) {
      const ddgResult = await fetchDuckDuckGo(term, options?.abortSignal);
      results.push(`${term}: ${ddgResult || "no ambiguity."}`);
    }

    return results.join("\n");
  },
});
