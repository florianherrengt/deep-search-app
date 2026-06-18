import { Box, Collapse, Text, UnstyledButton } from "@mantine/core";
import { ChevronDownIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { MarkdownContent } from "@/components/assistant-ui/markdown-text";
import type { SubAgentReport } from "@/lib/sub-agent-report";
import type { SubAgentRun, SubAgentStatus } from "@/lib/sub-agent-types";
import { useSubAgentRenderCounter } from "@/lib/sub-agent-profiler";

export interface SubAgentTranscriptInlineProps {
  text: string;
  status: SubAgentStatus;
  error: string | null;
  report: SubAgentReport | null | undefined;
  toolCalls: SubAgentRun["toolCalls"];
}

export function SubAgentTranscriptInline({
  text,
  status,
  error,
  report,
  toolCalls,
}: SubAgentTranscriptInlineProps) {
  useSubAgentRenderCounter("SubAgentTranscriptInline");
  const deferredText = useDeferredValue(text);
  const hasContent = deferredText.trim().length > 0;
  const isActive = status === "running" || status === "streaming";
  const isCancelled = status === "cancelled";

  return (
    <Box style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {hasContent ? (
        <Box style={{ overflowX: "auto", fontSize: 13, lineHeight: 1.55 }}>
          {isActive ? (
            <Box
              component="pre"
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "inherit",
              }}
            >
              {deferredText}
            </Box>
          ) : (
            <MarkdownContent text={deferredText} />
          )}
        </Box>
      ) : isActive ? (
        <Text size="sm" c="dimmed">
          Waiting for sub-agent output...
        </Text>
      ) : (
        <Text size="sm" c="dimmed" fs="italic">
          No output produced.
        </Text>
      )}

      {toolCalls.length > 0 && (
        <SubAgentToolCallsInline toolCalls={toolCalls} />
      )}

      {error && !isCancelled && (
        <SubAgentErrorInline error={error} report={report} />
      )}
      {isCancelled && (
        <Text size="sm" c="dimmed" fs="italic">
          Cancelled by user.
        </Text>
      )}
    </Box>
  );
}

function SubAgentToolCallsInline({
  toolCalls,
}: {
  toolCalls: SubAgentRun["toolCalls"];
}) {
  const [opened, setOpened] = useState(false);

  return (
    <Box>
      <UnstyledButton
        onClick={() => setOpened(!opened)}
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        <ChevronDownIcon
          size={12}
          style={{
            transform: opened ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        />
        <Text size="xs" c="dimmed">
          Tool calls ({toolCalls.length})
        </Text>
      </UnstyledButton>
      <Collapse in={opened}>
        <Box
          mt={4}
          style={{ display: "flex", flexDirection: "column", gap: 6 }}
        >
          {toolCalls.map((toolCall, index) => (
            <ToolFallback
              key={toolCall.toolCallId ?? `${toolCall.toolName}-${index}`}
              toolName={toolCall.toolName}
              args={toolCall.args}
              result={toolCall.result}
              status={toToolFallbackStatus(toolCall.status)}
              chatId={undefined}
              toolCallId={undefined}
            />
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function SubAgentErrorInline({
  error,
  report,
}: {
  error: string;
  report?: SubAgentReport | null;
}) {
  const [opened, setOpened] = useState(false);

  return (
    <Box
      className="md-card-sm"
      style={{
        border: "1px solid light-dark(var(--mantine-color-red-3), var(--mantine-color-red-7))",
        backgroundColor: "light-dark(var(--mantine-color-red-0), var(--mantine-color-red-9))",
        color: "var(--mantine-color-red-text)",
      }}
    >
      <Text size="xs" fw={600} mb={4}>
        Error
      </Text>
      {report?.safeForUiMessage ? (
        <Text size="sm">{report.safeForUiMessage}</Text>
      ) : (
        <Text size="sm">{error}</Text>
      )}
      {report && report.attempts.length > 0 && (
        <Box mt={8}>
          <UnstyledButton
            onClick={() => setOpened(!opened)}
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <ChevronDownIcon
              size={12}
              style={{
                transform: opened ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            />
            <Text size="xs" c="dimmed">
              Debug details
            </Text>
          </UnstyledButton>
          <Collapse in={opened}>
            <Box mt={4} style={{ fontSize: 12, lineHeight: 1.5 }}>
              {report.attempts.map((a) => (
                <Box key={a.attempt} mb={4}>
                  <Text size="xs" fw={500}>
                    Attempt {a.attempt}:{" "}
                    {a.accepted ? "accepted" : a.rejectedReasonCode ?? "error"}
                  </Text>
                  {a.rejectedReasonMessage && (
                    <Text size="xs" c="dimmed">
                      {a.rejectedReasonMessage}
                    </Text>
                  )}
                  {a.errorMessage && (
                    <Text size="xs" c="dimmed">
                      {a.errorMessage}
                    </Text>
                  )}
                  {a.rawOutputPreview && (
                    <Text size="xs" c="dimmed">
                      Output: {a.rawOutputPreview}
                    </Text>
                  )}
                  {a.sanitizedOutputPreview && (
                    <Text size="xs" c="dimmed">
                      Sanitized: {a.sanitizedOutputPreview}
                    </Text>
                  )}
                </Box>
              ))}
              {report.debugSummary && (
                <Box
                  mt={4}
                  p="xs"
                  style={{
                    backgroundColor: "var(--mantine-color-default-hover)",
                    borderRadius: 4,
                    fontFamily: "monospace",
                    whiteSpace: "pre-wrap",
                    fontSize: 11,
                  }}
                >
                  {report.debugSummary}
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}

function toToolFallbackStatus(
  status: SubAgentRun["toolCalls"][number]["status"],
): "running" | "complete" | "error" {
  return status;
}
