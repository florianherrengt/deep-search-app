import { useState, useCallback, useMemo, useEffect } from "react";
import { Button, TextInput, ScrollArea, Box, Text, Group, Paper, Stack, Collapse, Select as MantineSelect } from "@mantine/core";
import { getAvailableTools, type ToolDescriptor, type ToolExecuteConfig } from "@/lib/execute-tool";

type ToolResult = {
  tool: string;
  params: Record<string, unknown>;
  result: unknown;
  error?: string;
  timestamp: number;
};

interface ToolsPanelProps {
  config?: ToolExecuteConfig;
}

export function ToolsPanel({ config }: ToolsPanelProps) {
  const [researchFolderValue, setResearchFolderValue] = useState(
    config?.researchFolder ?? "",
  );
  const effectiveConfig = useMemo(
    () =>
      config
        ? {
            ...config,
            researchFolder: researchFolderValue.trim() || null,
          }
        : undefined,
    [config, researchFolderValue],
  );
  const tools = getAvailableTools(effectiveConfig);
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const selectedTool =
    tools.find((tool) => tool.name === selectedToolName && tool.available) ??
    null;
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ToolResult[]>([]);

  useEffect(() => {
    setResearchFolderValue(config?.researchFolder ?? "");
  }, [config?.researchFolder]);

  const handleSelectTool = useCallback((tool: ToolDescriptor) => {
    setSelectedToolName(tool.name);
    const defaults: Record<string, string> = {};
    for (const [key, param] of Object.entries(tool.parameters)) {
      defaults[key] = param.default !== undefined ? String(param.default) : "";
    }
    setParamValues(defaults);
  }, []);

  const handleExecute = useCallback(async () => {
    if (!selectedTool) return;

    const params: Record<string, unknown> = {};
    for (const [key, param] of Object.entries(selectedTool.parameters)) {
      const raw = paramValues[key];
      if (raw === "" || raw === undefined) {
        if (param.required) return;
        continue;
      }
      if (param.type === "number") {
        params[key] = Number(raw);
      } else if (param.type === "boolean") {
        params[key] = raw === "true";
      } else {
        params[key] = raw;
      }
    }

    setLoading(true);
    const timestamp = Date.now();

    try {
      const result = await selectedTool.execute(params);
      setResults((prev) => [
        { tool: selectedTool.name, params, result, timestamp },
        ...prev,
      ]);
    } catch (err) {
      setResults((prev) => [
        {
          tool: selectedTool.name,
          params,
          result: null,
          error: err instanceof Error ? err.message : String(err),
          timestamp,
        },
        ...prev,
      ]);
    } finally {
      setLoading(false);
    }
  }, [selectedTool, paramValues]);

  const availableTools = tools.filter((t) => t.available);
  const unavailableTools = tools.filter((t) => !t.available);

  return (
    <ScrollArea style={{ height: "100%" }}>
      <Box maw={900} mx="auto" p="md" py={24}>
        <Text size="lg" fw={600}>Tools</Text>
        <Text size="sm" c="dimmed" mt={4}>
          Call tools directly with custom parameters and inspect the results.
        </Text>

        <Box mt="md" maw={400}>
          <TextInput
            label="Research folder"
            value={researchFolderValue}
            placeholder="research-folder"
            onChange={(event) => setResearchFolderValue(event.currentTarget.value)}
          />
        </Box>

        <Group mt="md" gap="xl" align="flex-start" wrap="nowrap">
          <Box style={{ width: 256, flexShrink: 0 }}>
            <Text size="xs" fw={500} tt="uppercase" c="dimmed" mb="xs">Available</Text>
            <Stack gap={4}>
              {availableTools.map((tool) => (
                <Button
                  key={tool.name}
                  variant={selectedTool?.name === tool.name ? "light" : "subtle"}
                  color={selectedTool?.name === tool.name ? "gray" : "gray"}
                  fullWidth
                  styles={{ inner: { justifyContent: "flex-start" } }}
                  onClick={() => handleSelectTool(tool)}
                >
                  {tool.name}
                </Button>
              ))}
              {unavailableTools.length > 0 && (
                <>
                  <Text size="xs" fw={500} tt="uppercase" c="dimmed" mt="sm" mb="xs">
                    Unavailable
                  </Text>
                  {unavailableTools.map((tool) => (
                    <Button
                      key={tool.name}
                      variant="subtle"
                      color="gray"
                      fullWidth
                      disabled
                      styles={{ inner: { justifyContent: "flex-start" } }}
                    >
                      {tool.name}
                    </Button>
                  ))}
                </>
              )}
            </Stack>
          </Box>

          <Box className="md-flex-fill">
            {selectedTool ? (
              <Paper withBorder p="md">
                <Stack gap="sm">
                  <Box>
                    <Text fw={500}>{selectedTool.name}</Text>
                    <Text size="sm" c="dimmed">{selectedTool.description}</Text>
                  </Box>

                  {Object.entries(selectedTool.parameters).map(([key, param]) => (
                    <Box key={key}>
                      {param.enum ? (
                        <MantineSelect
                          label={
                            <Text size="sm">
                              {key}
                              {!param.required && <Text component="span" c="dimmed" ml={4}>(optional)</Text>}
                            </Text>
                          }
                          placeholder="Select..."
                          value={paramValues[key] ?? ""}
                          onChange={(value) =>
                            setParamValues((prev) => ({ ...prev, [key]: value ?? "" }))
                          }
                          data={param.enum.map((v) => ({ value: v, label: v }))}
                        />
                      ) : param.type === "boolean" ? (
                        <MantineSelect
                          label={
                            <Text size="sm">
                              {key}
                              {!param.required && <Text component="span" c="dimmed" ml={4}>(optional)</Text>}
                            </Text>
                          }
                          placeholder="Select..."
                          value={paramValues[key] ?? ""}
                          onChange={(value) =>
                            setParamValues((prev) => ({ ...prev, [key]: value ?? "" }))
                          }
                          data={[
                            { value: "true", label: "true" },
                            { value: "false", label: "false" },
                          ]}
                        />
                      ) : (
                        <TextInput
                          label={
                            <Text size="sm">
                              {key}
                              {!param.required && <Text component="span" c="dimmed" ml={4}>(optional)</Text>}
                            </Text>
                          }
                          type={param.type === "number" ? "number" : "text"}
                          placeholder={param.description ?? key}
                          value={paramValues[key] ?? ""}
                          onChange={(e) =>
                            setParamValues((prev) => ({ ...prev, [key]: e.currentTarget.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleExecute();
                            }
                          }}
                        />
                      )}
                    </Box>
                  ))}

                  <Button
                    onClick={() => void handleExecute()}
                    disabled={loading}
                    size="sm"
                  >
                    {loading ? "Running..." : "Execute"}
                  </Button>
                </Stack>
              </Paper>
            ) : (
              <Paper withBorder p={32} style={{ borderStyle: "dashed", textAlign: "center" }}>
                <Text size="sm" c="dimmed">Select a tool from the sidebar to get started.</Text>
              </Paper>
            )}

            {results.length > 0 && (
              <Stack gap="sm" mt="md">
                <Text size="sm" fw={500}>Results</Text>
                {results.map((entry, i) => (
                  <ResultCard key={entry.timestamp + "-" + i} entry={entry} />
                ))}
              </Stack>
            )}
          </Box>
        </Group>
      </Box>
    </ScrollArea>
  );
}

function ResultCard({ entry }: { entry: ToolResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Paper withBorder>
      <Group
        justify="space-between"
        px="sm"
        py="xs"
        style={{ cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.tool} result`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <Group gap="xs">
          <Text size="sm" fw={500}>{entry.tool}</Text>
          {entry.error ? (
            <Text size="xs" c="red">Error</Text>
          ) : (
            <Text size="xs" c="teal">OK</Text>
          )}
          <Text size="xs" c="dimmed">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </Text>
        </Group>
        <Text c="dimmed">{expanded ? "▾" : "▸"}</Text>
      </Group>

      <Collapse in={expanded}>
        <Box className="md-divider-top" p="sm">
          <Stack gap="sm">
            <Box>
              <Text size="xs" fw={500} c="dimmed" mb={4}>Input</Text>
              <Paper className="md-code-bg" p="xs" style={{ overflow: "auto", maxHeight: 160 }}>
                <pre className="md-code-block">{JSON.stringify(entry.params, null, 2)}</pre>
              </Paper>
            </Box>
            {entry.error ? (
              <Box>
                <Text size="xs" fw={500} c="dimmed" mb={4}>Error</Text>
                <Paper bg="var(--mantine-color-red-0)" c="red" p="xs" style={{ overflow: "auto", maxHeight: 160 }}>
                  <pre className="md-code-block">{entry.error}</pre>
                </Paper>
              </Box>
            ) : (
              <Box>
                <Text size="xs" fw={500} c="dimmed" mb={4}>Output</Text>
                <Paper className="md-code-bg" p="xs" style={{ overflow: "auto", maxHeight: 320 }}>
                  <pre className="md-code-block">
                    {typeof entry.result === "string"
                      ? entry.result
                      : JSON.stringify(entry.result, null, 2)}
                  </pre>
                </Paper>
              </Box>
            )}
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
}
