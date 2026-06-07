import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createChatModelId,
  fetchChatModelContextWindowTokens,
  getKnownChatModelContextWindowTokens,
} from "@/lib/chat-providers";
import {
  CHAT_PROVIDER_SETTINGS,
  getChatModelOptions,
  getConfiguredChatProviderDefinitions,
  getDefaultChatModelId,
  getInitialProviderSelection,
} from "@/lib/chat-provider-settings";
import { formatContextWindowTokens } from "@/lib/context-window";
import { settingsDefaults, type Settings } from "@/lib/settings-store";

describe("chat provider settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives ready providers from configured API keys", () => {
    const settings: Settings = {
      ...settingsDefaults,
      openrouter_api_key: "sk-or-test",
      anthropic_api_key: "sk-ant-test",
    };

    expect(
      getConfiguredChatProviderDefinitions(settings).map(
        (definition) => definition.provider,
      ),
    ).toEqual(["openrouter", "anthropic"]);
  });

  it("builds model options and default selection from provider metadata", () => {
    const settings: Settings = {
      ...settingsDefaults,
      chat_provider: "zhipu",
      openrouter_api_key: "sk-or-test",
      anthropic_api_key: "sk-ant-test",
      anthropic_model: "claude-opus-4-1",
    };

    const options = getChatModelOptions(settings);

    expect(options).toMatchObject([
      {
        provider: "openrouter",
        disabled: false,
      },
      {
        provider: "anthropic",
        model: "claude-opus-4-1",
        disabled: false,
      },
      {
        provider: "zhipu",
        disabled: true,
      },
    ]);
    expect(getDefaultChatModelId(settings, options)).toBe(
      createChatModelId("openrouter", settingsDefaults.default_model),
    );
  });

  it("selects the first unconfigured provider for the settings form", () => {
    const settings: Settings = {
      ...settingsDefaults,
      openrouter_api_key: "sk-or-test",
    };

    expect(getInitialProviderSelection(settings)).toBe("anthropic");
  });

  it("adds known context window metadata to direct provider model options", () => {
    const settings: Settings = {
      ...settingsDefaults,
      anthropic_api_key: "sk-ant-test",
      zhipu_api_key: "zhipu-test",
    };

    const options = getChatModelOptions(settings);

    expect(options).toMatchObject([
      {},
      { provider: "anthropic", contextWindowTokens: 200_000 },
      { provider: "zhipu" },
    ]);
    expect(
      getKnownChatModelContextWindowTokens({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
    ).toBe(200_000);
    expect(
      getKnownChatModelContextWindowTokens({
        provider: "zhipu",
        model: "glm-4.7-flash",
      }),
    ).toBeUndefined();
  });

  it("formats compact context window values", () => {
    expect(formatContextWindowTokens(200_000)).toBe("200K context");
    expect(formatContextWindowTokens(1_500_000)).toBe("1.5M context");
    expect(formatContextWindowTokens(32_768)).toBe("32.8K context");
    expect(formatContextWindowTokens(undefined)).toBeUndefined();
  });

  it("keeps OpenRouter context metadata dynamic", () => {
    const settings: Settings = {
      ...settingsDefaults,
      openrouter_api_key: "sk-or-test",
      default_model: "anthropic/claude-sonnet-4.5",
    };

    const [option] = getChatModelOptions(settings);

    expect(option.contextWindowTokens).toBeUndefined();
    expect(
      getKnownChatModelContextWindowTokens({
        provider: "openrouter",
        model: "anthropic/claude-sonnet-4.5",
      }),
    ).toBeUndefined();
  });

  it("fetches OpenRouter context metadata from the models API", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "test/provider-model",
              context_length: 123_456,
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchChatModelContextWindowTokens({
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "test/provider-model",
      }),
    ).resolves.toBe(123_456);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-or-test" },
      }),
    );
  });

  it("uses configured model names for direct provider context metadata", () => {
    const settings: Settings = {
      ...settingsDefaults,
      anthropic_api_key: "sk-ant-test",
      anthropic_model: "claude-opus-4-1",
    };

    const options = getChatModelOptions(settings);

    expect(options[1]).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-1",
      contextWindowTokens: 200_000,
    });
  });

  it("keeps provider settings free of context window inputs", () => {
    const fieldKeys = CHAT_PROVIDER_SETTINGS.flatMap((definition) =>
      definition.fields.map((field) => field.key),
    );

    expect(fieldKeys).not.toContain("openrouter_context_window");
    expect(fieldKeys).not.toContain("anthropic_context_window");
    expect(fieldKeys).not.toContain("zhipu_context_window");
  });

  it("returns empty providers when no API keys are configured", () => {
    const settings: Settings = { ...settingsDefaults };
    expect(getConfiguredChatProviderDefinitions(settings)).toEqual([]);

    const options = getChatModelOptions(settings);
    expect(options.every((option) => option.disabled)).toBe(true);
  });

  it("treats whitespace-only API key as unconfigured", () => {
    const settings: Settings = {
      ...settingsDefaults,
      openrouter_api_key: "   ",
    };
    expect(getConfiguredChatProviderDefinitions(settings)).toEqual([]);
  });

  it("handles fetchChatModelContextWindowTokens HTTP error gracefully", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 500, statusText: "Internal Server Error" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchChatModelContextWindowTokens({
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "test/error-provider-model",
      }),
    ).resolves.toBeUndefined();
  });

  it("handles fetchChatModelContextWindowTokens network failure gracefully", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchChatModelContextWindowTokens({
        provider: "openrouter",
        apiKey: "sk-or-test",
        model: "test/network-failure-model",
      }),
    ).resolves.toBeUndefined();
  });
});
