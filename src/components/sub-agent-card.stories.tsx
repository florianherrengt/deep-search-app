import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubAgentCard } from "./sub-agent-card";

const baseRun = {
  parentChatId: "storybook-chat",
  error: null,
  parentMessageId: "msg-1",
  toolCalls: [],
};

const meta = {
  title: "Components/SubAgentCard",
  component: SubAgentCard,
  args: {
    run: {
      ...baseRun,
      id: "sa-1718000000-0",
      chatId: "sa-1718000000-0",
      name: "Research Plan",
      toolName: "create_research_plan",
      status: "streaming" as const,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      text: "## Research Plan\n\n1. **Map the topic** — survey the landscape of...",
      chunksReceived: 8,
    },
    onClick: () => {},
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof SubAgentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Streaming: Story = {};

export const Running: Story = {
  args: {
    run: {
      ...baseRun,
      id: "sa-1718000000-0b",
      chatId: "sa-1718000000-0b",
      name: "Content Extraction",
      toolName: "extract_page_content",
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      text: "Extracting content from https://example.com...",
      chunksReceived: 1,
    },
  },
};

export const Complete: Story = {
  args: {
    run: {
      ...baseRun,
      id: "sa-1718000000-1",
      chatId: "sa-1718000000-1",
      name: "Research Plan",
      toolName: "create_research_plan",
      status: "completed",
      startedAt: new Date(Date.now() - 3000).toISOString(),
      finishedAt: new Date().toISOString(),
      text: "## Research Plan\n\n1. Map the topic\n2. Primary evidence\n3. Synthesis",
      chunksReceived: 12,
    },
  },
};

export const Error: Story = {
  args: {
    run: {
      ...baseRun,
      id: "sa-1718000000-2",
      chatId: "sa-1718000000-2",
      name: "Folder Naming",
      toolName: "name_folder",
      status: "failed",
      startedAt: new Date(Date.now() - 10000).toISOString(),
      finishedAt: new Date().toISOString(),
      text: "best-coffee-beans-espresso",
      chunksReceived: 4,
      error: "Research could not start because the research folder name could not be generated.",
    },
  },
};

export const WithLongName: Story = {
  args: {
    run: {
      ...baseRun,
      id: "sa-1718000000-3",
      chatId: "sa-1718000000-3",
      name: "Research Recall",
      toolName: "retrieval_agent",
      status: "completed",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      finishedAt: new Date().toISOString(),
      text: "Found 3 relevant research folders.",
      chunksReceived: 5,
    },
  },
};
