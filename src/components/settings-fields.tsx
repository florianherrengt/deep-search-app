import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { CheckIcon, Loader2, RefreshCw } from "lucide-react";
import { Button, TextInput, Select, SegmentedControl, Box, Stack, Text, Group, Checkbox, Paper, Progress } from "@mantine/core";
import { generateText } from "ai";
import {
  CHAT_PROVIDER_SETTINGS,
  getConfiguredChatProviderDefinitions,
  getInitialProviderSelection,
  getProviderSettingsDefinition,
  type ChatProviderSettingsDefinition,
  type SettingsFieldDefinition,
} from "@/lib/chat-provider-settings";
import { createChatLanguageModel, getChatProviderLabel, type ChatProvider } from "@/lib/chat-providers";
import {
  CURRENCIES,
  EMBEDDING_DEFAULTS,
  RERANKER_DEFAULTS,
  WEB_EXTRACTION_BACKENDS,
  resolveEmbeddingConfig,
} from "@/lib/settings-store";
import { backfillIndex } from "@/lib/research-search";
import type { Settings } from "@/hooks/use-settings";
import { useAppUpdate } from "@/hooks/use-app-update";

const RESEARCH_INDEX_FIELDS: readonly SettingsFieldDefinition[] = [
  {
    key: "embedding_base_url",
    label: "Embedding Base URL",
    type: "text",
    placeholder: EMBEDDING_DEFAULTS.base_url,
  },
  {
    key: "embedding_api_key",
    label: "Embedding API Key",
    type: "password",
    placeholder: "Falls back to OpenRouter key",
  },
  {
    key: "embedding_model",
    label: "Embedding Model",
    type: "text",
    placeholder: EMBEDDING_DEFAULTS.model,
  },
  {
    key: "embedding_dimensions",
    label: "Dimensions",
    type: "text",
    placeholder: String(EMBEDDING_DEFAULTS.dimensions),
  },
  {
    key: "embedding_query_prefix",
    label: "Query Prefix",
    type: "text",
    placeholder: EMBEDDING_DEFAULTS.query_prefix,
  },
];

const RERANKER_FIELDS: readonly SettingsFieldDefinition[] = [
  {
    key: "reranker_base_url",
    label: "Reranker Base URL",
    type: "text",
    placeholder: RERANKER_DEFAULTS.base_url,
  },
  {
    key: "reranker_api_key",
    label: "Reranker API Key",
    type: "password",
    placeholder: "Falls back to embedding key",
  },
  {
    key: "reranker_model",
    label: "Reranker Model",
    type: "text",
    placeholder: RERANKER_DEFAULTS.model,
  },
];

function ReindexButton({ settings }: { settings: Settings }) {
  const [reindexing, setReindexing] = useState(false);

  async function handleReindex() {
    setReindexing(true);
    try {
      const embeddingConfig = resolveEmbeddingConfig(settings);
      const dimensions = settings.embedding_dimensions || EMBEDDING_DEFAULTS.dimensions;
      await backfillIndex(embeddingConfig, dimensions);
    } catch (err) {
      console.error("[settings] Re-index failed:", err);
    } finally {
      setReindexing(false);
    }
  }

  return (
    <Group gap="xs">
      <Button
        variant="outline"
        size="sm"
        disabled={reindexing || !resolveEmbeddingConfig(settings).api_key}
        onClick={() => { void handleReindex(); }}
      >
        {reindexing ? "Re-indexing..." : "Re-index All"}
      </Button>
      <Text size="xs" c="dimmed">
        Drop and recreate the vector index with current settings.
      </Text>
    </Group>
  );
}

interface SettingsFieldsProps {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(
    key: K,
    value: Settings[K],
  ) => Promise<void>;
}

const SERVICE_FIELDS: readonly SettingsFieldDefinition[] = [
  {
    key: "searxng_url",
    label: "SearXNG URL",
    type: "text",
    placeholder: "http://localhost:8080",
  },
  {
    key: "brave_api_key",
    label: "Brave Search API Key",
    type: "password",
    placeholder: "BSA-...",
  },
  {
    key: "exa_api_key",
    label: "Exa API Key",
    type: "password",
    placeholder: "exa-...",
  },
  {
    key: "serper_api_key",
    label: "Serper API Key",
    type: "password",
    placeholder: "serper-...",
  },
  {
    key: "tavily_api_key",
    label: "Tavily API Key",
    type: "password",
    placeholder: "tvly-...",
  },
];

