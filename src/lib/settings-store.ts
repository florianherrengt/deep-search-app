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

export const currencySchema = z.enum(CURRENCIES);

export const settingsSchema = z.object({
  chat_provider: chatProviderSchema,
  openrouter_api_key: z.string(),
  anthropic_api_key: z.string(),
  zhipu_api_key: z.string(),
  zhipu_base_url: z.string(),
  searxng_url: z.string(),
  brave_api_key: z.string(),
  exa_api_key: z.string(),
  serper_api_key: z.string(),
  tavily_api_key: z.string(),
  default_model: z.string(),
  anthropic_model: z.string(),
  zhipu_model: z.string(),
  currency: currencySchema,
});

export type Settings = z.infer<typeof settingsSchema>;

export const settingsDefaults: Settings = {
  chat_provider: DEFAULT_CHAT_PROVIDER,
  openrouter_api_key: "",
  anthropic_api_key: "",
  zhipu_api_key: "",
  zhipu_base_url: "",
  searxng_url: "",
  brave_api_key: "",
  exa_api_key: "",
  serper_api_key: "",
  tavily_api_key: "",
  default_model: CHAT_PROVIDER_DEFAULT_MODELS.openrouter,
  anthropic_model: CHAT_PROVIDER_DEFAULT_MODELS.anthropic,
  zhipu_model: CHAT_PROVIDER_DEFAULT_MODELS.zhipu,
  currency: "USD",
};

export const settingsStore = createStore(
  "settings.json",
  settingsSchema,
  settingsDefaults,
);
