import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button, Center, Paper, Text } from "@mantine/core";
import { TabPanel } from "./tab-panel";

const noop = () => undefined;

function PanelPlaceholder({ label }: { label: string }) {
  return (
    <Center h="100%" p="xl">
      <Paper withBorder p="xl" maw={420}>
        <Text fw={600}>{label}</Text>
        <Text size="sm" c="dimmed" mt={4}>
          Placeholder content mirrors the full-height panels used by the app.
        </Text>
      </Paper>
    </Center>
  );
}

const browserTabs = [
  {
    id: "browser-1",
    title: "Storybook - Component review checklist",
    url: "https://storybook.js.org/docs",
  },
  {
    id: "browser-2",
    title: "A very long research source title that should truncate in the tab bar",
    url: "https://example.com/long-title",
  },
];

const meta = {
  title: "Layout/TabPanel",
  component: TabPanel,
  args: {
    activeTabId: "main",
    tabs: browserTabs,
    chatPanel: <PanelPlaceholder label="Chat" />,
    settingsPanel: <PanelPlaceholder label="Settings" />,
    promptsPanel: <PanelPlaceholder label="Prompt Templates" />,
    skillsPanel: <PanelPlaceholder label="Skills" />,
    toolsPanel: <PanelPlaceholder label="Tools" />,
    toolbarEnd: <Button size="compact-xs">Update available</Button>,
    onSwitchTab: noop,
    onCloseTab: noop,
  },
  argTypes: {
    activeTabId: {
      control: "select",
      options: ["main", "settings", "prompts", "skills", "tools", "browser-1", "browser-2"],
    },
  },
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TabPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChatActive: Story = {};

export const SettingsActive: Story = {
  args: {
    activeTabId: "settings",
  },
};

export const BrowserTabActive: Story = {
  args: {
    activeTabId: "browser-2",
  },
};

export const NoBrowserTabs: Story = {
  args: {
    tabs: [],
  },
};

export const ManyBrowserTabs: Story = {
  args: {
    tabs: Array.from({ length: 8 }, (_, index) => ({
      id: `browser-${index + 1}`,
      title: `Research source ${index + 1}: long page title for truncation testing`,
      url: `https://example.com/source-${index + 1}`,
    })),
    activeTabId: "browser-7",
  },
};
