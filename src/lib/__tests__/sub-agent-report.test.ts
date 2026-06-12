import { describe, expect, it } from "vitest";
import {
  type SubAgentReport,
  type SubAgentAttemptReport,
  REASON_CODES,
  truncatePreview,
} from "@/lib/sub-agent-report";

describe("SubAgentReport types", () => {
  it("accepts a successful report", () => {
    const report: SubAgentReport = {
      name: "Folder Naming",
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 500,
      attempts: [
        {
          attempt: 1,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 500,
          rawOutputPreview: "acme-research",
          rawOutputLength: 13,
          parsedOutputPreview: "acme-research",
          sanitizedOutputPreview: "acme-research",
          accepted: true,
        },
      ],
      finalOutputPreview: "acme-research",
      finalAcceptedValue: "acme-research",
    };
    expect(report.status).toBe("success");
    expect(report.attempts).toHaveLength(1);
    expect(report.attempts[0].accepted).toBe(true);
  });

  it("accepts a rejected report with failure category", () => {
    const report: SubAgentReport = {
      name: "Folder Naming",
      status: "rejected",
      failureCategory: "validation_error",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      attempts: [
        {
          attempt: 1,
          startedAt: new Date().toISOString(),
          accepted: false,
          rejectedReasonCode: REASON_CODES.EMPTY_AFTER_SANITIZE,
          rejectedReasonMessage: "must not be empty",
        },
      ],
      errorMessage: "Failed to generate folder name",
      safeForUiMessage: "Folder naming failed because the generated name was empty after sanitisation.",
    };
    expect(report.status).toBe("rejected");
    expect(report.failureCategory).toBe("validation_error");
    expect(report.safeForUiMessage).toBeTruthy();
  });

  it("accepts a failed report", () => {
    const report: SubAgentReport = {
      name: "Folder Naming",
      status: "failed",
      failureCategory: "model_error",
      startedAt: new Date().toISOString(),
      attempts: [
        {
          attempt: 1,
          startedAt: new Date().toISOString(),
          accepted: false,
          errorMessage: "provider unavailable",
        },
      ],
      errorMessage: "provider unavailable",
    };
    expect(report.status).toBe("failed");
  });

  it("accepts a timeout report", () => {
    const report: SubAgentReport = {
      name: "Folder Naming",
      status: "timeout",
      failureCategory: "timeout",
      startedAt: new Date().toISOString(),
      attempts: [],
      errorMessage: "Timed out",
    };
    expect(report.status).toBe("timeout");
  });

  it("accepts a cancelled report", () => {
    const report: SubAgentReport = {
      name: "Folder Naming",
      status: "cancelled",
      failureCategory: "cancelled",
      startedAt: new Date().toISOString(),
      attempts: [],
    };
    expect(report.status).toBe("cancelled");
  });

  it("supports multiple attempt summaries", () => {
    const attempts: SubAgentAttemptReport[] = [
      {
        attempt: 1,
        startedAt: new Date().toISOString(),
        rawOutputPreview: "invalid",
        accepted: false,
        rejectedReasonCode: REASON_CODES.INVALID_CHARACTERS,
      },
      {
        attempt: 2,
        startedAt: new Date().toISOString(),
        rawOutputPreview: "",
        accepted: false,
        rejectedReasonCode: REASON_CODES.EMPTY_AFTER_SANITIZE,
      },
      {
        attempt: 3,
        startedAt: new Date().toISOString(),
        rawOutputPreview: "valid-name",
        accepted: true,
      },
    ];
    const report: SubAgentReport = {
      name: "Folder Naming",
      status: "success",
      startedAt: new Date().toISOString(),
      attempts,
      finalAcceptedValue: "valid-name",
    };
    expect(report.attempts).toHaveLength(3);
    expect(report.attempts.filter((a) => a.accepted)).toHaveLength(1);
  });
});

describe("REASON_CODES", () => {
  it("has all expected reason codes", () => {
    expect(REASON_CODES.EMPTY_MODEL_OUTPUT).toBe("EMPTY_MODEL_OUTPUT");
    expect(REASON_CODES.EMPTY_PARSED_CANDIDATE).toBe("EMPTY_PARSED_CANDIDATE");
    expect(REASON_CODES.EMPTY_AFTER_SANITIZE).toBe("EMPTY_AFTER_SANITIZE");
    expect(REASON_CODES.INVALID_CHARACTERS).toBe("INVALID_CHARACTERS");
    expect(REASON_CODES.PATH_TRAVERSAL).toBe("PATH_TRAVERSAL");
    expect(REASON_CODES.TOO_LONG).toBe("TOO_LONG");
    expect(REASON_CODES.TOO_MANY_WORDS).toBe("TOO_MANY_WORDS");
    expect(REASON_CODES.TOO_SHORT).toBe("TOO_SHORT");
    expect(REASON_CODES.DATE_ONLY).toBe("DATE_ONLY");
    expect(REASON_CODES.MODEL_CALL_FAILED).toBe("MODEL_CALL_FAILED");
    expect(REASON_CODES.TIMEOUT).toBe("TIMEOUT");
    expect(REASON_CODES.CANCELLED).toBe("CANCELLED");
    expect(REASON_CODES.UNKNOWN).toBe("UNKNOWN");
  });
});

describe("truncatePreview", () => {
  it("returns undefined for undefined input", () => {
    expect(truncatePreview(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(truncatePreview("")).toBeUndefined();
  });

  it("returns short strings unchanged", () => {
    expect(truncatePreview("hello")).toBe("hello");
  });

  it("truncates long strings with ellipsis", () => {
    const long = "a".repeat(300);
    const result = truncatePreview(long, 200);
    expect(result!.length).toBe(203);
    expect(result!.endsWith("...")).toBe(true);
  });

  it("respects custom max length", () => {
    const result = truncatePreview("abcdefghij", 5);
    expect(result).toBe("abcde...");
  });
});