export function SettingsFields({ settings, updateSetting }: SettingsFieldsProps) {
  const fieldIdPrefix = useId();
  const [selectedProvider, setSelectedProvider] = useState<ChatProvider>(() =>
    getInitialProviderSelection(settings),
  );
  const selectedDefinition = getProviderSettingsDefinition(selectedProvider);
  const configuredProviders = useMemo(
    () => new Set(getConfiguredChatProviderDefinitions(settings).map((d) => d.provider)),
    [settings],
  );
  const providerOptions = useMemo(
    () =>
      CHAT_PROVIDER_SETTINGS.map((definition) => ({
        value: definition.provider,
        label: getChatProviderLabel(definition.provider),
      })),
    [],
  );

  async function handleCommit(key: keyof Settings, value: string) {
    const currentValue = settings[key];
    if (typeof currentValue === "number") {
      const trimmed = value.trim();
      if (trimmed === "") return;
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) return;
      if (!Number.isInteger(parsed) || parsed < 1) return;
      if (parsed === currentValue) return;
      await updateSetting(key, parsed as Settings[typeof key]);
      return;
    }
    if (value !== currentValue) {
      await updateSetting(key, value as Settings[typeof key]);
    }
  }

  return (
    <Stack gap="md">
      <Stack gap="sm">
        <Select
          label="Provider"
          value={selectedProvider}
          onChange={(value) => {
            if (!value) return;
            setSelectedProvider(value as ChatProvider);
          }}
          allowDeselect={false}
          data={providerOptions}
          withCheckIcon={false}
          renderOption={({ option }) => (
            <Group gap="xs" flex="1">
              {configuredProviders.has(option.value as ChatProvider) && (
                <CheckIcon size={14} style={{ color: "var(--mantine-color-green-6)" }} />
              )}
              {option.label}
            </Group>
          )}
        />

        <ProviderFields
          key={selectedProvider}
          definition={selectedDefinition}
          settings={settings}
          onCommit={handleCommit}
          fieldIdPrefix={fieldIdPrefix}
        />
      </Stack>

      <Stack gap="sm">
        <Text size="sm" fw={500}>Search Services</Text>
        {SERVICE_FIELDS.map((field) => (
          <SettingInput
            key={field.key}
            field={field}
            inputId={`${fieldIdPrefix}-${field.key}`}
            value={String(settings[field.key] ?? "")}
            onCommit={handleCommit}
          />
        ))}
      </Stack>

      <Stack gap="sm">
        <Text size="sm" fw={500}>Research Index</Text>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            Configure the embedding and reranker endpoints for research search.
            Any OpenAI-compatible <code>/v1/embeddings</code> endpoint works.
          </Text>
          {RESEARCH_INDEX_FIELDS.map((field) => (
            <SettingInput
              key={field.key}
              field={field}
              inputId={`${fieldIdPrefix}-${field.key}`}
              value={String(settings[field.key] ?? "")}
              onCommit={handleCommit}
            />
          ))}
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" fw={500} c="dimmed">Reranker</Text>
          {RERANKER_FIELDS.map((field) => (
            <SettingInput
              key={field.key}
              field={field}
              inputId={`${fieldIdPrefix}-${field.key}`}
              value={String(settings[field.key] ?? "")}
              onCommit={handleCommit}
            />
          ))}
        </Paper>
        <ReindexButton settings={settings} />
      </Stack>

      <Select
        label="Currency"
        value={settings.currency}
        allowDeselect={false}
        onChange={(value) => {
          if (value) {
            void updateSetting("currency", value as Settings["currency"]);
          }
        }}
        data={CURRENCIES.map((code) => ({ value: code, label: code }))}
      />

      <Paper withBorder p="sm">
        <Checkbox
          id={`${fieldIdPrefix}-chrome-devtools-mcp`}
          label={
            <Box>
              <Text size="sm" fw={500}>Chrome DevTools MCP</Text>
              <Text size="xs" c="dimmed">
                Allow last-resort control of a local Chrome session when normal extraction is not enough.
              </Text>
            </Box>
          }
          checked={settings.chrome_devtools_mcp_enabled}
          onChange={(event) => {
            void updateSetting(
              "chrome_devtools_mcp_enabled",
              event.currentTarget.checked,
            );
          }}
        />
        {settings.chrome_devtools_mcp_enabled && (
          <Stack gap="xs" mt="sm">
            <Text size="sm" fw={500}>Connection method</Text>
            <SegmentedControl
              fullWidth
              value={settings.chrome_devtools_mcp_connection_mode}
              onChange={(value) => {
                void updateSetting(
                  "chrome_devtools_mcp_connection_mode",
                  value as Settings["chrome_devtools_mcp_connection_mode"],
                );
              }}
              data={[
                { value: "auto", label: "Auto-connect" },
                { value: "browser-url", label: "Connect to URL" },
              ]}
            />
            {settings.chrome_devtools_mcp_connection_mode === "auto" ? (
              <Text size="xs" c="dimmed">
                Attaches to a local Chrome (M144+) with remote debugging enabled from
                chrome://inspect/#remote-debugging.
              </Text>
            ) : (
              <>
                <SettingInput
                  field={{
                    key: "chrome_devtools_mcp_browser_url",
                    label: "Browser URL",
                    type: "text",
                    placeholder: "http://127.0.0.1:9222",
                  }}
                  inputId={`${fieldIdPrefix}-chrome_devtools_mcp_browser_url`}
                  value={String(settings.chrome_devtools_mcp_browser_url ?? "")}
                  onCommit={handleCommit}
                />
                <Text size="xs" c="dimmed">
                  Connects to a Chrome already started with{" "}
                  <code>--remote-debugging-port</code> (host and port).
                </Text>
              </>
            )}
          </Stack>
        )}
        <Stack gap="xs" mt="sm">
          <Text size="sm" fw={500}>Extraction backend</Text>
          <Select
            disabled={!settings.chrome_devtools_mcp_enabled}
            value={settings.web_extraction_backend}
            onChange={(value) => {
              if (value) {
                void updateSetting(
                  "web_extraction_backend",
                  value as Settings["web_extraction_backend"],
                );
              }
            }}
            data={WEB_EXTRACTION_BACKENDS.map((b) => ({
              value: b,
              label: b === "tauri-webview" ? "Tauri webview" : "Chrome MCP",
            }))}
          />
          <Text size="xs" c="dimmed">
            {settings.chrome_devtools_mcp_enabled
              ? "Chrome MCP uses your local Chrome browser to render and extract pages. Tauri webview is the built-in renderer."
              : "Enable Chrome DevTools MCP above to unlock Chrome MCP as an extraction backend."}
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}

