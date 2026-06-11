import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import { Button, TextInput, Select, Box, Stack, Text, Group, Checkbox, Paper, ActionIcon } from "@mantine/core";
import {
  CHAT_PROVIDER_SETTINGS,
  DEFAULT_CHAT_PROVIDER,
  getConfiguredChatProviderDefinitions,
  getInitialProviderSelection,
  getProviderModel,
  getProviderSettingsDefinition,
  type ChatProviderSettingsDefinition,
  type SettingsFieldDefinition,
} from "@/lib/chat-provider-settings";
import { getChatProviderLabel, type ChatProvider } from "@/lib/chat-providers";
import {
  CURRENCIES,
  EMBEDDING_DEFAULTS,
  RERANKER_DEFAULTS,
  resolveEmbeddingConfig,
} from "@/lib/settings-store";
import { backfillIndex } from "@/lib/research-search";
import type { Settings } from "@/hooks/use-settings";

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
  const readyProviders = getConfiguredChatProviderDefinitions(settings);

  async function handleCommit(key: keyof Settings, value: string) {
    if (value !== settings[key]) {
      await updateSetting(key, value as Settings[typeof key]);
    }
  }

  async function handleRemoveProvider(
    definition: ChatProviderSettingsDefinition,
  ) {
    const nextReadyProvider =
      readyProviders.find(
        (candidate) => candidate.provider !== definition.provider,
      )?.provider ?? DEFAULT_CHAT_PROVIDER;

    if (
      settings.chat_provider === definition.provider &&
      nextReadyProvider !== settings.chat_provider
    ) {
      await updateSetting("chat_provider", nextReadyProvider);
    }

    for (const key of definition.clearOnRemove) {
      if (settings[key]) {
        await updateSetting(key, "");
      }
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
          data={CHAT_PROVIDER_SETTINGS.map((definition) => ({
            value: definition.provider,
            label: getChatProviderLabel(definition.provider),
          }))}
        />

        <Paper withBorder p="sm">
          <Text size="sm" fw={500}>
            {getChatProviderLabel(selectedDefinition.provider)}
          </Text>
          {selectedDefinition.fields.map((field) => (
            <SettingInput
              key={`${selectedDefinition.provider}-${field.key}`}
              field={field}
              inputId={`${fieldIdPrefix}-${selectedDefinition.provider}-${field.key}`}
              value={String(settings[field.key] ?? "")}
              onCommit={handleCommit}
            />
          ))}
        </Paper>
      </Stack>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="sm" fw={500}>Ready to Use</Text>
          <Text size="xs" c="dimmed">{readyProviders.length}</Text>
        </Group>

        {readyProviders.length > 0 ? (
          <Paper withBorder>
            {readyProviders.map((definition, index) => {
              const providerLabel = getChatProviderLabel(definition.provider);

              return (
                <Group
                  key={definition.provider}
                  justify="space-between"
                  px="sm"
                  py="xs"
                  style={index > 0 ? { borderTop: "1px solid var(--mantine-color-default-border)" } : undefined}
                >
                  <Box style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>{providerLabel}</Text>
                    <Text size="xs" c="dimmed" truncate>
                      {getProviderModel(settings, definition)}
                    </Text>
                  </Box>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    aria-label={`Remove ${providerLabel}`}
                    title={`Remove ${providerLabel}`}
                    onClick={() => void handleRemoveProvider(definition)}
                  >
                    <XIcon size={14} />
                  </ActionIcon>
                </Group>
              );
            })}
          </Paper>
        ) : (
          <Paper withBorder p="sm" style={{ borderStyle: "dashed" }}>
            <Text size="sm" c="dimmed">No providers configured.</Text>
          </Paper>
        )}
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
        onChange={(value) => {
          void updateSetting("currency", value as Settings["currency"]);
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
      </Paper>
    </Stack>
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
