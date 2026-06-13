import { isSubAgentRunToolName, type SubAgentRun } from "./sub-agent-types";
import type { SubAgentReport, FailureCategory } from "./sub-agent-report";
import { readAppFile, writeAppFile, SafePathSegmentSchema } from "./app-file-storage";
import { SEARCH_RESULTS_SUBFOLDER } from "./research-history";
import { isRecord, tryParseJson } from "./json";

const CHATS_SUBFOLDER = "chats";
const SUBAGENTS_FILE_SUFFIX = ".subagents.json";

function subAgentsFilePath(folderName: string, chatId: string): {
  subfolder: string;
  filename: string;
} {
  return {
    subfolder: `${SEARCH_RESULTS_SUBFOLDER}/${SafePathSegmentSchema.parse(folderName)}/${CHATS_SUBFOLDER}`,
    filename: `${SafePathSegmentSchema.parse(chatId)}${SUBAGENTS_FILE_SUFFIX}`,
  };
}

export async function readSubAgentRuns(
  folderName: string,
  chatId: string,
): Promise<SubAgentRun[]> {
  const { subfolder, filename } = subAgentsFilePath(folderName, chatId);
  const raw = await readAppFile({ subfolder, filename });
  if (!raw) return [];

  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed)) return [];

  return normalizeSubAgentRuns(parsed, chatId);
}

export function normalizeSubAgentRuns(
  runs: unknown[],
  parentChatId: string,
): SubAgentRun[] {
  return runs
    .map((run) => normalizeSubAgentRun(run, parentChatId))
    .filter((run): run is SubAgentRun => run !== null);
}

function normalizeSubAgentRun(
  value: unknown,
  parentChatId: string,
): SubAgentRun | null {
  if (!isRecord(value)) return null;

  const id = getString(value.id) ?? getString(value.chatId);
  const chatId = getString(value.chatId) ?? id;
  const name = getString(value.name);
  const toolName = getString(value.toolName);
  const status = normalizeStatus(value.status);
  if (!id || !chatId || !name || !toolName || !status) return null;
  if (value.source !== "sub-agent" && !isSubAgentRunToolName(toolName)) {
    return null;
  }

  return {
    id,
    chatId,
    parentChatId: getString(value.parentChatId) ?? parentChatId,
    source: "sub-agent",
    name,
    toolName,
    status,
    startedAt: getString(value.startedAt) ?? new Date(0).toISOString(),
    finishedAt: getString(value.finishedAt),
    text: getString(value.text) ?? "",
    chunksReceived: typeof value.chunksReceived === "number" ? value.chunksReceived : 0,
    toolCalls: Array.isArray(value.toolCalls)
      ? value.toolCalls
          .map(normalizeToolCall)
          .filter(
            (toolCall): toolCall is SubAgentRun["toolCalls"][number] =>
              toolCall !== null,
          )
      : [],
    error: getString(value.error),
    parentMessageId: getString(value.parentMessageId) ?? "unknown",
    report: normalizeReport(value.report),
  };
}

function normalizeToolCall(value: unknown): SubAgentRun["toolCalls"][number] | null {
  if (!isRecord(value)) return null;
  const toolName = getString(value.toolName);
  const status = normalizeToolCallStatus(value.status);
  if (!toolName || !status) return null;
  const toolCallId = getString(value.toolCallId);

  return {
    ...(toolCallId ? { toolCallId } : {}),
    toolName,
    args: value.args,
    ...(value.result !== undefined ? { result: value.result } : {}),
    status,
  };
}

function normalizeStatus(value: unknown): SubAgentRun["status"] | null {
  if (value === "running" || value === "streaming" || value === "completed" || value === "failed" || value === "cancelled") {
    return value;
  }
  if (value === "complete") return "completed";
  if (value === "error") return "failed";
  return null;
}

function normalizeToolCallStatus(
  value: unknown,
): SubAgentRun["toolCalls"][number]["status"] | null {
  if (value === "running" || value === "complete" || value === "error") {
    return value;
  }
  if (value === "completed") return "complete";
  if (value === "failed") return "error";
  return null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeReport(value: unknown): SubAgentReport | null {
  if (!isRecord(value)) return null;
  const name = getString(value.name);
  const status = getString(value.status);
  const startedAt = getString(value.startedAt);
  if (!name || !status || !startedAt) return null;

  const reportStatus = normalizeReportStatus(status);
  if (!reportStatus) return null;

  return {
    name,
    status: reportStatus,
    failureCategory: normalizeFailureCategory(value.failureCategory),
    startedAt,
    finishedAt: getString(value.finishedAt) ?? undefined,
    durationMs: typeof value.durationMs === "number" ? value.durationMs : undefined,
    attempts: Array.isArray(value.attempts)
      ? value.attempts.filter(isRecord).map((a, i) => ({
          attempt: typeof a.attempt === "number" ? a.attempt : i + 1,
          startedAt: getString(a.startedAt) ?? "",
          finishedAt: getString(a.finishedAt) ?? undefined,
          durationMs: typeof a.durationMs === "number" ? a.durationMs : undefined,
          rawOutputPreview: getString(a.rawOutputPreview) ?? undefined,
          rawOutputLength: typeof a.rawOutputLength === "number" ? a.rawOutputLength : undefined,
          parsedOutputPreview: getString(a.parsedOutputPreview) ?? undefined,
          sanitizedOutputPreview: getString(a.sanitizedOutputPreview) ?? undefined,
          accepted: a.accepted === true,
          rejectedReasonCode: getString(a.rejectedReasonCode) ?? undefined,
          rejectedReasonMessage: getString(a.rejectedReasonMessage) ?? undefined,
          errorMessage: getString(a.errorMessage) ?? undefined,
        }))
      : [],
    finalOutputPreview: getString(value.finalOutputPreview) ?? undefined,
    finalAcceptedValue: getString(value.finalAcceptedValue) ?? undefined,
    errorMessage: getString(value.errorMessage) ?? undefined,
    safeForUiMessage: getString(value.safeForUiMessage) ?? undefined,
    debugSummary: getString(value.debugSummary) ?? undefined,
  };
}

export async function writeSubAgentRuns(
  folderName: string,
  chatId: string,
  runs: SubAgentRun[],
): Promise<void> {
  const { subfolder, filename } = subAgentsFilePath(folderName, chatId);
  const subAgentRuns = normalizeSubAgentRuns(runs, chatId);
  await writeAppFile({
    subfolder,
    filename,
    content: JSON.stringify(subAgentRuns, undefined, 2),
    emitChange: false,
  });
}

const VALID_REPORT_STATUSES: readonly SubAgentReport["status"][] = [
  "success", "failed", "rejected", "timeout", "cancelled",
];

function normalizeReportStatus(
  value: string,
): SubAgentReport["status"] | null {
  if ((VALID_REPORT_STATUSES as readonly string[]).includes(value)) {
    return value as SubAgentReport["status"];
  }
  return null;
}

const VALID_FAILURE_CATEGORIES: readonly FailureCategory[] = [
  "model_error", "empty_output", "parse_error", "validation_error",
  "filesystem_error", "tool_error", "timeout", "cancelled", "unknown",
];

function normalizeFailureCategory(
  value: unknown,
): FailureCategory | undefined {
  if (typeof value !== "string") return undefined;
  if ((VALID_FAILURE_CATEGORIES as readonly string[]).includes(value)) {
    return value as FailureCategory;
  }
  return undefined;
}
