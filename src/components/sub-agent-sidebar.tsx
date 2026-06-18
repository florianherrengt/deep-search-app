import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Box, Collapse, ScrollArea, Text, UnstyledButton } from "@mantine/core";
import { BotIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { SubAgentTranscriptInline } from "@/components/sub-agent-transcript-inline";
import { useSubAgentActions, useSubAgentReaders } from "@/lib/sub-agent-store";
import type { SubAgentRun } from "@/lib/sub-agent-types";
import { useSubAgentRenderCounter } from "@/lib/sub-agent-profiler";

interface SubAgentSidebarProps {
  chatId: string;
  onClose: () => void;
}

export function SubAgentSidebar({ chatId, onClose }: SubAgentSidebarProps) {
  useSubAgentRenderCounter("SubAgentSidebar");
  const { selectRun } = useSubAgentActions();
  const { getRuns, getSelectedRun } = useSubAgentReaders();
  const runs = getRuns(chatId);
  const deferredRuns = useDeferredValue(runs);
  const selectedRun = getSelectedRun(chatId);
  const [openRunIds, setOpenRunIds] = useState<Set<string>>(() => new Set());
  const userCollapsedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setOpenRunIds(new Set());
    userCollapsedRef.current = new Set();
  }, [chatId]);

  useEffect(() => {
    setOpenRunIds((current) => {
      const next = new Set(current);
      let changed = false;

      for (const run of runs) {
        if (run.displayTarget?.type === "toolCall") continue;
        if ((run.status === "running" || run.status === "streaming") && !next.has(run.id) && !userCollapsedRef.current.has(run.id)) {
          next.add(run.id);
          changed = true;
        }
      }

      if (selectedRun && !next.has(selectedRun.id)) {
        next.add(selectedRun.id);
        userCollapsedRef.current.delete(selectedRun.id);
        changed = true;
      }

      return changed ? next : current;
    });
  }, [runs, selectedRun]);

  const visibleRuns = useMemo(
    () => {
      const filtered = [...deferredRuns].filter(r => r.displayTarget?.type !== "toolCall");
      return filtered.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    },
    [deferredRuns],
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
                      const wasOpen = next.has(run.id);
                      if (wasOpen) {
                        next.delete(run.id);
                        userCollapsedRef.current.add(run.id);
                      } else {
                        next.add(run.id);
                        userCollapsedRef.current.delete(run.id);
                      }
                      return next;
                    });
                    const isOpen = openRunIds.has(run.id);
                    if (isOpen) {
                      selectRun(null);
                    } else {
                      selectRun(run.id);
                    }
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

const SubAgentRunCard = memo(function SubAgentRunCard({
  run,
  opened,
  onToggle,
}: {
  run: SubAgentRun;
  opened: boolean;
  onToggle: () => void;
}) {
  useSubAgentRenderCounter("SubAgentRunCard");
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
        {(run.status === "running" || run.status === "streaming") ? (
          <span
            aria-label={run.status}
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
}, (prev, next) =>
  prev.opened === next.opened &&
  prev.run.id === next.run.id &&
  prev.run.status === next.run.status &&
  prev.run.text === next.run.text &&
  prev.run.error === next.run.error &&
  prev.run.name === next.run.name &&
  prev.run.chatId === next.run.chatId &&
  prev.run.startedAt === next.run.startedAt &&
  prev.run.finishedAt === next.run.finishedAt &&
  prev.run.toolCalls === next.run.toolCalls &&
  prev.run.report === next.run.report
);

function SubAgentTranscript({ run }: { run: SubAgentRun }) {
  useSubAgentRenderCounter("SubAgentTranscript");
  return (
    <SubAgentTranscriptInline
      text={run.text}
      status={run.status}
      error={run.error}
      report={run.report}
      toolCalls={run.toolCalls}
    />
  );
}

function getStatusMeta(status: SubAgentRun["status"]): {
  label: string;
  color: string;
} {
  switch (status) {
    case "running":
      return { label: "running", color: "blue" };
    case "streaming":
      return { label: "streaming", color: "blue" };
    case "completed":
      return { label: "completed", color: "teal" };
    case "failed":
      return { label: "failed", color: "red" };
    case "cancelled":
      return { label: "cancelled", color: "dimmed" };
  }
}

function getDuration(run: SubAgentRun): string {
  if (!run.startedAt) return "";
  const start = new Date(run.startedAt).getTime();
  const end = run.finishedAt
    ? new Date(run.finishedAt).getTime()
    : Date.now();
  const ms = end - start;
  if (ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}
