import { streamText, type LanguageModel } from "ai";
import {
  resolveUniqueFolderName,
  slugifyFolderName,
  validateResearchFolderName,
} from "./research-folder";
import { createSubAgentId } from "../sub-agent-types";
import { emitSubAgentEvent } from "../sub-agent-emitter";
import {
  type SubAgentReport,
  type SubAgentAttemptReport,
  type FailureCategory,
  REASON_CODES,
  truncatePreview,
} from "../sub-agent-report";

const NAMER_SYSTEM = `You name research folders. Given the user's research question, generate a short, descriptive research folder title that captures the core topic.

Rules:
- Focus on the actual research topic, not conversational prefixes.
- Remove generic lead-in phrases like "I'm looking for", "find me", "can you", "I need", "show me", "tell me about".
- Do not produce vague titles like "research" or "untitled".
- Preserve specific meaningful details (e.g., "espresso", "vegan", "manual").
- Max 5 words.
- Return ONLY a kebab-case slug, nothing else. No explanation, no quotes, no punctuation.

Examples:
- "I'm looking for the best coffee beans for espresso" → "best-coffee-beans-espresso"
- "Find me a good tent for backpacking" → "backpacking-tents"
- "Best vegan restaurants in Berlin" → "vegan-restaurants-berlin"
- "What are the latest AI trends?" → "ai-trends"`;

const MAX_ATTEMPTS = 3;
const STARTUP_NAME_ERROR_PREFIX =
  "Research could not start because the research folder name could not be generated.";

const LOG_PREFIX = "[folder-naming]";

function logDebug(message: string, ...args: unknown[]) {
  console.debug(`${LOG_PREFIX} ${message}`, ...args);
}

function logWarn(message: string, ...args: unknown[]) {
  console.warn(`${LOG_PREFIX} ${message}`, ...args);
}

function logError(message: string, ...args: unknown[]) {
  console.error(`${LOG_PREFIX} ${message}`, ...args);
}

function classifyRejection(reason: string): string {
  if (reason.includes("must not be empty")) return REASON_CODES.EMPTY_AFTER_SANITIZE;
  if (reason.includes("kebab-case")) return REASON_CODES.INVALID_CHARACTERS;
  if (reason.includes("too short")) return REASON_CODES.TOO_SHORT;
  if (reason.includes("too many words")) return REASON_CODES.TOO_MANY_WORDS;
  if (reason.includes("timestamp")) return REASON_CODES.DATE_ONLY;
  if (reason.includes("safe filesystem")) return REASON_CODES.INVALID_CHARACTERS;
  return REASON_CODES.UNKNOWN;
}

export function extractCandidate(raw: string): string {
  let candidate = raw.trim();

  candidate = candidate.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "");
  candidate = candidate.trim();

  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'")) ||
    (candidate.startsWith("`") && candidate.endsWith("`"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === "string") {
      candidate = parsed;
    } else if (parsed && typeof parsed === "object") {
      for (const key of ["folderName", "folder_name", "name", "title"]) {
        if (typeof (parsed as Record<string, unknown>)[key] === "string") {
          candidate = (parsed as Record<string, unknown>)[key] as string;
          break;
        }
      }
    }
  } catch {
    // not JSON, that's fine
  }

  const lines = candidate.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const kebabLines = lines.filter((l) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(l));
    if (kebabLines.length === 1) {
      candidate = kebabLines[0];
    }
  }

  return candidate.trim();
}

const CONVERSATIONAL_PREFIX_WORDS = new Set([
  "i", "im", "i-m", "i-ve", "id", "i-d", "i-ll", "ill",
  "me", "my", "we", "our",
  "looking", "for", "the", "a", "an",
  "find", "search", "show", "get", "tell", "about",
  "need", "want", "can", "could", "would", "should",
  "please", "help", "what", "which", "who", "how", "where", "when",
  "is", "are", "do", "does", "best", "good", "top",
  "some", "any", "all",
]);

