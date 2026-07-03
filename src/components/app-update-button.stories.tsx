import type { Meta, StoryObj } from "@storybook/react-vite";
import { Box, Group, Text } from "@mantine/core";
import { withAppUpdateState } from "@/lib/storybook";
import { AppUpdateButton } from "./app-update-button";

const update = {
  version: "0.2.0",
  currentVersion: "0.1.0",
  date: "2026-06-06",
  body: "Adds Storybook visual review support and fixes several research sidebar states.",
};

const meta = {
  title: "Chrome/AppUpdateButton",
  component: AppUpdateButton,
  decorators: [
    (Story) => (
      <Box p="md">
        <Story />
      </Box>
    ),
  ],
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof AppUpdateButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {
  decorators: [withAppUpdateState({ status: "available", update })],
};

export const ToolbarContext: Story = {
  decorators: [withAppUpdateState({ status: "available", update })],
  render: () => (
    <Group
      h={40}
      px={8}
      justify="flex-end"
      style={{
        width: 360,
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <AppUpdateButton />
    </Group>
  ),
};

export const Downloading: Story = {
  decorators: [withAppUpdateState({ status: "downloading", update, progress: 42 })],
};

export const Installing: Story = {
  decorators: [withAppUpdateState({ status: "installing", update, progress: 100 })],
};

export const Error: Story = {
  decorators: [
    withAppUpdateState({
      status: "error",
      update,
      error: "Signature verification failed. Try downloading the update again.",
    }),
  ],
};

export const CheckError: Story = {
  decorators: [
    withAppUpdateState({
      status: "check-error",
      error: "Could not check for updates: Failed to fetch update info",
    }),
  ],
};

export const Hidden: Story = {
  decorators: [withAppUpdateState({ status: "hidden" })],
  render: () => (
    <Box p="sm" style={{ border: "1px dashed var(--mantine-color-gray-4)", borderRadius: 8 }}>
      <AppUpdateButton />
      <Text size="sm" c="dimmed">
        Hidden and checking states render no update control.
      </Text>
    </Box>
  ),
};
