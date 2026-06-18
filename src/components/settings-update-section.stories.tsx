import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box } from "@mantine/core";
import { SettingsUpdateSection } from "./settings-fields";
import { withAppUpdateState } from "@/lib/storybook";

const updateInfo = {
  version: "0.2.0",
  currentVersion: "0.1.0",
  date: "2026-06-06",
  body: "Adds Storybook visual review support and fixes several research sidebar states.",
};

const meta = {
  title: "Settings/SettingsUpdateSection",
  component: SettingsUpdateSection,
  decorators: [
    (Story) => (
      <Box maw={560} mx="auto" p="md">
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof SettingsUpdateSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Hidden: Story = {
  decorators: [withAppUpdateState({ status: "hidden" })],
};

export const Checking: Story = {
  decorators: [withAppUpdateState({ status: "checking" })],
};

export const Available: Story = {
  decorators: [withAppUpdateState({ status: "available", update: updateInfo })],
};

export const Downloading: Story = {
  decorators: [withAppUpdateState({ status: "downloading", update: updateInfo, progress: 42 })],
};

export const Installing: Story = {
  decorators: [withAppUpdateState({ status: "installing", update: updateInfo, progress: 100 })],
};

export const Error: Story = {
  decorators: [
    withAppUpdateState({
      status: "error",
      update: updateInfo,
      error: "Signature verification failed.",
    }),
  ],
};

export const CheckError: Story = {
  decorators: [
    withAppUpdateState({
      status: "check-error",
      error: "Failed to fetch update info",
    }),
  ],
};
