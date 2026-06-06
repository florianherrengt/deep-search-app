import { ChevronDownIcon, WrenchIcon } from "lucide-react";
import { Collapse, Box, Text, UnstyledButton } from "@mantine/core";
import { useState } from "react";

function formatValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function ToolFallback({
  toolName,
  args,
  result,
  status,
}: {
  toolName: string;
  args?: unknown;
  result?: unknown;
  status: "running" | "complete" | "error";
}) {
  const [opened, setOpened] = useState(false);

  return (
    <Box my={8} style={{ borderRadius: 8, border: "1px solid var(--mantine-color-default-border)", backgroundColor: "var(--mantine-color-gray-0)" }}>
      <UnstyledButton
        onClick={() => setOpened(!opened)}
        aria-label={`${opened ? "Collapse" : "Expand"} ${toolName} details`}
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
        <WrenchIcon style={{ width: 14, height: 14, color: "var(--mantine-color-dimmed)" }} />
        <Text size="sm" fw={500} style={{ color: "var(--mantine-color-gray-7)" }}>{toolName}</Text>
        {status === "running" && (
          <span style={{ marginLeft: "auto", width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--mantine-color-gray-3)", borderTopColor: "var(--mantine-color-blue-6)", animation: "spin 1s linear infinite" }} />
        )}
        {status === "complete" && (
          <Text size="xs" c="teal" ml="auto">done</Text>
        )}
        {status === "error" && (
          <Text size="xs" c="red" ml="auto">error</Text>
        )}
        <ChevronDownIcon
          style={{
            width: 14,
            height: 14,
            color: "var(--mantine-color-dimmed)",
            transition: "transform 0.2s",
            transform: opened ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </UnstyledButton>
      <Collapse in={opened}>
        <Box style={{ borderTop: "1px solid var(--mantine-color-default-border)", padding: "8px 12px" }}>
          {formatValue(args) && (
            <Box mb="xs">
              <Text size="xs" fw={500} c="dimmed" mb={4}>Input</Text>
              <pre style={{ overflowX: "auto", borderRadius: 4, backgroundColor: "var(--mantine-color-gray-1)", padding: 8, fontSize: 12, whiteSpace: "pre-wrap", margin: 0 }}>
                {formatValue(args)}
              </pre>
            </Box>
          )}
          {formatValue(result) && (
            <Box>
              <Text size="xs" fw={500} c="dimmed" mb={4}>Result</Text>
              <pre style={{ overflowX: "auto", borderRadius: 4, backgroundColor: "var(--mantine-color-gray-1)", padding: 8, fontSize: 12, whiteSpace: "pre-wrap", margin: 0 }}>
                {formatValue(result)}
              </pre>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}
