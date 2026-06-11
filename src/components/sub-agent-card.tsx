import { WrenchIcon } from "lucide-react";
import { Box, Text, UnstyledButton } from "@mantine/core";
import type { SubAgentRun } from "@/lib/sub-agent-types";

export function SubAgentCard({
  run,
  onClick,
}: {
  run: SubAgentRun;
  onClick: () => void;
}) {
  return (
    <Box my={8} className="md-surface md-card-sm">
      <UnstyledButton
        onClick={onClick}
        aria-label={`Inspect ${run.name}`}
        style={{
          display: "flex",
          width: "100%",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          fontSize: 14,
          textAlign: "left",
        }}
      >
        <WrenchIcon
          style={{
            width: 14,
            height: 14,
            color: "var(--mantine-color-dimmed)",
          }}
        />
        <Text size="sm" fw={500}>
          {run.name}
        </Text>
        {run.status === "running" && (
          <span
            style={{
              marginLeft: "auto",
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid var(--mantine-color-default-border)",
              borderTopColor: "var(--mantine-color-blue-6)",
              animation: "spin 1s linear infinite",
            }}
          />
        )}
        {run.status === "completed" && (
          <Text size="xs" c="teal" ml="auto">
            done
          </Text>
        )}
        {run.status === "failed" && (
          <Text size="xs" c="red" ml="auto">
            error
          </Text>
        )}
        <Text size="xs" c="blue" ml={4} style={{ opacity: 0 }}>
          inspect
        </Text>
      </UnstyledButton>
    </Box>
  );
}
