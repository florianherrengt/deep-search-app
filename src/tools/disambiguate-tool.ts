import { tool, zodSchema } from "ai";
import { fetch } from "@tauri-apps/plugin-http";
import { z } from "zod";
import Bottleneck from "bottleneck";
import nlp from "compromise";

const API_URL = "https://api.duckduckgo.com/";
const MAX_RELATED_TOPICS = 8;

const STOPWORDS = new Set([
  "will",
  "can",
  "may",
  "shall",
  "should",
  "would",
  "could",
  "might",
  "must",
  "does",
  "did",
  "has",
  "have",
  "had",
  "been",
  "being",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "why",
  "how",
  "that",
  "this",
  "these",
  "those",
  "there",
  "here",
  "much",
  "many",
  "some",
  "any",
  "all",
  "each",
  "every",
  "other",
  "another",
  "such",
  "same",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "then",
  "still",
  "already",
  "yet",
  "ever",
  "never",
  "always",
  "often",
  "sometimes",
  "please",
  "tell",
  "know",
  "want",
  "need",
  "like",
  "get",
  "make",
  "go",
  "come",
  "take",
  "give",
  "find",
  "think",
  "say",
  "see",
  "look",
  "use",
  "try",
  "ask",
  "work",
  "seem",
  "feel",
  "let",
  "mean",
  "keep",
  "put",
  "become",
  "leave",
  "begin",
  "show",
  "hear",
  "play",
  "run",
  "move",
  "live",
  "believe",
  "bring",
  "happen",
  "write",
  "provide",
  "sit",
  "stand",
  "lose",
  "pay",
  "meet",
  "include",
  "continue",
  "set",
  "learn",
  "change",
  "lead",
  "understand",
  "watch",
  "follow",
  "stop",
  "create",
  "speak",
  "read",
  "allow",
  "add",
  "spend",
  "grow",
  "open",
  "walk",
  "win",
  "offer",
  "remember",
  "love",
  "consider",
  "appear",
  "buy",
  "wait",
  "serve",
  "die",
  "send",
  "expect",
  "build",
  "stay",
  "fall",
  "cut",
  "reach",
  "kill",
  "remain",
  "suggest",
  "raise",
  "pass",
  "sell",
  "require",
  "report",
  "decide",
  "pull",
  "development",
  "release",
  "release date",
  "date",
  "time",
  "way",
  "thing",
  "things",
  "something",
  "anything",
  "nothing",
  "everything",
  "one",
  "two",
  "first",
  "last",
  "new",
  "old",
  "good",
  "great",
  "best",
  "better",
  "big",
  "small",
  "long",
  "little",
  "right",
  "important",
  "different",
  "sure",
  "true",
  "possible",
]);

const limiter = new Bottleneck({
  maxConcurrent: 1,
  minTime: 1000,
});

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

async function fetchDuckDuckGo(query: string): Promise<string> {
  return limiter.schedule(async () => {
    const url = new URL(API_URL);
    url.searchParams.set("q", query.trim());
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
      return "";
    }

    let raw: unknown;
    try {
      raw = await response.json();
    } catch {
      return "";
    }

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
  });
}

function extractEntities(question: string): string[] {
  const doc = nlp(question);

  const nouns = doc.nouns().toSingular().out("array") as string[];
  const topics = doc.topics().out("array") as string[];

  const candidates = [...nouns, ...topics]
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

  return [...new Set(candidates)];
}

export const disambiguateTool = tool({
  description:
    "Identify and resolve ambiguous entities, concepts, acronyms, and terms in a question. Returns concise descriptions and related context from DuckDuckGo. Pass the user's question as-is. Returns empty text if nothing needs disambiguation.",
  strict: true,
  inputSchema: zodSchema(
    z.object({
      question: z
        .string()
        .describe("The user's question to disambiguate"),
    }),
  ),
  outputSchema: zodSchema(z.string()),
  execute: async ({ question }) => {
    const entities = extractEntities(question);
    if (entities.length === 0) return "";

    const parts: string[] = [];

    for (const entity of entities) {
      const ddgResult = await fetchDuckDuckGo(entity);
      if (!ddgResult) continue;
      parts.push(entity);
      parts.push(ddgResult);
    }

    return parts.join("\n\n");
  },
});
