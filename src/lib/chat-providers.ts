import { createAnthropic } from "@ai-sdk/anthropic";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { createZhipu } from "zhipu-ai-provider";
import { validateUrl } from "@/lib/url-validation";

declare global {
  interface Window {
    __deepSearchProviderFetchMock?: typeof fetch;
  }
}

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
  contextWindowTokens?: number;
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

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const ALLOWED_ZHIPU_BASE_URL_ORIGINS = new Set([
  "https://open.bigmodel.cn",
  "https://api.z.ai",
]);

const openRouterContextWindowCache = new Map<string, Promise<number | undefined>>();

const openRouterModelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      context_length: z.number().optional().nullable(),
    }),
  ),
});

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
        baseURL: normalizeZhipuBaseURL(trimmedBaseURL),
        fetch: providerFetch,
      })(modelId);
  }
}

export function getKnownChatModelContextWindowTokens({
  provider,
  model,
}: Pick<ChatModelConfig, "provider" | "model">): number | undefined {
  const modelId = normalizeModelId(provider, model);

  if (provider === "anthropic" && modelId.startsWith("claude-")) {
    return 200_000;
  }

  return undefined;
}

export async function fetchChatModelContextWindowTokens(
  config: Pick<ChatModelConfig, "provider" | "model"> &
    Partial<Pick<ChatModelConfig, "apiKey">>,
  options: { abortSignal?: AbortSignal } = {},
): Promise<number | undefined> {
  const known = getKnownChatModelContextWindowTokens(config);
  if (known) return known;

  const modelId = normalizeModelId(config.provider, config.model);
  const cacheKey = `${config.provider}:${modelId}`;
  const cached = openRouterContextWindowCache.get(cacheKey);
  if (cached) return cached;

  const promise = fetchOpenRouterModelContextWindowTokens(
    modelId,
    config.provider === "openrouter" ? config.apiKey : undefined,
    options.abortSignal,
  )
    .catch(() => undefined)
    .then((tokens) => {
      if (tokens === undefined) {
        openRouterContextWindowCache.delete(cacheKey);
      }

      return tokens;
    });
  openRouterContextWindowCache.set(cacheKey, promise);

  return promise;
}

async function fetchOpenRouterModelContextWindowTokens(
  modelId: string,
  apiKey: string | undefined,
  abortSignal: AbortSignal | undefined,
): Promise<number | undefined> {
  const trimmedApiKey = apiKey?.trim();
  const response = await providerFetch(OPENROUTER_MODELS_URL, {
    ...(trimmedApiKey
      ? { headers: { Authorization: `Bearer ${trimmedApiKey}` } }
      : {}),
    signal: abortSignal,
  });
  if (!response.ok) {
    console.warn("[context-window] OpenRouter models fetch failed:", response.status);
    return undefined;
  }

  const parsed = openRouterModelsResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    console.warn("[context-window] OpenRouter models parse failed:", parsed.error.message);
    return undefined;
  }

  const baseName = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
  const model = parsed.data.data.find(
    (candidate) => candidate.id.toLowerCase() === modelId,
  ) ?? parsed.data.data.find(
    (candidate) => candidate.id.toLowerCase().endsWith("/" + baseName),
  );

  if (!model) {
    console.warn("[context-window] No OpenRouter match for:", modelId, "(baseName:", baseName, ")");
  }

  return normalizeContextWindowTokens(model?.context_length);
}

function normalizeModelId(provider: ChatProvider, model: string) {
  return (model.trim() || CHAT_PROVIDER_DEFAULT_MODELS[provider]).toLowerCase();
}

function normalizeContextWindowTokens(value: number | null | undefined) {
  if (!value || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

function normalizeZhipuBaseURL(baseURL: string | undefined): string | undefined {
  if (!baseURL) return undefined;

  const parsed = validateUrl(baseURL);
  if (!ALLOWED_ZHIPU_BASE_URL_ORIGINS.has(parsed.origin)) {
    throw new Error("Zhipu base URL must use the official BigModel or Z.ai API host.");
  }

  return parsed.toString().replace(/\/$/, "");
}

const providerFetch: typeof fetch = (input, init) => {
  const mock = getDevProviderFetchMock();
  if (mock) {
    return mock(input, init);
  }

  if (isTauriRuntime()) {
    return tauriFetch(input, init);
  }

  return globalThis.fetch(input, init);
};

function getDevProviderFetchMock(): typeof fetch | null {
  if (!import.meta.env.DEV || typeof window === "undefined") {
    return null;
  }

  return window.__deepSearchProviderFetchMock ?? null;
}

function isTauriRuntime() {
  if (typeof window === "undefined") return false;

  return Boolean(
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__,
  );
}
