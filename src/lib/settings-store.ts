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

export const WEB_EXTRACTION_BACKENDS = ["tauri-webview", "chrome-mcp"] as const;
export const webExtractionBackendSchema = z.enum(WEB_EXTRACTION_BACKENDS);
export type WebExtractionBackend = z.infer<typeof webExtractionBackendSchema>;

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
  scrape_do_api_key: z.string(),
  default_model: z.string(),
  anthropic_model: z.string(),
  deepseek_model: z.string(),
  zhipu_model: z.string(),
  opencode_zen_model: z.string(),
  currency: currencySchema,
  chrome_devtools_mcp_enabled: z.boolean(),
  chrome_devtools_mcp_connection_mode: chromeMcpConnectionModeSchema,
  chrome_devtools_mcp_browser_url: z.string(),
  chrome_devtools_mcp_node_path: z.string(),
  web_extraction_backend: webExtractionBackendSchema,
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
  scrape_do_api_key: "",
  default_model: CHAT_PROVIDER_DEFAULT_MODELS.openrouter,
  anthropic_model: CHAT_PROVIDER_DEFAULT_MODELS.anthropic,
  deepseek_model: CHAT_PROVIDER_DEFAULT_MODELS.deepseek,
  zhipu_model: CHAT_PROVIDER_DEFAULT_MODELS.zhipu,
  opencode_zen_model: CHAT_PROVIDER_DEFAULT_MODELS["opencode-zen"],
  currency: "USD",
  chrome_devtools_mcp_enabled: false,
  chrome_devtools_mcp_connection_mode: "auto",
  chrome_devtools_mcp_browser_url: "",
  chrome_devtools_mcp_node_path: "",
  web_extraction_backend: "tauri-webview",
};

export const settingsStore = createStore(
  "settings.json",
  settingsSchema,
  settingsDefaults,
);
