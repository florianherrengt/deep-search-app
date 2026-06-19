import { generateText, type LanguageModel } from "ai";
import { isAbortError } from "@/lib/abort";
import { isRecord } from "@/lib/json";

const LOG_PREFIX = "[folder-search]";

const SYSTEM_PROMPT = `You select which research folders are relevant to a user's search query.

You will receive:
- A search query
- A numbered list of research folder names

Decide which folders are likely to contain research relevant to the query, based ONLY on the folder names.

Respond with ONLY a JSON object and nothing else:
{"relevant": ["Exact Folder Name", "Another Folder Name"]}

Rules:
- Folder names must be copied EXACTLY as they appear in the list (case-sensitive).
- Return an empty array if no folders are relevant.
- Never invent folder names that are not in the list.`;

function buildUserPrompt(query: string, folderNames: string[]): string {
  const list = folderNames.map((n, i) => `${i + 1}. ${n}`).join("\n");
  return `Search query: "${query}"\n\nResearch folders:\n${list}`;
}

function extractFirstJsonObject(text: string): string | null {
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = firstBrace; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) return text.slice(firstBrace, i + 1);
    }
  }
  return null;
}

function parseRelevantFolders(text: string, candidates: Set<string>): string[] {
  const jsonStr = extractFirstJsonObject(text);
  if (!jsonStr) {
    console.warn(`${LOG_PREFIX} no JSON object found in model output`, {
      textLength: text.length,
    });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.warn(`${LOG_PREFIX} failed to parse model JSON`, {
      error: err instanceof Error ? err.message : "unknown",
    });
    return [];
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.relevant)) {
    console.warn(`${LOG_PREFIX} model output missing "relevant" array`, {
      keys: isRecord(parsed) ? Object.keys(parsed) : typeof parsed,
    });
    return [];
  }

  return parsed.relevant.filter(
    (f): f is string => typeof f === "string" && candidates.has(f),
  );
}

export async function searchFoldersWithLLM(
  query: string,
  folderNames: string[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  if (folderNames.length === 0) return [];

  const candidates = new Set(folderNames);
  const userPrompt = buildUserPrompt(query, folderNames);

  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    abortSignal,
  });

  return parseRelevantFolders(result.text, candidates);
}

export async function searchFoldersWithLLMSafe(
  query: string,
  folderNames: string[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
): Promise<string[]> {
  try {
    return await searchFoldersWithLLM(query, folderNames, model, abortSignal);
  } catch (error) {
    if (isAbortError(error) || abortSignal?.aborted) {
      return [];
    }
    console.error(`${LOG_PREFIX} search failed`, {
      error: error instanceof Error ? error.message : "unknown",
    });
    return [];
  }
}