export function SettingsUpdateSection() {
  const { state, checkForUpdates, installUpdate, retryUpdate, dismissUpdate } = useAppUpdate({ manual: true });
  const [hasChecked, setHasChecked] = useState(false);

  function handleCheck() {
    setHasChecked(true);
    checkForUpdates();
  }

  const isBusy = state.status === "checking"
    || state.status === "downloading"
    || state.status === "installing"
    || state.status === "restarting";

  const showRetry = state.status === "check-error" || state.status === "error";
  const showInstall = state.status === "available";

  let statusText: React.ReactNode = null;
  let detailText: React.ReactNode = null;
  let buttonLabel = "Check for Updates";
  let buttonAction = handleCheck;
  let buttonVariant: "filled" | "outline" | "light" = "light";
  let buttonColor: string | undefined;

  if (state.status === "checking") {
    statusText = "Checking for updates...";
    buttonLabel = "Checking";
  } else if (state.status === "check-error") {
    statusText = <Text component="span" size="xs" c="red">Update check failed: {state.error}</Text>;
    buttonLabel = "Retry";
    buttonVariant = "outline";
    buttonColor = "red";
  } else if (showInstall) {
    statusText = (
      <Text size="xs">
        Version <Text component="span" fw={600}>{state.update.version}</Text> available
        (current: {state.update.currentVersion})
      </Text>
    );
    if (state.update.body) {
      detailText = (
        <Text size="xs" c="dimmed" lineClamp={2}>{state.update.body}</Text>
      );
    }
    buttonLabel = "Install Update";
    buttonVariant = "filled";
  } else if (state.status === "downloading") {
    statusText = state.progress !== null
      ? `Downloading update (${state.progress}%)`
      : "Downloading update...";
    buttonLabel = "Downloading";
  } else if (state.status === "installing") {
    statusText = "Installing update...";
    buttonLabel = "Installing";
  } else if (state.status === "restarting") {
    statusText = "Restarting to complete update...";
    buttonLabel = "Restarting";
  } else if (state.status === "error") {
    statusText = <Text component="span" size="xs" c="red">{state.error}</Text>;
    buttonLabel = "Retry";
    buttonAction = () => { retryUpdate(); };
    buttonVariant = "outline";
    buttonColor = "red";
  } else if (state.status === "hidden" && hasChecked) {
    statusText = "Up to date";
    buttonLabel = "Check Again";
  }

  if (showRetry) {
    buttonAction = () => { retryUpdate(); };
  }

  if (showInstall) {
    buttonAction = () => { void installUpdate(); };
  }

  const progressValue = (state.status === "downloading" || state.status === "installing") && state.progress !== null
    ? state.progress
    : undefined;

  return (
    <Paper withBorder p="sm">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500}>App Updates</Text>
          {statusText && (
            <Text size="xs" c="dimmed" mt={2}>{statusText}</Text>
          )}
          {detailText}
          {progressValue !== undefined && (
            <Progress value={progressValue} size="xs" mt="xs" />
          )}
        </Box>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="xs"
            variant={buttonVariant}
            color={buttonColor}
            loading={isBusy}
            onClick={buttonAction}
            leftSection={isBusy ? <Loader2 size={12} /> : showRetry ? <RefreshCw size={12} /> : undefined}
          >
            {buttonLabel}
          </Button>
          {(state.status === "available" || state.status === "error" || state.status === "check-error") && (
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              onClick={dismissUpdate}
            >
              Dismiss
            </Button>
          )}
        </Group>
      </Group>
    </Paper>
  );
}

