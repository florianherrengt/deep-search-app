import { z } from "zod";
import {
  CHAT_PROVIDER_DEFAULT_MODELS,
  DEFAULT_CHAT_PROVIDER,
  chatProviderSchema,
} from "@/lib/chat-providers";
import { createStore } from "./store";

export const CURRENCIES = [
  "AED",
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SAR",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "USD",
  "ZAR",
] as const;

export type Currency = (typeof CURRENCIES)[number];

const currencySchema = z.enum(CURRENCIES);

export const CHROME_MCP_CONNECTION_MODES = ["auto", "browser-url"] as const;
export const chromeMcpConnectionModeSchema = z.enum(CHROME_MCP_CONNECTION_MODES);
export type ChromeMcpConnectionMode = z.infer<typeof chromeMcpConnectionModeSchema>;

export const EMBEDDING_DEFAULTS = {
  base_url: "https://openrouter.ai/api/v1",
  model: "qwen/qwen3-embedding-4b",
  dimensions: 1024,
  query_prefix: "Represent this sentence for searching relevant passages: ",
} as const;

export const RERANKER_DEFAULTS = {
  base_url: "https://openrouter.ai/api/v1",
  model: "cohere/rerank-4-pro",
} as const;

export const settingsSchema = z.object({
  chat_provider: chatProviderSchema,
  openrouter_api_key: z.string(),
  anthropic_api_key: z.string(),
  deepseek_api_key: z.string(),
  zhipu_api_key: z.string(),
  zhipu_base_url: z.string(),
  opencode_zen_api_key: z.string(),
  local_api_key: z.string(),
  local_base_url: z.string(),
  local_model: z.string(),
  searxng_url: z.string(),
  brave_api_key: z.string(),
  exa_api_key: z.string(),
  serper_api_key: z.string(),
  tavily_api_key: z.string(),
  default_model: z.string(),
  anthropic_model: z.string(),
  deepseek_model: z.string(),
  zhipu_model: z.string(),
  opencode_zen_model: z.string(),
  currency: currencySchema,
  chrome_devtools_mcp_enabled: z.boolean(),
  chrome_devtools_mcp_connection_mode: chromeMcpConnectionModeSchema,
  chrome_devtools_mcp_browser_url: z.string(),
  embedding_api_key: z.string(),
  embedding_base_url: z.string(),
  embedding_model: z.string(),
  embedding_dimensions: z.number().int().positive(),
  embedding_query_prefix: z.string(),
  reranker_api_key: z.string(),
  reranker_base_url: z.string(),
  reranker_model: z.string(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const settingsDefaults: Settings = {
  chat_provider: DEFAULT_CHAT_PROVIDER,
  openrouter_api_key: "",
  anthropic_api_key: "",
  deepseek_api_key: "",
  zhipu_api_key: "",
  zhipu_base_url: "",
  opencode_zen_api_key: "",
  local_api_key: "",
  local_base_url: "",
  local_model: CHAT_PROVIDER_DEFAULT_MODELS.local,
  searxng_url: "",
  brave_api_key: "",
  exa_api_key: "",
  serper_api_key: "",
  tavily_api_key: "",
  default_model: CHAT_PROVIDER_DEFAULT_MODELS.openrouter,
  anthropic_model: CHAT_PROVIDER_DEFAULT_MODELS.anthropic,
  deepseek_model: CHAT_PROVIDER_DEFAULT_MODELS.deepseek,
  zhipu_model: CHAT_PROVIDER_DEFAULT_MODELS.zhipu,
  opencode_zen_model: CHAT_PROVIDER_DEFAULT_MODELS["opencode-zen"],
  currency: "USD",
  chrome_devtools_mcp_enabled: false,
  chrome_devtools_mcp_connection_mode: "auto",
  chrome_devtools_mcp_browser_url: "",
  embedding_api_key: "",
  embedding_base_url: EMBEDDING_DEFAULTS.base_url,
  embedding_model: EMBEDDING_DEFAULTS.model,
  embedding_dimensions: EMBEDDING_DEFAULTS.dimensions,
  embedding_query_prefix: EMBEDDING_DEFAULTS.query_prefix,
  reranker_api_key: "",
  reranker_base_url: RERANKER_DEFAULTS.base_url,
  reranker_model: RERANKER_DEFAULTS.model,
};

export const settingsStore = createStore(
  "settings.json",
  settingsSchema,
  settingsDefaults,
);

export function resolveEmbeddingConfig(settings: Settings) {
  return {
    api_key:
      settings.embedding_api_key
      || settings.openrouter_api_key,
    base_url: settings.embedding_base_url || EMBEDDING_DEFAULTS.base_url,
    model: settings.embedding_model || EMBEDDING_DEFAULTS.model,
    dimensions: settings.embedding_dimensions ?? EMBEDDING_DEFAULTS.dimensions,
    query_prefix: settings.embedding_query_prefix || EMBEDDING_DEFAULTS.query_prefix,
  };
}

export function resolveRerankerConfig(settings: Settings) {
  return {
    api_key:
      settings.reranker_api_key
      || settings.embedding_api_key
      || settings.openrouter_api_key,
    base_url: settings.reranker_base_url || RERANKER_DEFAULTS.base_url,
    model: settings.reranker_model || RERANKER_DEFAULTS.model,
  };
}
