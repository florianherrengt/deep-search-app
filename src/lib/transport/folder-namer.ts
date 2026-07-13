import {
  streamText,
  type CallWarning,
  type ContentPart,
  type LanguageModel,
  type LanguageModelRequestMetadata,
  type LanguageModelResponseMetadata,
  type LanguageModelUsage,
  type ProviderMetadata,
  type ToolSet,
} from "ai";
import {
  MAX_RESEARCH_FOLDER_WORDS,
  resolveUniqueFolderName,
  slugifyFolderName,
  validateResearchFolderName,
} from "./research-folder";
import { createSubAgentId } from "../sub-agent-types";
import {
  emitSubAgentEvent,
  type SubAgentEmitter,
} from "../sub-agent-emitter";
import {
  type SubAgentReport,
  type SubAgentAttemptReport,
  type FailureCategory,
  REASON_CODES,
  truncatePreview,
} from "../sub-agent-report";
import TITLE_SLUG_SYSTEM from "./title-slug-prompt.md?raw";

const MAX_ATTEMPTS = 3;
const STARTUP_NAME_ERROR_PREFIX =
  "Research could not start because the research folder name could not be generated.";

const LOG_PREFIX = "[folder-naming]";

const FALLBACK_STOP_WORDS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "can",
  "could",
  "did",
  "do",
  "does",
  "find",
  "for",
  "how",
  "i",
  "im",
  "in",
  "is",
  "looking",
  "me",
  "of",
  "on",
  "or",
  "please",
  "research",
  "s",
  "should",
  "tell",
  "the",
  "to",
  "under",
  "what",
  "whats",
  "when",
  "where",
  "who",
  "why",
  "with",
  "would",
]);

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

export interface FolderNamingResult {
  folderName: string;
  report: SubAgentReport;
}

interface FolderNamingOptions {
  abortSignal?: AbortSignal;
  emitEvent?: SubAgentEmitter;
}

export async function generateFolderSlug(
  model: LanguageModel,
  title: string,
  options?: FolderNamingOptions,
): Promise<string> {
  const result = await generateFolderSlugWithReport(model, title, options);
  return result.folderName;
}

