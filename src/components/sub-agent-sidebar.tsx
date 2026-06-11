import { Box, ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { XIcon } from "lucide-react";
import { useSubAgentStore } from "@/lib/sub-agent-store";
import type { SubAgentRun } from "@/lib/sub-agent-types";

interface SubAgentSidebarProps {
  chatId: string;
  onClose: () => void;
}

export function SubAgentSidebar({ chatId, onClose }: SubAgentSidebarProps) {
  const store = useSubAgentStore();
  const runs = store.getRuns(chatId);
  const selectedRun = store.getSelectedRun(chatId);

  return (
    <Box
      style={{
        width: 380,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: "1px solid var(--mantine-color-default-border)",
        backgroundColor: "var(--mantine-color-body)",
        overflow: "hidden",
      }}
    >
      <Box
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--mantine-color-default-border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Text size="sm" fw={600} style={{ flex: 1 }}>
          Subagents
        </Text>
        <UnstyledButton onClick={onClose} aria-label="Close subagent sidebar">
          <XIcon size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
        </UnstyledButton>
      </Box>

      <Box
        style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--mantine-color-default-border)",
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {runs.map((run) => (
          <RunListItem
            key={run.id}
            run={run}
            active={selectedRun?.id === run.id}
            onClick={() => store.selectRun(run.id)}
          />
        ))}
      </Box>

      <ScrollArea style={{ flex: 1 }} type="auto">
        {selectedRun ? (
          <DetailPanel run={selectedRun} />
        ) : (
          <Box p="md">
            <Text size="sm" c="dimmed">
              Select a subagent to view details
            </Text>
          </Box>
        )}
      </ScrollArea>
    </Box>
  );
}

function RunListItem({
  run,
  active,
  onClick,
}: {
  run: SubAgentRun;
  active: boolean;
  onClick: () => void;
}) {
  const duration = getDuration(run);

  return (
    <UnstyledButton
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        width: "100%",
        fontSize: 13,
        textAlign: "left",
        backgroundColor: active
          ? "var(--mantine-color-default-hover)"
          : undefined,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          flexShrink: 0,
          backgroundColor:
            run.status === "running"
              ? "var(--mantine-color-blue-6)"
              : run.status === "complete"
                ? "var(--mantine-color-teal-6)"
                : "var(--mantine-color-red-6)",
          animation:
            run.status === "running" ? "pulse 2s infinite" : undefined,
        }}
      />
      <Text size="sm" style={{ flex: 1 }} truncate>
        {run.name}
      </Text>
      <Text size="xs" c="dimmed">
        {duration}
      </Text>
    </UnstyledButton>
  );
}

function DetailPanel({ run }: { run: SubAgentRun }) {
  return (
    <Box p="md" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {run.text && (
        <Box>
          <Text size="xs" fw={500} c="dimmed" mb={4}>
            Output
          </Text>
          <Box
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              backgroundColor: "var(--mantine-color-default-hover)",
              padding: 12,
              borderRadius: 6,
            }}
          >
            {run.text}
          </Box>
        </Box>
      )}

      {run.error && (
        <Box>
          <Text size="xs" fw={500} c="dimmed" mb={4}>
            Error
          </Text>
          <Text size="sm" c="red">
            {run.error}
          </Text>
        </Box>
      )}

      {run.toolCalls.length > 0 && (
        <Box>
          <Text size="xs" fw={500} c="dimmed" mb={4}>
            Tool Calls
          </Text>
          {run.toolCalls.map((tc, i) => (
            <ToolCallCard key={i} toolCall={tc} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ToolCallCard({
  toolCall: tc,
}: {
  toolCall: SubAgentRun["toolCalls"][number];
}) {
  return (
    <Box
      mb={8}
      style={{
        backgroundColor: "var(--mantine-color-default-hover)",
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <Box
        style={{
          padding: "8px 12px",
          fontSize: 12,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Text size="xs" fw={500}>
          {tc.toolName}
        </Text>
        <Text
          size="xs"
          ml="auto"
          c={tc.status === "complete" ? "teal" : tc.status === "error" ? "red" : "blue"}
        >
          {tc.status}
        </Text>
      </Box>
      {tc.args !== undefined && (
        <Box px={12} pb={8}>
          <Text size="xs" fw={500} c="dimmed" mb={4}>
            Input
          </Text>
          <pre
            className="md-code-bg md-code-block"
            style={{ fontSize: 11 }}
          >
            {formatJson(tc.args)}
          </pre>
        </Box>
      )}
      {tc.result !== undefined && (
        <Box px={12} pb={8}>
          <Text size="xs" fw={500} c="dimmed" mb={4}>
            Result
          </Text>
          <pre
            className="md-code-bg md-code-block"
            style={{ fontSize: 11 }}
          >
            {formatJson(tc.result)}
          </pre>
        </Box>
      )}
    </Box>
  );
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getDuration(run: SubAgentRun): string {
  if (run.status === "running") return "now";
  if (!run.startedAt) return "";
  const start = new Date(run.startedAt).getTime();
  const end = run.finishedAt
    ? new Date(run.finishedAt).getTime()
    : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}
