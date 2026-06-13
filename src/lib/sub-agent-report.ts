export type FailureCategory =
  | "model_error"
  | "empty_output"
  | "parse_error"
  | "validation_error"
  | "filesystem_error"
  | "tool_error"
  | "timeout"
  | "cancelled"
  | "unknown";

export type ReportStatus =
  | "success"
  | "failed"
  | "rejected"
  | "timeout"
  | "cancelled";

export const REASON_CODES = {
  EMPTY_MODEL_OUTPUT: "EMPTY_MODEL_OUTPUT",
  EMPTY_PARSED_CANDIDATE: "EMPTY_PARSED_CANDIDATE",
  EMPTY_AFTER_SANITIZE: "EMPTY_AFTER_SANITIZE",
  INVALID_CHARACTERS: "INVALID_CHARACTERS",
  PATH_TRAVERSAL: "PATH_TRAVERSAL",
  RESERVED_NAME: "RESERVED_NAME",
  TOO_LONG: "TOO_LONG",
  TOO_MANY_WORDS: "TOO_MANY_WORDS",
  TOO_SHORT: "TOO_SHORT",
  DATE_ONLY: "DATE_ONLY",
  FOLDER_ALREADY_EXISTS: "FOLDER_ALREADY_EXISTS",
  FILESYSTEM_CREATE_FAILED: "FILESYSTEM_CREATE_FAILED",
  MODEL_CALL_FAILED: "MODEL_CALL_FAILED",
  TIMEOUT: "TIMEOUT",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN",
} as const;

export type ReasonCode =
  (typeof REASON_CODES)[keyof typeof REASON_CODES];

export interface SubAgentAttemptReport {
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  rawOutputPreview?: string;
  rawOutputLength?: number;
  parsedOutputPreview?: string;
  sanitizedOutputPreview?: string;
  accepted: boolean;
  rejectedReasonCode?: string;
  rejectedReasonMessage?: string;
  errorMessage?: string;
}

export interface SubAgentReport {
  name: string;
  status: ReportStatus;
  failureCategory?: FailureCategory;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  attempts: SubAgentAttemptReport[];
  finalOutputPreview?: string;
  finalAcceptedValue?: string;
  errorMessage?: string;
  safeForUiMessage?: string;
  debugSummary?: string;
}

export function truncatePreview(value: string | undefined, maxLen = 200): string | undefined {
  if (value == null) return undefined;
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen) + "...";
}
