import { generateText, type LanguageModel } from "ai";
import {
  resolveUniqueFolderName,
  slugifyFolderName,
  validateResearchFolderName,
} from "./research-folder";
import { createSubAgentId } from "../sub-agent-types";
import { emitSubAgentEvent } from "../sub-agent-emitter";

const NAMER_SYSTEM = `You name research folders. Given the user's research question, return a short kebab-case folder name that captures the general topic. Max 5 words. Return ONLY the name, nothing else. No explanation, no quotes, no punctuation.`;

const MAX_ATTEMPTS = 3;
const STARTUP_NAME_ERROR_PREFIX =
  "Research could not start because the research folder name could not be generated.";

class FolderNameError extends Error {
  constructor(
    public readonly raw: string,
    reason: string,
  ) {
    super(`Invalid folder name: ${reason}`);
  }
}

function validateName(slug: string): FolderNameError | null {
  const reason = validateResearchFolderName(slug);
  return reason ? new FolderNameError(slug, reason) : null;
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
    source: "sub-agent",
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

    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model,
        system: NAMER_SYSTEM,
        prompt,
        maxOutputTokens: 30,
        abortSignal: options?.abortSignal,
      });
    } catch (error) {
      if (options?.abortSignal?.aborted) {
        throw error;
      }

      const finalError = `${STARTUP_NAME_ERROR_PREFIX} ${errorMessage(error)}`;
      emitSubAgentEvent({ type: "error", id: saId, error: finalError });
      throw new Error(finalError);
    }

    const raw = result.text.trim();
    emitSubAgentEvent({ type: "text-delta", id: saId, delta: raw });
    const slug = slugifyFolderName(raw);
    const validationError = validateName(slug);

    if (!validationError) {
      let resolved: string;
      try {
        resolved = await resolveUniqueFolderName(slug);
      } catch (error) {
        const finalError = `${STARTUP_NAME_ERROR_PREFIX} The generated folder name could not be resolved. ${errorMessage(error)}`;
        emitSubAgentEvent({ type: "error", id: saId, error: finalError });
        throw new Error(finalError);
      }

      emitSubAgentEvent({ type: "complete", id: saId });
      return resolved;
    }

    lastError = validationError;
  }

  const finalError = `${STARTUP_NAME_ERROR_PREFIX} Failed to generate a valid folder name after ${MAX_ATTEMPTS} attempts. Last issue: ${lastError?.message}`;
  emitSubAgentEvent({ type: "error", id: saId, error: finalError });
  throw new Error(finalError);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
