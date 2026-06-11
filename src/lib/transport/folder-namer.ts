import { generateText, type LanguageModel } from "ai";
import { slugifyFolderName, resolveUniqueFolderName } from "./research-folder";
import { createSubAgentId } from "../sub-agent-types";
import { emitSubAgentEvent } from "../sub-agent-emitter";

const NAMER_SYSTEM = `You name research folders. Given the user's research question, return a short kebab-case folder name that captures the general topic. Max 5 words. Return ONLY the name, nothing else. No explanation, no quotes, no punctuation.`;

const VALID_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_WORDS = 5;
const MAX_ATTEMPTS = 3;

class FolderNameError extends Error {
  constructor(
    public readonly raw: string,
    reason: string,
  ) {
    super(`Invalid folder name: ${reason}`);
  }
}

function validateName(slug: string): FolderNameError | null {
  if (!VALID_NAME.test(slug)) {
    return new FolderNameError(slug, "must be lowercase kebab-case (letters, numbers, hyphens only)");
  }
  if (slug.length < 2) {
    return new FolderNameError(slug, "too short (min 2 characters)");
  }
  if (slug.split("-").length > MAX_WORDS) {
    return new FolderNameError(slug, `too many words (max ${MAX_WORDS})`);
  }
  return null;
}

export async function nameFolderFromMessage(
  model: LanguageModel,
  userMessage: string,
  options?: { abortSignal?: AbortSignal },
): Promise<string> {
  const saId = createSubAgentId();
  emitSubAgentEvent({
    type: "start",
    id: saId,
    name: "Folder Naming",
    toolName: "name_folder",
    parentMessageId: "transport",
  });

  let lastError: FolderNameError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 0
        ? userMessage
        : `Your previous answer "${lastError!.raw}" was rejected: ${lastError!.message}. Try again. Return ONLY a valid kebab-case folder name.`;

    const result = await generateText({
      model,
      system: NAMER_SYSTEM,
      prompt,
      maxOutputTokens: 30,
      abortSignal: options?.abortSignal,
    });

    const raw = result.text.trim();
    emitSubAgentEvent({ type: "text-delta", id: saId, delta: raw });
    const slug = slugifyFolderName(raw);
    const validationError = validateName(slug);

    if (!validationError) {
      const resolved = resolveUniqueFolderName(slug);
      emitSubAgentEvent({ type: "complete", id: saId });
      return resolved;
    }

    lastError = validationError;
  }

  const finalError = `Failed to generate a valid folder name after ${MAX_ATTEMPTS} attempts. Last issue: ${lastError?.message}`;
  emitSubAgentEvent({ type: "error", id: saId, error: finalError });
  throw new Error(finalError);
}
