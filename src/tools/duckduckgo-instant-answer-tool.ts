import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import Bottleneck from "bottleneck";

const API_URL = "https://api.duckduckgo.com/";
const DEFAULT_REQUESTS_PER_SECOND = 1;
const MAX_RELATED_TOPICS = 12;

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000 / DEFAULT_REQUESTS_PER_SECOND,
});

const OptionalStringSchema = z.string().nullable().optional();

const DuckDuckGoInstantAnswerInputSchema = z.object({
  query: z
    .string()
    .refine((value) => value.trim().length > 0, "Query is required")
    .describe("Query to resolve with DuckDuckGo Instant Answer"),
});

const DuckDuckGoRelatedTopicSchema = z
  .object({
    Text: OptionalStringSchema,
    Topics: z.array(z.unknown()).optional(),
  })
  .passthrough();

const DuckDuckGoResponseSchema = z
  .object({
    Heading: OptionalStringSchema,
    AbstractText: OptionalStringSchema,
    Definition: OptionalStringSchema,
    Answer: OptionalStringSchema,
    RelatedTopics: z.array(z.unknown()).optional().default([]),
  })
  .passthrough();

const DuckDuckGoInstantAnswerOutputSchema = z.string();

type DuckDuckGoInstantAnswerInput = z.infer<
  typeof DuckDuckGoInstantAnswerInputSchema
>;
type DuckDuckGoInstantAnswerOutput = z.infer<
  typeof DuckDuckGoInstantAnswerOutputSchema
>;

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

function normalizeResponse(
  response: z.infer<typeof DuckDuckGoResponseSchema>,
): DuckDuckGoInstantAnswerOutput {
  const lines = [
    cleanString(response.Answer),
    cleanString(response.Definition),
    cleanString(response.AbstractText),
    ...flattenRelatedTopicText(response.RelatedTopics).slice(
      0,
      MAX_RELATED_TOPICS,
    ),
  ].filter((line): line is string => Boolean(line));

  return Array.from(new Set(lines)).join("\n");
}

export async function getDuckDuckGoInstantAnswer(
  input: unknown,
): Promise<DuckDuckGoInstantAnswerOutput> {
  const parsedInput = DuckDuckGoInstantAnswerInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return "";
  }

  return limiter.schedule(async () => {
    const { query } = parsedInput.data;
    const requestQuery = query.trim();
    const url = new URL(API_URL);
    url.searchParams.set("q", requestQuery);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "0");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `DuckDuckGo Instant Answer request failed with ${response.status} ${response.statusText}${
          body ? `: ${body.slice(0, 200)}` : ""
        }`,
      );
    }

    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch {
      return "";
    }

    const parsedResponse = DuckDuckGoResponseSchema.safeParse(rawResponse);
    if (!parsedResponse.success) {
      return "";
    }

    return normalizeResponse(parsedResponse.data);
  });
}

export const duckDuckGoInstantAnswerTool = tool({
  description:
    "Get concise DuckDuckGo Instant Answer text for semantic understanding with short keyword-style queries: entities, acronyms, topics, people, places, organizations, and ambiguous phrases. This is not a search engine, does not return ranked search results, and should only be used to improve later real search queries. Empty text is normal and means there is no instant-answer context.",
  strict: true,
  inputSchema: zodSchema(DuckDuckGoInstantAnswerInputSchema),
  outputSchema: zodSchema(DuckDuckGoInstantAnswerOutputSchema),
  execute: async (input: DuckDuckGoInstantAnswerInput) => {
    return getDuckDuckGoInstantAnswer(input);
  },
});
