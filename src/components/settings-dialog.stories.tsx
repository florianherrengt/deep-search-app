import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsProvider } from "@/hooks/use-settings";
import { setStorybookTauriStores } from "@/lib/storybook";
import { settingsDefaults } from "@/lib/settings-store";
import { SettingsDialog } from "./settings-dialog";

function SettingsDialogStory(args: ComponentProps<typeof SettingsDialog>) {
  setStorybookTauriStores({
    "settings.json": {
      ...settingsDefaults,
      openrouter_api_key: "sk-or-storybook",
      currency: "USD",
    },
  });

  return (
    <SettingsProvider>
      <SettingsDialog {...args} />
    </SettingsProvider>
  );
}

const meta = {
  title: "Settings/SettingsDialog",
  component: SettingsDialog,
  args: {
    open: true,
    onOpenChange: () => undefined,
  },
  render: (args) => <SettingsDialogStory {...args} />,
} satisfies Meta<typeof SettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Closed: Story = {
  args: {
    open: false,
  },
};