export async function generateFolderSlugWithReport(
  model: LanguageModel,
  title: string,
  options?: FolderNamingOptions,
): Promise<FolderNamingResult> {
  const emitEvent = options?.emitEvent ?? emitSubAgentEvent;
  const saId = createSubAgentId();
  const reportStartedAt = new Date().toISOString();

  emitEvent({
    type: "start",
    id: saId,
    source: "sub-agent",
    name: "Folder Naming",
    toolName: "name_folder",
    parentMessageId: "transport",
  });

  logDebug("starting", {
    subAgentId: saId,
    model: describeModel(model),
    titleLength: title.length,
    titlePreview: truncatePreview(title),
    abortSignalPresent: !!options?.abortSignal,
    abortSignalAborted: options?.abortSignal?.aborted ?? false,
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
        ? title
        : `Your previous slug "${lastRawForRetry ?? ""}" was rejected: ${lastRejectionForRetry ?? "unknown"}. Convert the title "${title}" to a valid kebab-case slug. Return ONLY the slug.`;

    let raw: string;
    try {
      const result = streamText({
        model,
        system: TITLE_SLUG_SYSTEM,
        prompt,
        maxOutputTokens: 120,
        abortSignal: options?.abortSignal,
        providerOptions: {
          deepseek: { thinking: { type: "disabled" } },
          openrouter: { reasoning: { max_tokens: 0 } },
          zhipu: { thinking: { type: "disabled" } },
        },
        includeRawChunks: true,
        experimental_onStart: (event) => {
          logDebug(`attempt ${attempt} ai sdk start`, {
            model: event.model,
            maxOutputTokens: event.maxOutputTokens,
            maxRetries: event.maxRetries,
            providerOptionProviders: Object.keys(event.providerOptions ?? {}),
            abortSignalPresent: !!event.abortSignal,
            abortSignalAborted: event.abortSignal?.aborted ?? false,
            promptLength: typeof event.prompt === "string" ? event.prompt.length : undefined,
            systemLength: typeof event.system === "string" ? event.system.length : undefined,
            messageCount: event.messages?.length,
          });
        },
        experimental_onStepStart: (event) => {
          logDebug(`attempt ${attempt} ai sdk step start`, {
            stepNumber: event.stepNumber,
            model: event.model,
            messageCount: event.messages.length,
            providerOptionProviders: Object.keys(event.providerOptions ?? {}),
          });
        },
        onChunk: ({ chunk }) => {
          logDebug(`attempt ${attempt} ai sdk chunk`, summarizeChunk(chunk));
        },
        onError: ({ error }) => {
          logError(`attempt ${attempt} ai sdk stream error callback`, {
            error: summarizeError(error),
          });
        },
        onStepFinish: (event) => {
          logDebug(`attempt ${attempt} ai sdk step finish`, {
            stepNumber: event.stepNumber,
            model: event.model,
            finishReason: event.finishReason,
            rawFinishReason: event.rawFinishReason,
            textLength: event.text.length,
            content: summarizeContent(event.content),
            usage: summarizeUsage(event.usage),
            warnings: summarizeWarnings(event.warnings),
            response: summarizeResponse(event.response),
            providerMetadata: summarizeProviderMetadata(event.providerMetadata),
          });
        },
        onFinish: (event) => {
          logDebug(`attempt ${attempt} ai sdk finish`, {
            finishReason: event.finishReason,
            rawFinishReason: event.rawFinishReason,
            textLength: event.text.length,
            stepCount: event.steps.length,
            content: summarizeContent(event.content),
            usage: summarizeUsage(event.usage),
            totalUsage: summarizeUsage(event.totalUsage),
            warnings: summarizeWarnings(event.warnings),
            response: summarizeResponse(event.response),
            providerMetadata: summarizeProviderMetadata(event.providerMetadata),
          });
        },
      });

      let chunksReceived = 0;
      for await (const textPart of result.textStream) {
        chunksReceived++;
        emitEvent({ type: "text-delta", id: saId, delta: textPart });
      }

      raw = await result.text;
      const [finishReason, rawFinishReason, usage, warnings, response, request, providerMetadata, content] =
        await Promise.all([
          result.finishReason,
          result.rawFinishReason,
          result.usage,
          result.warnings,
          result.response,
          result.request,
          result.providerMetadata,
          result.content,
        ]);

      logDebug(`attempt ${attempt} stream completed`, {
        chunksReceived,
        textLength: raw.length,
        finishReason,
        rawFinishReason,
        usage: summarizeUsage(usage),
        warnings: summarizeWarnings(warnings),
        request: summarizeRequest(request),
        response: summarizeResponse(response),
        providerMetadata: summarizeProviderMetadata(providerMetadata),
        content: summarizeContent(content),
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
        emitEvent({ type: "report", id: saId, report });
        emitEvent({ type: "cancelled", id: saId });
        throw error;
      }

      const errMsg = errorMessage(error);
      logError(`attempt ${attempt} model call failed`, { error: summarizeError(error) });

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

      emitEvent({ type: "report", id: saId, report });
      const finalError = `${STARTUP_NAME_ERROR_PREFIX} ${errMsg}`;
      emitEvent({ type: "error", id: saId, error: finalError });
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

    if (validationReason) {
      lastRawForRetry = trimmedRaw;
      lastRejectionForRetry = validationReason;
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
      continue;
    }

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

      emitEvent({ type: "report", id: saId, report });
      const finalError = `${STARTUP_NAME_ERROR_PREFIX} The generated folder name could not be resolved. ${errMsg}`;
      emitEvent({ type: "error", id: saId, error: finalError });
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

    emitEvent({ type: "report", id: saId, report });
    emitEvent({ type: "complete", id: saId });

    return { folderName: resolved, report };
  }

  const fallbackSlug = deterministicFallbackSlug(title);
  const fallbackValidationReason = validateResearchFolderName(fallbackSlug);
  if (!fallbackValidationReason) {
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
        `${STARTUP_NAME_ERROR_PREFIX} The generated folder name could not be resolved. ${errMsg}`,
        `Folder naming fell back to a deterministic name, but it could not be resolved: ${errMsg}`,
        formatDebugSummary(attempts, `Fallback: rejected (${REASON_CODES.FOLDER_ALREADY_EXISTS})`),
      );

      emitEvent({ type: "report", id: saId, report });
      const finalError = `${STARTUP_NAME_ERROR_PREFIX} The generated folder name could not be resolved. ${errMsg}`;
      emitEvent({ type: "error", id: saId, error: finalError });
      throw new Error(finalError);
    }

    logWarn("all model attempts exhausted, using deterministic fallback", {
      fallbackSlugPreview: truncatePreview(fallbackSlug),
      resolved,
    });

    const report = buildReport(
      reportStartedAt,
      attempts,
      resolved,
      "success",
      undefined,
      undefined,
      "Folder naming used a deterministic fallback after model attempts failed.",
      formatDebugSummary(attempts, `Fallback: accepted (${resolved})`),
    );

    emitEvent({ type: "report", id: saId, report });
    emitEvent({ type: "complete", id: saId });
    return { folderName: resolved, report };
  }

  logError("all model attempts exhausted, failing", {
    fallbackSlugPreview: truncatePreview(fallbackSlug),
    fallbackValidationReason,
  });
  const finalError = `${STARTUP_NAME_ERROR_PREFIX} Failed to generate a valid folder name after ${MAX_ATTEMPTS} attempts.`;
  const report = buildReport(
    reportStartedAt,
    attempts,
    undefined,
    "rejected",
    "validation_error",
    finalError,
    `Folder naming failed after ${MAX_ATTEMPTS} LLM attempts.`,
    formatDebugSummary(attempts, `Fallback: rejected (${classifyRejection(fallbackValidationReason)})`),
  );
  emitEvent({ type: "report", id: saId, report });
  emitEvent({ type: "error", id: saId, error: finalError });
  throw new Error(finalError);
}

function deterministicFallbackSlug(title: string): string {
  const slug = slugifyFolderName(title);
  const words = slug.split("-").filter(Boolean);
  if (words.length === 0) return "";

  const meaningfulWords = words.filter((word) => !FALLBACK_STOP_WORDS.has(word));
  const selectedWords = meaningfulWords.length > 0 ? meaningfulWords : words;
  return selectedWords.slice(0, MAX_RESEARCH_FOLDER_WORDS).join("-");
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

function formatDebugSummary(
  attempts: SubAgentAttemptReport[],
  finalLine?: string,
): string {
  const lines = attempts
    .map((a) => {
      if (a.accepted) return `Attempt ${a.attempt}: accepted (${a.sanitizedOutputPreview ?? "unknown"})`;
      const reason = a.rejectedReasonCode ?? a.errorMessage ?? "unknown";
      return `Attempt ${a.attempt}: rejected (${reason})`;
    });

  if (finalLine) {
    lines.push(finalLine);
  }

  return lines.join("\n");
}
function summarizeChunk(chunk: unknown) {
  if (!chunk || typeof chunk !== "object") {
    return { type: typeof chunk };
  }

  const record = chunk as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "unknown";

  if (type === "text-delta") {
    const text = typeof record.text === "string" ? record.text : "";
    return {
      type,
      textLength: text.length,
      textPreview: truncatePreview(text),
      providerMetadata: summarizeProviderMetadata(record.providerMetadata as ProviderMetadata | undefined),
    };
  }

  if (type === "reasoning-delta") {
    const text = typeof record.text === "string" ? record.text : "";
    return {
      type,
      textLength: text.length,
      providerMetadata: summarizeProviderMetadata(record.providerMetadata as ProviderMetadata | undefined),
    };
  }

  if (type === "raw") {
    return {
      type,
      rawValue: summarizeUnknown(record.rawValue),
    };
  }

  if (type === "source") {
    return {
      type,
      sourceType: record.sourceType,
      id: record.id,
      url: typeof record.url === "string" ? truncatePreview(record.url, 160) : undefined,
    };
  }

  if (type === "tool-call" || type === "tool-result" || type === "tool-input-start" || type === "tool-input-delta") {
    return {
      type,
      toolName: record.toolName,
      dynamic: record.dynamic,
      providerExecuted: record.providerExecuted,
    };
  }

  return {
    type,
    keys: Object.keys(record).sort(),
  };
}

function summarizeContent(content: Array<ContentPart<ToolSet>> | undefined) {
  if (!content) return undefined;
  return content.map((part) => {
    if (part.type === "text") {
      return {
        type: part.type,
        textLength: part.text.length,
        textPreview: truncatePreview(part.text),
      };
    }

    if (part.type === "reasoning") {
      return {
        type: part.type,
        textLength: part.text.length,
      };
    }

    if (part.type === "tool-call") {
      return {
        type: part.type,
        toolName: part.toolName,
      };
    }

    if (part.type === "file") {
      return {
        type: part.type,
        mediaType: part.file.mediaType,
      };
    }

    return { type: part.type };
  });
}

function summarizeRequest(request: LanguageModelRequestMetadata | undefined) {
  if (!request) return undefined;
  return {
    hasBody: request.body !== undefined,
    body: summarizePayloadShape(request.body),
  };
}

function summarizeResponse(
  response: (LanguageModelResponseMetadata & { messages?: unknown[]; body?: unknown }) | undefined,
) {
  if (!response) return undefined;
  return {
    id: response.id,
    modelId: response.modelId,
    timestamp: response.timestamp?.toISOString?.(),
    headerKeys: Object.keys(response.headers ?? {}).sort(),
    messageCount: response.messages?.length,
    hasBody: response.body !== undefined,
    body: summarizePayloadShape(response.body),
  };
}

function summarizeUsage(usage: LanguageModelUsage | undefined) {
  if (!usage) return undefined;
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    inputTokenDetails: usage.inputTokenDetails,
    outputTokenDetails: usage.outputTokenDetails,
    raw: summarizeUnknown(usage.raw),
  };
}

function summarizeWarnings(warnings: CallWarning[] | undefined) {
  return warnings?.map((warning) => {
    if (warning.type === "other") {
      return {
        type: warning.type,
        message: truncatePreview(warning.message, 240),
      };
    }

    return {
      type: warning.type,
      feature: warning.feature,
      details: warning.details ? truncatePreview(warning.details, 240) : undefined,
    };
  });
}

function summarizeProviderMetadata(metadata: ProviderMetadata | undefined) {
  if (!metadata) return undefined;
  return Object.fromEntries(
    Object.entries(metadata).map(([provider, value]) => [
      provider,
      value && typeof value === "object" ? Object.keys(value).sort() : summarizeUnknown(value),
    ]),
  );
}

function summarizeUnknown(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
      preview: truncatePreview(value, 240),
    };
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      itemTypes: Array.from(new Set(value.slice(0, 10).map((item) => typeof item))),
    };
  }

  if (typeof value === "object") {
    return {
      type: "object",
      keys: Object.keys(value).sort(),
    };
  }

  return { type: typeof value };
}

function summarizePayloadShape(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
    };
  }

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      itemTypes: Array.from(new Set(value.slice(0, 10).map((item) => typeof item))),
    };
  }

  if (typeof value === "object") {
    return {
      type: "object",
      keys: Object.keys(value).sort(),
    };
  }

  return { type: typeof value };
}

function describeModel(model: LanguageModel) {
  const maybeModel = model as LanguageModel & {
    provider?: unknown;
    modelId?: unknown;
    specificationVersion?: unknown;
  };
  return {
    provider: maybeModel.provider,
    modelId: maybeModel.modelId,
    specificationVersion: maybeModel.specificationVersion,
  };
}

function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return {
      name: "Error",
      message: error,
    };
  }

  return summarizeUnknown(error);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error.";
}