function ProviderFields({
  definition,
  settings,
  onCommit,
  fieldIdPrefix,
}: {
  definition: ChatProviderSettingsDefinition;
  settings: Settings;
  onCommit: (key: keyof Settings, value: string) => Promise<void>;
  fieldIdPrefix: string;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of definition.fields) {
      initial[field.key] = String(settings[field.key] ?? "");
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "error" | null>(null);
  const [testError, setTestError] = useState("");

  const hasChanges = definition.fields.some(
    (field) => drafts[field.key] !== String(settings[field.key] ?? ""),
  );

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      for (const field of definition.fields) {
        const currentValue = String(settings[field.key] ?? "");
        if (drafts[field.key] !== currentValue) {
          await onCommit(field.key, drafts[field.key]);
        }
      }
    } catch (err) {
      console.error("[settings] Failed to save provider fields:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setTestError("");
    try {
      const apiKey = drafts[definition.apiKeyKey] ?? "";
      const model = drafts[definition.modelKey] ?? "";
      const baseURL = definition.baseURLKey
        ? drafts[definition.baseURLKey] ?? ""
        : undefined;
      const languageModel = createChatLanguageModel({
        provider: definition.provider,
        apiKey,
        model,
        baseURL,
      });
      await generateText({
        model: languageModel,
        messages: [{ role: "user", content: "say ok" }],
      });
      setTestResult("ok");
    } catch (err) {
      setTestResult("error");
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Paper withBorder p="sm">
      <Text size="sm" fw={500}>
        {getChatProviderLabel(definition.provider)}
      </Text>
      <Stack gap="xs">
        {definition.fields.map((field) => (
          <TextInput
            key={`${definition.provider}-${field.key}`}
            id={`${fieldIdPrefix}-${definition.provider}-${field.key}`}
            type={field.type}
            label={field.label}
            placeholder={field.placeholder}
            value={drafts[field.key] ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setDrafts((prev) => ({ ...prev, [field.key]: value }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSave();
              }
            }}
          />
        ))}
        <Group justify="flex-end" gap="xs">
          {testResult === "ok" && (
            <Text size="xs" c="green">OK</Text>
          )}
          {testResult === "error" && (
            <Text size="xs" c="red" title={testError} style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {testError}
            </Text>
          )}
          <Button
            size="xs"
            variant="light"
            color={testResult === "error" ? "red" : testResult === "ok" ? "green" : "blue"}
            loading={testing}
            disabled={saving}
            onClick={() => void handleTest()}
          >
            Test
          </Button>
          <Button
            size="xs"
            loading={saving}
            disabled={!hasChanges}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function SettingInput({
  field,
  inputId,
  value,
  onCommit,
}: {
  field: SettingsFieldDefinition;
  inputId: string;
  value: string;
  onCommit: (key: keyof Settings, value: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;

    event.preventDefault();
    void onCommit(field.key, draft);
  }

  return (
    <TextInput
      id={inputId}
      type={field.type}
      label={field.label}
      placeholder={field.placeholder}
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        void onCommit(field.key, draft);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
