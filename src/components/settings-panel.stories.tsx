import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsProvider } from "@/hooks/use-settings";
import { setStorybookTauriStores } from "@/lib/storybook";
import { settingsDefaults } from "@/lib/settings-store";
import { SettingsPanel } from "./settings-panel";

function SettingsPanelStory({ configured }: { configured: boolean }) {
  setStorybookTauriStores({
    "settings.json": configured
      ? {
          ...settingsDefaults,
          chat_provider: "openrouter",
          openrouter_api_key: "sk-or-storybook",
          brave_api_key: "BSA-storybook",
          currency: "EUR",
        }
      : settingsDefaults,
  });

  return (
    <SettingsProvider>
      <SettingsPanel />
    </SettingsProvider>
  );
}

const meta = {
  title: "Settings/SettingsPanel",
  component: SettingsPanel,
  args: {
    configured: true,
  },
  render: (args) => <SettingsPanelStory configured={args.configured} />,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsPanelStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Configured: Story = {};

export const Empty: Story = {
  args: {
    configured: false,
  },
};
