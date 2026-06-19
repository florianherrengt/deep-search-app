import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { ResearchSidebar } from "./research-sidebar";

const noop = () => undefined;

const folders = [
  { name: "2026-06-06_storybook-integration", updatedAt: "2026-06-06T12:00:00Z" },
  { name: "2026-05-30_power-bank-flight-rules", updatedAt: "2026-05-30T08:45:00Z" },
  { name: "vendor-pricing-comparison-with-a-long-folder-name", updatedAt: null },
];

const chats = [
  {
    id: "chat-1",
    title: "Storybook package and addon research",
    createdAt: "2026-06-06T11:00:00Z",
    updatedAt: "2026-06-06T12:15:00Z",
    messageCount: 12,
  },
  {
    id: "chat-2",
    title: "Long chat title that should wrap and truncate cleanly in the sidebar",
    createdAt: "2026-06-06T09:30:00Z",
    updatedAt: "2026-06-06T10:10:00Z",
    messageCount: 7,
  },
];

const meta = {
  title: "Navigation/ResearchSidebar",
  component: ResearchSidebar,
  args: {
    folders,
    activeFolderName: folders[0].name,
    chats,
    activeChatId: chats[0].id,
    searchFolders: (() => Promise.resolve([])) as (query: string, abortSignal?: AbortSignal) => Promise<string[]>,
    status: "ready",
    chatsStatus: "ready",
    runningFolderNames: [],
    runningChatIds: [],
    attentionFolderNames: [],
    attentionChatIds: [],
    onNewChat: noop,
    onSelectFolder: noop,
    onNewResearchChat: noop,
    onSelectChat: noop,
    onRenameFolder: async () => undefined,
    onDeleteFolder: async () => undefined,
  },
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", display: "flex" }}>
        <Story />
        <div style={{ flex: 1, background: "var(--mantine-color-body)" }} />
      </div>
    ),
  ],
} satisfies Meta<typeof ResearchSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithChats: Story = {};

export const LoadingFolders: Story = {
  args: {
    folders: [],
    activeFolderName: null,
    chats: [],
    activeChatId: null,
    status: "loading",
    chatsStatus: "idle",
  },
};

export const Empty: Story = {
  args: {
    folders: [],
    activeFolderName: null,
    chats: [],
    activeChatId: null,
    status: "ready",
    chatsStatus: "idle",
  },
};

export const FolderLoadError: Story = {
  args: {
    folders: [],
    activeFolderName: null,
    chats: [],
    activeChatId: null,
    status: "error",
    chatsStatus: "idle",
  },
};

export const ChatLoadError: Story = {
  args: {
    chats: [],
    activeChatId: null,
    chatsStatus: "error",
  },
};

export const RunningItems: Story = {
  tags: ["!snapshot"],
  args: {
    runningFolderNames: [folders[0].name, folders[2].name],
    runningChatIds: [chats[1].id],
  },
};

export const WaitingForAnswer: Story = {
  args: {
    activeFolderName: folders[1].name,
    activeChatId: chats[1].id,
    attentionFolderNames: [folders[1].name, folders[2].name],
    attentionChatIds: [chats[1].id],
  },
};

export const WaitingForAnswerLight: Story = {
  args: WaitingForAnswer.args,
  decorators: [
    (Story) => (
      <ForcedColorScheme scheme="light">
        <Story />
      </ForcedColorScheme>
    ),
  ],
};

export const WaitingForAnswerDark: Story = {
  args: WaitingForAnswer.args,
  decorators: [
    (Story) => (
      <ForcedColorScheme scheme="dark">
        <Story />
      </ForcedColorScheme>
    ),
  ],
};

export const SearchResults: Story = {
  args: {
    searchFolders: async () => [
      "2026-06-06_storybook-integration",
      "vendor-pricing-comparison-with-a-long-folder-name",
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText(/search research/i), "storybook");
    await userEvent.keyboard("{Enter}");
  },
};

function ForcedColorScheme({
  scheme,
  children,
}: {
  scheme: "light" | "dark";
  children: ReactNode;
}) {
  return (
    <div data-mantine-color-scheme={scheme} style={{ minHeight: "100vh" }}>
      {children}
    </div>
  );
}
