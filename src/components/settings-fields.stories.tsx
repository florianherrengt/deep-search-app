import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mantine/core";
import { SettingsFields } from "./settings-fields";
import { settingsDefaults, type Settings } from "@/lib/settings-store";

const updateSetting: ComponentProps<typeof SettingsFields>["updateSetting"] =
  async () => undefined;

const configuredSettings: Settings = {
  ...settingsDefaults,
  chat_provider: "anthropic",
  openrouter_api_key: "sk-or-storybook",
  anthropic_api_key: "sk-ant-storybook",
  zhipu_api_key: "zhipu-storybook",
  zhipu_base_url: "https://api.z.ai/api/paas/v4",
  brave_api_key: "BSA-storybook",
  exa_api_key: "exa-storybook",
  serper_api_key: "serper-storybook",
  tavily_api_key: "tvly-storybook",
  embedding_api_key: "embedding-storybook",
  reranker_api_key: "reranker-storybook",
  currency: "EUR",
  chrome_devtools_mcp_enabled: true,
};

const meta = {
  title: "Settings/SettingsFields",
  component: SettingsFields,
  args: {
    settings: settingsDefaults,
    updateSetting,
  },
  decorators: [
    (Story) => (
      <Box maw={560} mx="auto" p="md">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof SettingsFields>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyProviders: Story = {};

export const ConfiguredProviders: Story = {
  args: {
    settings: configuredSettings,
  },
};

export const SearchOnly: Story = {
  args: {
    settings: {
      ...settingsDefaults,
      searxng_url: "http://localhost:8080",
      brave_api_key: "BSA-storybook",
      currency: "GBP",
    },
  },
};

export const LongModelNames: Story = {
  args: {
    settings: {
      ...configuredSettings,
      default_model: "vendor/an-extremely-long-openrouter-model-name-for-layout-testing",
      anthropic_model: "claude-sonnet-4-5-with-a-long-deployment-alias",
      zhipu_model: "glm-4.7-flash-storybook-preview-variant",
    },
  },
};
