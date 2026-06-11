import { useEffect, useMemo, useState } from "react";
import { Box, Collapse, ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { BotIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { MarkdownContent } from "@/components/assistant-ui/markdown-text";
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
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setOpenRunIds((current) => {
      const next = new Set(current);
      let changed = false;

      for (const run of runs) {
        if (run.status === "running" && !next.has(run.id)) {
          next.add(run.id);
          changed = true;
        }
      }

      if (selectedRun && !next.has(selectedRun.id)) {
        next.add(selectedRun.id);
        changed = true;
      }

      return changed ? next : current;
    });
  }, [runs, selectedRun]);

  const visibleRuns = useMemo(
    () => [...runs].sort(compareSubAgentRuns),
    [runs],
  );

  return (
    <Box
      style={{
        width: 420,
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
          Sub-agents
        </Text>
        <UnstyledButton onClick={onClose} aria-label="Close subagent sidebar">
          <XIcon size={16} style={{ color: "var(--mantine-color-dimmed)" }} />
        </UnstyledButton>
      </Box>

      <ScrollArea style={{ flex: 1 }} type="auto">
        <Box p="sm" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {visibleRuns.length === 0 ? (
            <Box p="sm">
              <Text size="sm" c="dimmed">
                No sub-agents for this conversation yet.
              </Text>
            </Box>
          ) : (
            visibleRuns.map((run) => {
              const opened = openRunIds.has(run.id);
              return (
                <SubAgentRunCard
                  key={run.id}
                  run={run}
                  opened={opened}
                  onToggle={() => {
                    setOpenRunIds((current) => {
                      const next = new Set(current);
                      if (next.has(run.id)) {
                        next.delete(run.id);
                      } else {
                        next.add(run.id);
                      }
                      return next;
                    });
                    store.selectRun(run.id);
                  }}
                />
              );
            })
          )}
        </Box>
      </ScrollArea>
    </Box>
  );
}

function SubAgentRunCard({
  run,
  opened,
  onToggle,
}: {
  run: SubAgentRun;
  opened: boolean;
  onToggle: () => void;
}) {
  const status = getStatusMeta(run.status);

  return (
    <Box className="md-surface md-card-sm" style={{ overflow: "hidden" }}>
      <UnstyledButton
        onClick={onToggle}
        aria-label={`${opened ? "Collapse" : "Expand"} ${run.name}`}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          textAlign: "left",
        }}
      >
        <BotIcon size={15} style={{ color: "var(--mantine-color-dimmed)" }} />
        <Box style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={600} truncate>
            {run.name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {run.chatId}
          </Text>
        </Box>
        {run.status === "running" ? (
          <span
            aria-label="running"
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid var(--mantine-color-default-border)",
              borderTopColor: "var(--mantine-color-blue-6)",
              animation: "spin 1s linear infinite",
              flexShrink: 0,
            }}
          />
        ) : (
          <Text size="xs" c={status.color} fw={600} style={{ flexShrink: 0 }}>
            {status.label}
          </Text>
        )}
        <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
          {getDuration(run)}
        </Text>
        <ChevronDownIcon
          size={14}
          style={{
            color: "var(--mantine-color-dimmed)",
            transition: "transform 0.2s",
            transform: opened ? "rotate(180deg)" : "rotate(0deg)",
            flexShrink: 0,
          }}
        />
      </UnstyledButton>

      <Collapse in={opened}>
        <Box className="md-divider-top" p="sm">
          <SubAgentTranscript run={run} />
        </Box>
      </Collapse>
    </Box>
  );
}

function SubAgentTranscript({ run }: { run: SubAgentRun }) {
  const hasContent = run.text.trim().length > 0;

  return (
    <Box style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {hasContent ? (
        <Box style={{ overflowX: "auto", fontSize: 13, lineHeight: 1.55 }}>
          <MarkdownContent text={run.text} />
        </Box>
      ) : run.status === "running" ? (
        <Text size="sm" c="dimmed">
          Waiting for sub-agent output...
        </Text>
      ) : null}

      {run.toolCalls.map((toolCall, index) => (
        <ToolFallback
          key={toolCall.toolCallId ?? `${toolCall.toolName}-${index}`}
          toolName={toolCall.toolName}
          args={toolCall.args}
          result={toolCall.result}
          status={toToolFallbackStatus(toolCall.status)}
        />
      ))}

      {run.error && (
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
          <Text size="sm">{run.error}</Text>
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

function getStatusMeta(status: SubAgentRun["status"]): {
  label: string;
  color: string;
} {
  switch (status) {
    case "running":
      return { label: "running", color: "blue" };
    case "completed":
      return { label: "completed", color: "teal" };
    case "failed":
      return { label: "failed", color: "red" };
  }
}

function compareSubAgentRuns(a: SubAgentRun, b: SubAgentRun) {
  if (a.status === "running" && b.status !== "running") return -1;
  if (a.status !== "running" && b.status === "running") return 1;
  return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
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
