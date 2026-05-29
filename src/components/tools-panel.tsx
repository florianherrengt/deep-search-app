import { useState, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="mx-auto max-w-4xl px-4 py-6 overflow-y-auto h-full">
      <h2 className="text-lg font-semibold">Tools</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Call tools directly with custom parameters and inspect the results.
      </p>

      <div className="mt-4 max-w-md space-y-1">
        <Label htmlFor="tools-research-folder" className="text-sm">
          Research folder
        </Label>
        <Input
          id="tools-research-folder"
          value={researchFolderValue}
          placeholder="research-folder"
          onChange={(event) => setResearchFolderValue(event.target.value)}
        />
      </div>

      <div className="mt-4 flex gap-6">
        <div className="w-64 shrink-0 space-y-1">
          <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Available</p>
          {availableTools.map((tool) => (
            <button
              key={tool.name}
              onClick={() => handleSelectTool(tool)}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                selectedTool?.name === tool.name
                  ? "bg-secondary text-secondary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {tool.name}
            </button>
          ))}
          {unavailableTools.length > 0 && (
            <>
              <p className="mb-2 mt-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Unavailable
              </p>
              {unavailableTools.map((tool) => (
                <button
                  key={tool.name}
                  disabled
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground opacity-50 cursor-not-allowed"
                >
                  {tool.name}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          {selectedTool ? (
            <div className="rounded-lg border p-4 space-y-3">
              <div>
                <p className="font-medium">{selectedTool.name}</p>
                <p className="text-sm text-muted-foreground">{selectedTool.description}</p>
              </div>

              {Object.entries(selectedTool.parameters).map(([key, param]) => (
                <div key={key} className="space-y-1">
                  <Label className="text-sm">
                    {key}
                    {!param.required && (
                      <span className="ml-1 text-muted-foreground">(optional)</span>
                    )}
                  </Label>
                  {param.enum ? (
                    <select
                      value={paramValues[key] ?? ""}
                      onChange={(e) =>
                        setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">Select...</option>
                      {param.enum.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : param.type === "boolean" ? (
                    <select
                      value={paramValues[key] ?? ""}
                      onChange={(e) =>
                        setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">Select...</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <Input
                      type={param.type === "number" ? "number" : "text"}
                      placeholder={param.description ?? key}
                      value={paramValues[key] ?? ""}
                      onChange={(e) =>
                        setParamValues((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleExecute();
                        }
                      }}
                    />
                  )}
                </div>
              ))}

              <Button
                onClick={() => void handleExecute()}
                disabled={loading}
                size="sm"
              >
                {loading ? "Running..." : "Execute"}
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Select a tool from the sidebar to get started.
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Results</p>
              {results.map((entry, i) => (
                <ResultCard key={entry.timestamp + "-" + i} entry={entry} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ entry }: { entry: ToolResult }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border text-sm">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{entry.tool}</span>
          {entry.error ? (
            <span className="text-xs text-destructive">Error</span>
          ) : (
            <span className="text-xs text-emerald-600">OK</span>
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <span className="text-muted-foreground">{expanded ? "▾" : "▸"}</span>
      </div>

      {expanded && (
        <div className="border-t px-3 py-2 space-y-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Input</p>
            <pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-40">
              {JSON.stringify(entry.params, null, 2)}
            </pre>
          </div>
          {entry.error ? (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Error</p>
              <pre className="rounded bg-destructive/10 p-2 text-xs overflow-auto max-h-40 text-destructive">
                {entry.error}
              </pre>
            </div>
          ) : (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Output</p>
              <pre className="rounded bg-muted p-2 text-xs overflow-auto max-h-80">
                {typeof entry.result === "string"
                  ? entry.result
                  : JSON.stringify(entry.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
