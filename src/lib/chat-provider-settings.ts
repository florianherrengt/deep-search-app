import {
  CHAT_PROVIDER_DEFAULT_MODELS,
  DEFAULT_CHAT_PROVIDER,
  createChatModelId,
  getKnownChatModelContextWindowTokens,
  getChatProviderLabel,
  type ChatProvider,
  type ConfiguredChatModelOption,
} from "@/lib/chat-providers";
import type { Settings } from "@/lib/settings-store";

export interface SettingsFieldDefinition {
  key: keyof Settings;
  label: string;
  type: "text" | "password";
  placeholder: string;
}

export interface ChatProviderSettingsDefinition {
  provider: ChatProvider;
  apiKeyKey: keyof Settings;
  modelKey: keyof Settings;
  baseURLKey?: keyof Settings;
  configuredKey?: keyof Settings;
  fields: readonly SettingsFieldDefinition[];
  clearOnRemove: readonly (keyof Settings)[];
}

export const CHAT_PROVIDER_SETTINGS = [
  {
    provider: "openrouter",
    apiKeyKey: "openrouter_api_key",
    modelKey: "default_model",
    fields: [
      {
        key: "default_model",
        label: "Model",
        type: "text",
        placeholder: CHAT_PROVIDER_DEFAULT_MODELS.openrouter,
      },
      {
        key: "openrouter_api_key",
        label: "API Key",
        type: "password",
        placeholder: "sk-or-...",
      },
    ],
    clearOnRemove: ["openrouter_api_key"],
  },
  {
    provider: "anthropic",
    apiKeyKey: "anthropic_api_key",
    modelKey: "anthropic_model",
    fields: [
      {
        key: "anthropic_model",
        label: "Model",
        type: "text",
        placeholder: CHAT_PROVIDER_DEFAULT_MODELS.anthropic,
      },
      {
        key: "anthropic_api_key",
        label: "API Key",
        type: "password",
        placeholder: "sk-ant-...",
      },
    ],
    clearOnRemove: ["anthropic_api_key"],
  },
  {
    provider: "zhipu",
    apiKeyKey: "zhipu_api_key",
    modelKey: "zhipu_model",
    baseURLKey: "zhipu_base_url",
    fields: [
      {
        key: "zhipu_model",
        label: "Model",
        type: "text",
        placeholder: CHAT_PROVIDER_DEFAULT_MODELS.zhipu,
      },
      {
        key: "zhipu_api_key",
        label: "API Key",
        type: "password",
        placeholder: "ZHIPU_API_KEY",
      },
      {
        key: "zhipu_base_url",
        label: "Base URL",
        type: "text",
        placeholder: "https://api.z.ai/api/paas/v4",
      },
    ],
    clearOnRemove: ["zhipu_api_key", "zhipu_base_url"],
  },
  {
    provider: "local",
    apiKeyKey: "local_api_key",
    modelKey: "local_model",
    baseURLKey: "local_base_url",
    configuredKey: "local_base_url",
    fields: [
      {
        key: "local_model",
        label: "Model",
        type: "text",
        placeholder: "llama3",
      },
      {
        key: "local_base_url",
        label: "Base URL",
        type: "text",
        placeholder: "http://localhost:11434/v1",
      },
      {
        key: "local_api_key",
        label: "API Key",
        type: "password",
        placeholder: "Optional",
      },
    ],
    clearOnRemove: ["local_api_key", "local_base_url", "local_model"],
  },
] as const satisfies readonly ChatProviderSettingsDefinition[];

export function getProviderSettingsDefinition(provider: ChatProvider) {
  const definition = CHAT_PROVIDER_SETTINGS.find(
    (candidate) => candidate.provider === provider,
  );

  if (!definition) {
    throw new Error(`Unknown chat provider: ${provider}`);
  }

  return definition;
}

export function getInitialProviderSelection(settings: Settings): ChatProvider {
  const unconfigured = CHAT_PROVIDER_SETTINGS.find(
    (definition) => !isChatProviderConfigured(settings, definition),
  );

  return unconfigured?.provider ?? CHAT_PROVIDER_SETTINGS[0].provider;
}

export function isChatProviderConfigured(
  settings: Settings,
  definition: ChatProvider | ChatProviderSettingsDefinition,
) {
  const resolvedDefinition: ChatProviderSettingsDefinition =
    typeof definition === "string"
      ? getProviderSettingsDefinition(definition)
      : definition as ChatProviderSettingsDefinition;

  const checkKey = resolvedDefinition.configuredKey ?? resolvedDefinition.apiKeyKey;
  return getSettingValue(settings, checkKey).trim().length > 0;
}

export function getConfiguredChatProviderDefinitions(settings: Settings) {
  return CHAT_PROVIDER_SETTINGS.filter((definition) =>
    isChatProviderConfigured(settings, definition),
  );
}

export function getProviderModel(
  settings: Settings,
  definition: ChatProvider | ChatProviderSettingsDefinition,
) {
  const resolvedDefinition =
    typeof definition === "string"
      ? getProviderSettingsDefinition(definition)
      : definition;

  return (
    getSettingValue(settings, resolvedDefinition.modelKey).trim() ||
    CHAT_PROVIDER_DEFAULT_MODELS[resolvedDefinition.provider]
  );
}

export function getChatModelOptions(
  settings: Settings,
): ConfiguredChatModelOption[] {
  return CHAT_PROVIDER_SETTINGS.map((definition) =>
    getChatModelOption(settings, definition),
  );
}

export function getDefaultChatModelId(
  settings: Settings,
  options: ConfiguredChatModelOption[],
): string {
  const preferred =
    options.find(
      (option) => option.provider === settings.chat_provider && !option.disabled,
    ) ?? options.find((option) => !option.disabled);

  return preferred?.id ?? options[0]?.id ?? "";
}

function getChatModelOption(
  settings: Settings,
  definition: ChatProviderSettingsDefinition,
): ConfiguredChatModelOption {
  const provider = definition.provider;
  const providerLabel = getChatProviderLabel(provider);
  const apiKey = getSettingValue(settings, definition.apiKeyKey).trim();
  const model = getProviderModel(settings, definition);
  const baseURL = definition.baseURLKey
    ? getSettingValue(settings, definition.baseURLKey).trim()
    : "";
  const contextWindowTokens = getKnownChatModelContextWindowTokens({
    provider,
    model,
  });
  const disabled = !isChatProviderConfigured(settings, definition);

  return {
    id: createChatModelId(provider, model),
    provider,
    apiKey,
    model,
    baseURL: baseURL || undefined,
    name: `${providerLabel}: ${model || "(any)"}`,
    description: disabled ? `Add ${providerLabel} in Settings` : providerLabel,
    ...(contextWindowTokens ? { contextWindowTokens } : {}),
    disabled,
  };
}

function getSettingValue(settings: Settings, key: keyof Settings) {
  return String(settings[key] ?? "");
}

export { DEFAULT_CHAT_PROVIDER };
