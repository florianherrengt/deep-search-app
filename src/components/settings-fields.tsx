import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from "@/components/assistant-ui/select";
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
import { cn } from "@/lib/utils";
import { CURRENCIES } from "@/lib/settings-store";
import type { Settings } from "@/hooks/use-settings";

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
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor={`${fieldIdPrefix}-provider`}>Provider</Label>
          <SelectRoot
            value={selectedProvider}
            onValueChange={(value) => setSelectedProvider(value as ChatProvider)}
          >
            <SelectTrigger
              id={`${fieldIdPrefix}-provider`}
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_PROVIDER_SETTINGS.map((definition) => (
                <SelectItem
                  key={definition.provider}
                  value={definition.provider}
                >
                  {getChatProviderLabel(definition.provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">
            {getChatProviderLabel(selectedDefinition.provider)}
          </p>
          {selectedDefinition.fields.map((field) => (
            <SettingInput
              key={`${selectedDefinition.provider}-${field.key}`}
              field={field}
              inputId={`${fieldIdPrefix}-${selectedDefinition.provider}-${field.key}`}
              value={String(settings[field.key] ?? "")}
              onCommit={handleCommit}
            />
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">Ready to Use</p>
          <span className="text-xs text-muted-foreground">
            {readyProviders.length}
          </span>
        </div>

        {readyProviders.length > 0 ? (
          <div className="overflow-hidden rounded-md border">
            {readyProviders.map((definition, index) => {
              const providerLabel = getChatProviderLabel(definition.provider);

              return (
                <div
                  key={definition.provider}
                  className={cn(
                    "flex items-center justify-between gap-3 px-3 py-2",
                    index > 0 && "border-t",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {providerLabel}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {getProviderModel(settings, definition)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${providerLabel}`}
                    title={`Remove ${providerLabel}`}
                    onClick={() => {
                      void handleRemoveProvider(definition);
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
            No providers configured.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <p className="text-sm font-medium">Search Services</p>
        {SERVICE_FIELDS.map((field) => (
          <SettingInput
            key={field.key}
            field={field}
            inputId={`${fieldIdPrefix}-${field.key}`}
            value={String(settings[field.key] ?? "")}
            onCommit={handleCommit}
          />
        ))}
      </section>

      <section className="space-y-2">
        <Label htmlFor={`${fieldIdPrefix}-currency`}>Currency</Label>
        <SelectRoot
          value={settings.currency}
          onValueChange={(value) => {
            void updateSetting("currency", value as Settings["currency"]);
          }}
        >
          <SelectTrigger
            id={`${fieldIdPrefix}-currency`}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
      </section>

      <section className="space-y-2 rounded-md border p-3">
        <label
          htmlFor={`${fieldIdPrefix}-chrome-devtools-mcp`}
          className="flex items-start gap-3"
        >
          <input
            id={`${fieldIdPrefix}-chrome-devtools-mcp`}
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-input"
            checked={settings.chrome_devtools_mcp_enabled}
            onChange={(event) => {
              void updateSetting(
                "chrome_devtools_mcp_enabled",
                event.currentTarget.checked,
              );
            }}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">
              Chrome DevTools MCP
            </span>
            <span className="block text-xs text-muted-foreground">
              Allow last-resort control of a local Chrome session when normal extraction is not enough.
            </span>
          </span>
        </label>
      </section>
    </div>
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
    <div className="space-y-2">
      <Label htmlFor={inputId}>{field.label}</Label>
      <Input
        id={inputId}
        type={field.type}
        placeholder={field.placeholder}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          void onCommit(field.key, draft);
        }}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
