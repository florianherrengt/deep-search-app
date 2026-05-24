import { createAnthropic } from "@ai-sdk/anthropic";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { createZhipu } from "zhipu-ai-provider";

export const chatProviderSchema = z.enum(["openrouter", "anthropic", "zhipu"]);

export type ChatProvider = z.infer<typeof chatProviderSchema>;

export interface ChatModelConfig {
  provider: ChatProvider;
  apiKey: string;
  model: string;
  baseURL?: string;
}

export interface ConfiguredChatModelOption extends ChatModelConfig {
  id: string;
  name: string;
  description?: string;
  disabled?: boolean;
}

export const DEFAULT_CHAT_PROVIDER: ChatProvider = "openrouter";

export const CHAT_PROVIDER_LABELS: Record<ChatProvider, string> = {
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  zhipu: "Zhipu",
};

export const CHAT_PROVIDER_DEFAULT_MODELS: Record<ChatProvider, string> = {
  openrouter: "openrouter/free",
  anthropic: "claude-sonnet-4-5",
  zhipu: "glm-4.7-flash",
};

export function getChatProviderLabel(provider: ChatProvider): string {
  return CHAT_PROVIDER_LABELS[provider];
}

export function createChatModelId(provider: ChatProvider, model: string) {
  return `${provider}:${encodeURIComponent(model)}`;
}

export function createChatLanguageModel({
  provider,
  apiKey,
  model,
  baseURL,
}: ChatModelConfig): LanguageModel {
  const trimmedApiKey = apiKey.trim();
  const modelId = model.trim() || CHAT_PROVIDER_DEFAULT_MODELS[provider];
  const trimmedBaseURL = baseURL?.trim();

  if (!trimmedApiKey) {
    throw new Error(`${getChatProviderLabel(provider)} API key is missing.`);
  }

  switch (provider) {
    case "anthropic":
      return createAnthropic({
        apiKey: trimmedApiKey,
        fetch: providerFetch,
      })(modelId);
    case "openrouter":
      return createOpenRouter({
        apiKey: trimmedApiKey,
        fetch: providerFetch,
      })(modelId);
    case "zhipu":
      return createZhipu({
        apiKey: trimmedApiKey,
        baseURL: trimmedBaseURL || undefined,
        fetch: providerFetch,
      })(modelId);
  }
}

const providerFetch: typeof fetch = (input, init) => {
  if (isTauriRuntime()) {
    return tauriFetch(input, init);
  }

  return globalThis.fetch(input, init);
};

function isTauriRuntime() {
  if (typeof window === "undefined") return false;

  return Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}
