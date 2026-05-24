import { describe, expect, it } from "vitest";
import { createChatModelId } from "@/lib/chat-providers";
import {
  getChatModelOptions,
  getConfiguredChatProviderDefinitions,
  getDefaultChatModelId,
  getInitialProviderSelection,
} from "@/lib/chat-provider-settings";
import { settingsDefaults, type Settings } from "@/lib/settings-store";

describe("chat provider settings", () => {
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
});
