import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { Collapse, Box, Text, UnstyledButton } from "@mantine/core";
import { useDeferredValue, useMemo, useState, type CSSProperties } from "react";
import { useSubAgentReaders } from "@/lib/sub-agent-store";
import { SubAgentTranscriptInline } from "@/components/sub-agent-transcript-inline";

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

// Hoisted: ToolFallback re-renders on every token of any sibling streaming
// text part inside the same message (assistant-ui re-renders all parts when
// any part updates). Static style identity lets React skip the diff.
const HEADER_BUTTON_STYLE: CSSProperties = {
  display: "flex",
  width: "100%",
  alignItems: "center",
  gap: 8,
  padding: "8px 12px",
  fontSize: 14,
  textAlign: "left",
};
const RUNNING_SPINNER_STYLE: CSSProperties = {
  marginLeft: "auto",
  width: 12,
  height: 12,
  borderRadius: "50%",
  border: "2px solid var(--mantine-color-default-border)",
  borderTopColor: "var(--mantine-color-blue-6)",
  animation: "spin 1s linear infinite",
};
const CHEVRON_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  color: "var(--mantine-color-dimmed)",
  transition: "transform 0.2s",
};

type ToolFallbackStatus = "running" | "complete" | "error";

interface ToolFallbackProps {
  toolName: string;
  args?: unknown;
  result?: unknown;
  status: ToolFallbackStatus;
  chatId?: string;
  toolCallId?: string;
}

export function ToolFallback({
  toolName,
  args,
  result,
  status,
  chatId,
  toolCallId,
}: ToolFallbackProps) {
  const [opened, setOpened] = useState(false);

  return (
    <Box my={8} className="md-surface md-card-sm">
      <UnstyledButton
        onClick={() => setOpened(!opened)}
        aria-label={`${opened ? "Collapse" : "Expand"} ${toolName} details`}
        style={HEADER_BUTTON_STYLE}
      >
        <WrenchIcon style={{ width: 14, height: 14, color: "var(--mantine-color-dimmed)" }} />
        <Text size="sm" fw={500}>{toolName}</Text>
        {status === "running" && (
          <span style={RUNNING_SPINNER_STYLE} />
        )}
        {status === "complete" && (
          <Text size="xs" c="teal" ml="auto">done</Text>
        )}
        {status === "error" && (
          <Text size="xs" c="red" ml="auto">error</Text>
        )}
        <ChevronDownIcon
          style={{
            ...CHEVRON_STYLE,
            transform: opened ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </UnstyledButton>
      <Collapse in={opened}>
        {opened && (
          <ToolFallbackExpandedDetails
            args={args}
            result={result}
            chatId={chatId}
            toolCallId={toolCallId}
          />
        )}
      </Collapse>
    </Box>
  );
}

function ToolFallbackExpandedDetails({
  args,
  result,
  chatId,
  toolCallId,
}: Pick<ToolFallbackProps, "args" | "result" | "chatId" | "toolCallId">) {
  const { getRuns } = useSubAgentReaders();

  const allRuns = getRuns(chatId ?? "");
  const deferredRuns = useDeferredValue(allRuns);
  const matchingRuns = useMemo(
    () => {
      if (!chatId || !toolCallId) return [];
      return deferredRuns.filter(
        (run) =>
          run.displayTarget?.type === "toolCall" &&
          run.displayTarget.toolCallId === toolCallId,
      );
    },
    [deferredRuns, chatId, toolCallId],
  );

  const formattedDetails = useMemo(
    () => ({
      args: formatValue(args),
      result: formatValue(result),
    }),
    [args, result],
  );

  return (
    <Box className="md-divider-top" p="8px 12px">
      {formattedDetails.args && (
        <Box mb="xs">
          <Text size="xs" fw={500} c="dimmed" mb={4}>Input</Text>
          <pre className="md-code-bg md-code-block">
            {formattedDetails.args}
          </pre>
        </Box>
      )}
      {formattedDetails.result && (
        <Box>
          <Text size="xs" fw={500} c="dimmed" mb={4}>Result</Text>
          <pre className="md-code-bg md-code-block">
            {formattedDetails.result}
          </pre>
        </Box>
      )}
      {matchingRuns.map((run) => (
        <Box key={run.id} mt="md" className="md-divider-top" p="8px 12px">
          <SubAgentTranscriptInline
            text={run.text}
            status={run.status}
            error={run.error}
            report={run.report}
            toolCalls={run.toolCalls}
          />
        </Box>
      ))}
    </Box>
  );
}