export function deterministicFallback(query: string, subAgentId: string): string {
  if (query && query.trim()) {
    const slug = slugifyFolderName(query);
    if (slug.length >= 2) {
      const words = slug.split("-");
      const meaningful = words.filter((w) => !CONVERSATIONAL_PREFIX_WORDS.has(w));
      if (meaningful.length >= 2) {
        const result = meaningful.slice(0, 5).join("-");
        if (result.length >= 2) return result;
      }
      const fallback = words.slice(0, 5).join("-");
      if (fallback.length >= 2) return fallback;
    }
  }

  const idPart = subAgentId.replace(/^sa-/, "").replace(/-\d+$/, "");
  return `research-${idPart}`;
}

export interface FolderNamingResult {
  folderName: string;
  report: SubAgentReport;
}

export async function nameFolderFromMessage(
  model: LanguageModel,
  userMessage: string,
  options?: { abortSignal?: AbortSignal },
): Promise<string> {
  const result = await nameFolderFromMessageWithReport(model, userMessage, options);
  return result.folderName;
}

export async function nameFolderFromMessageWithReport(
  model: LanguageModel,
  userMessage: string,
  options?: { abortSignal?: AbortSignal },
): Promise<FolderNamingResult> {
  const saId = createSubAgentId();
  const reportStartedAt = new Date().toISOString();

  emitSubAgentEvent({
    type: "start",
    id: saId,
    source: "sub-agent",
    name: "Folder Naming",
    toolName: "name_folder",
    parentMessageId: "transport",
  });

  logDebug("starting", {
    subAgentId: saId,
    hasQuery: !!userMessage,
    queryLength: userMessage?.length ?? 0,
    queryPreview: truncatePreview(userMessage),
  });

  const attempts: SubAgentAttemptReport[] = [];
  let lastRawForRetry: string | null = null;
  let lastRejectionForRetry: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStartedAt = new Date().toISOString();

    logDebug(`attempt ${attempt}/${MAX_ATTEMPTS}`, {
      hasRetryContext: !!lastRawForRetry,
    });

    const prompt =
      attempt === 1
        ? userMessage
        : `Your previous answer "${lastRawForRetry ?? ""}" was rejected: ${lastRejectionForRetry ?? "unknown"}. Try again. Return ONLY a valid kebab-case folder name.`;

    let raw: string;
    try {
      const result = streamText({
        model,
        system: NAMER_SYSTEM,
        prompt,
        maxOutputTokens: 30,
        abortSignal: options?.abortSignal,
      });

      let chunksReceived = 0;
      for await (const textPart of result.textStream) {
        chunksReceived++;
        emitSubAgentEvent({ type: "text-delta", id: saId, delta: textPart });
      }

      raw = await result.text;

      logDebug(`attempt ${attempt} stream completed`, {
        chunksReceived,
        textLength: raw.length,
      });
    } catch (error) {
      if (options?.abortSignal?.aborted) {
        const report = buildReport(
          reportStartedAt,
          attempts,
          undefined,
          "cancelled",
          "cancelled",
          "Folder naming was cancelled.",
          "Folder naming was cancelled by the user.",
        );
        emitSubAgentEvent({ type: "report", id: saId, report });
        emitSubAgentEvent({ type: "cancelled", id: saId });
        throw error;
      }

      const errMsg = errorMessage(error);
      logError(`attempt ${attempt} model call failed`, { error: errMsg });

      const attemptReport: SubAgentAttemptReport = {
        attempt,
        startedAt: attemptStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
        accepted: false,
        rejectedReasonCode: REASON_CODES.MODEL_CALL_FAILED,
        rejectedReasonMessage: errMsg,
        errorMessage: errMsg,
      };
      attempts.push(attemptReport);

      const report = buildReport(
        reportStartedAt,
        attempts,
        undefined,
        "failed",
        "model_error",
        `${STARTUP_NAME_ERROR_PREFIX} ${errMsg}`,
        `Folder naming failed because the model call failed: ${errMsg}`,
        formatDebugSummary(attempts),
      );

      emitSubAgentEvent({ type: "report", id: saId, report });
      const finalError = `${STARTUP_NAME_ERROR_PREFIX} ${errMsg}`;
      emitSubAgentEvent({ type: "error", id: saId, error: finalError });
      throw new Error(finalError);
    }

    const trimmedRaw = raw.trim();

    logDebug(`attempt ${attempt} model response`, {
      rawLength: trimmedRaw.length,
      rawPreview: truncatePreview(trimmedRaw),
    });

    const extracted = extractCandidate(trimmedRaw);
    const slug = slugifyFolderName(extracted);

    logDebug(`attempt ${attempt} extraction`, {
      extractedPreview: truncatePreview(extracted),
      slugPreview: truncatePreview(slug),
      extractedLength: extracted.length,
      slugLength: slug.length,
    });

    const validationReason = validateResearchFolderName(slug);

    if (!validationReason) {
      let resolved: string;
      try {
        resolved = await resolveUniqueFolderName(slug);
      } catch (error) {
        const errMsg = errorMessage(error);
        logError("unique name resolution failed", { error: errMsg });

        const attemptReport: SubAgentAttemptReport = {
          attempt,
          startedAt: attemptStartedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
          rawOutputPreview: truncatePreview(trimmedRaw),
          rawOutputLength: trimmedRaw.length,
          parsedOutputPreview: truncatePreview(extracted),
          sanitizedOutputPreview: truncatePreview(slug),
          accepted: false,
          rejectedReasonCode: REASON_CODES.FOLDER_ALREADY_EXISTS,
          rejectedReasonMessage: errMsg,
          errorMessage: errMsg,
        };
        attempts.push(attemptReport);

        const report = buildReport(
          reportStartedAt,
          attempts,
          undefined,
          "failed",
          "filesystem_error",
          `${STARTUP_NAME_ERROR_PREFIX} The generated folder name could not be resolved. ${errMsg}`,
          `Folder naming failed because the name could not be resolved: ${errMsg}`,
          formatDebugSummary(attempts),
        );

        emitSubAgentEvent({ type: "report", id: saId, report });
        const finalError = `${STARTUP_NAME_ERROR_PREFIX} The generated folder name could not be resolved. ${errMsg}`;
        emitSubAgentEvent({ type: "error", id: saId, error: finalError });
        throw new Error(finalError);
      }

      logDebug("folder naming succeeded", {
        folderName: resolved,
        source: "model",
      });

      const attemptReport: SubAgentAttemptReport = {
        attempt,
        startedAt: attemptStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
        rawOutputPreview: truncatePreview(trimmedRaw),
        rawOutputLength: trimmedRaw.length,
        parsedOutputPreview: truncatePreview(extracted),
        sanitizedOutputPreview: truncatePreview(slug),
        accepted: true,
      };
      attempts.push(attemptReport);

      const report = buildReport(
        reportStartedAt,
        attempts,
        resolved,
        "success",
        undefined,
        undefined,
        formatDebugSummary(attempts),
      );

      emitSubAgentEvent({ type: "report", id: saId, report });
      emitSubAgentEvent({ type: "complete", id: saId });

      return { folderName: resolved, report };
    }

    const reasonCode = classifyRejection(validationReason);
    logWarn(`attempt ${attempt} rejected`, {
      reasonCode,
      reason: validationReason,
      rawPreview: truncatePreview(trimmedRaw),
      slugPreview: truncatePreview(slug),
      remainingAttempts: MAX_ATTEMPTS - attempt,
    });

    const attemptReport: SubAgentAttemptReport = {
      attempt,
      startedAt: attemptStartedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(attemptStartedAt).getTime(),
      rawOutputPreview: truncatePreview(trimmedRaw),
      rawOutputLength: trimmedRaw.length,
      parsedOutputPreview: truncatePreview(extracted),
      sanitizedOutputPreview: truncatePreview(slug),
      accepted: false,
      rejectedReasonCode: reasonCode,
      rejectedReasonMessage: validationReason,
    };
    attempts.push(attemptReport);

    lastRawForRetry = trimmedRaw;
    lastRejectionForRetry = validationReason;
  }

  logWarn("all model attempts exhausted, trying deterministic fallback");

  const fallbackCandidate = deterministicFallback(userMessage, saId);
  const fallbackSlug = slugifyFolderName(fallbackCandidate);
  const fallbackValidation = validateResearchFolderName(fallbackSlug);

  if (!fallbackValidation) {
    let resolved: string;
    try {
      resolved = await resolveUniqueFolderName(fallbackSlug);
    } catch (error) {
      const errMsg = errorMessage(error);
      logError("fallback unique name resolution failed", { error: errMsg });
      const report = buildReport(
        reportStartedAt,
        attempts,
        undefined,
        "failed",
        "filesystem_error",
        `${STARTUP_NAME_ERROR_PREFIX} ${errMsg}`,
        `Folder naming failed after fallback: ${errMsg}`,
        formatDebugSummary(attempts),
      );
      emitSubAgentEvent({ type: "report", id: saId, report });
      const finalError = `${STARTUP_NAME_ERROR_PREFIX} ${errMsg}`;
      emitSubAgentEvent({ type: "error", id: saId, error: finalError });
      throw new Error(finalError);
    }

    logDebug("folder naming succeeded via fallback", {
      folderName: resolved,
      source: "fallback",
    });

    const fallbackAttempt: SubAgentAttemptReport = {
      attempt: MAX_ATTEMPTS + 1,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
      parsedOutputPreview: truncatePreview(fallbackCandidate),
      sanitizedOutputPreview: truncatePreview(fallbackSlug),
      accepted: true,
    };
    attempts.push(fallbackAttempt);

    const report = buildReport(
      reportStartedAt,
      attempts,
      resolved,
      "success",
      undefined,
      undefined,
      formatDebugSummary(attempts),
    );

    emitSubAgentEvent({ type: "report", id: saId, report });
    emitSubAgentEvent({ type: "complete", id: saId });

    return { folderName: resolved, report };
  }

  lastRejectionForRetry = fallbackValidation;

  const finalError = `${STARTUP_NAME_ERROR_PREFIX} Failed to generate a valid folder name after ${MAX_ATTEMPTS} attempts. Last issue: ${lastRejectionForRetry ?? "unknown"}`;
  logError("folder naming failed definitively", {
    attempts: attempts.length,
    lastRejection: lastRejectionForRetry,
    fallbackAlsoFailed: true,
  });

  const lastAttempt = attempts[attempts.length - 1];
  const report = buildReport(
    reportStartedAt,
    attempts,
    undefined,
    "rejected",
    "validation_error",
    finalError,
    lastAttempt?.rejectedReasonCode === REASON_CODES.EMPTY_AFTER_SANITIZE ||
    lastAttempt?.rejectedReasonCode === REASON_CODES.EMPTY_PARSED_CANDIDATE
      ? "Folder naming failed because the generated name was empty after sanitisation."
      : `Folder naming failed: ${lastRejectionForRetry ?? "unknown validation error"}`,
    formatDebugSummary(attempts),
  );

  emitSubAgentEvent({ type: "report", id: saId, report });
  emitSubAgentEvent({ type: "error", id: saId, error: finalError });
  throw new Error(finalError);
}

function buildReport(
  startedAt: string,
  attempts: SubAgentAttemptReport[],
  finalAcceptedValue: string | undefined,
  status: SubAgentReport["status"],
  failureCategory?: FailureCategory,
  errorMessage?: string,
  safeForUiMessage?: string,
  debugSummary?: string,
): SubAgentReport {
  const now = new Date().toISOString();
  return {
    name: "Folder Naming",
    status,
    failureCategory,
    startedAt,
    finishedAt: now,
    durationMs: now && startedAt ? new Date(now).getTime() - new Date(startedAt).getTime() : undefined,
    attempts: [...attempts],
    finalOutputPreview: finalAcceptedValue ? truncatePreview(finalAcceptedValue) : undefined,
    finalAcceptedValue,
    errorMessage,
    safeForUiMessage,
    debugSummary,
  };
}

function formatDebugSummary(attempts: SubAgentAttemptReport[]): string {
  return attempts
    .map((a) => {
      if (a.accepted) return `Attempt ${a.attempt}: accepted (${a.sanitizedOutputPreview ?? "unknown"})`;
      const reason = a.rejectedReasonCode ?? a.errorMessage ?? "unknown";
      return `Attempt ${a.attempt}: rejected (${reason})`;
    })
    .join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
