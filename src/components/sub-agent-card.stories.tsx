import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubAgentCard } from "./sub-agent-card";

const meta = {
  title: "Components/SubAgentCard",
  component: SubAgentCard,
  args: {
    run: {
      id: "sa-1718000000-0",
      chatId: "sa-1718000000-0",
      parentChatId: "storybook-chat",
      name: "Brave Search",
      toolName: "brave_search",
      status: "running" as const,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      text: "Searching for relevant results...",
      toolCalls: [
        {
          toolName: "brave_search",
          args: { query: "AI research tools", count: 5 },
          status: "running" as const,
        },
      ],
      error: null,
      parentMessageId: "msg-1",
    },
    onClick: () => {},
  },
  parameters: {
    layout: "centered",
  },
} satisfies Meta<typeof SubAgentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {};

export const Complete: Story = {
  args: {
    run: {
      id: "sa-1718000000-1",
      chatId: "sa-1718000000-1",
      parentChatId: "storybook-chat",
      name: "Brave Search",
      toolName: "brave_search",
      status: "completed",
      startedAt: new Date(Date.now() - 3000).toISOString(),
      finishedAt: new Date().toISOString(),
      text: "Found 5 relevant results for AI research tools.",
      toolCalls: [
        {
          toolName: "brave_search",
          args: { query: "AI research tools", count: 5 },
          result: {
            results: [
              { title: "Result 1", url: "https://example.com/1" },
              { title: "Result 2", url: "https://example.com/2" },
            ],
          },
          status: "complete",
        },
      ],
      error: null,
      parentMessageId: "msg-1",
    },
  },
};

export const Error: Story = {
  args: {
    run: {
      id: "sa-1718000000-2",
      chatId: "sa-1718000000-2",
      parentChatId: "storybook-chat",
      name: "Extract Page Content",
      toolName: "extract_page_content",
      status: "failed",
      startedAt: new Date(Date.now() - 10000).toISOString(),
      finishedAt: new Date().toISOString(),
      text: "Attempting to extract page content...",
      toolCalls: [
        {
          toolName: "extract_page_content",
          args: { url: "https://example.com/research-paper" },
          status: "error",
        },
      ],
      error: "Request timed out after 30s",
      parentMessageId: "msg-1",
    },
  },
};

export const WithLongName: Story = {
  args: {
    run: {
      id: "sa-1718000000-3",
      chatId: "sa-1718000000-3",
      parentChatId: "storybook-chat",
      name: "Extract multiple URLs batch 1",
      toolName: "extract_page_content",
      status: "completed",
      startedAt: new Date(Date.now() - 5000).toISOString(),
      finishedAt: new Date().toISOString(),
      text: "Extracted content from 3 URLs.",
      toolCalls: [
        {
          toolName: "extract_page_content",
          args: { url: "https://example.com/a" },
          result: "Content from page A...",
          status: "complete",
        },
      ],
      error: null,
      parentMessageId: "msg-1",
    },
  },
};

export const WithoutToolCalls: Story = {
  args: {
    run: {
      id: "sa-1718000000-4",
      chatId: "sa-1718000000-4",
      parentChatId: "storybook-chat",
      name: "Research Checkpoint",
      toolName: "research_checkpoint",
      status: "completed",
      startedAt: new Date(Date.now() - 2000).toISOString(),
      finishedAt: new Date().toISOString(),
      text: "Checkpoint saved.",
      toolCalls: [],
      error: null,
      parentMessageId: "msg-1",
    },
  },
};
