import { useEffect, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubAgentSidebar } from "./sub-agent-sidebar";
import { SubAgentProvider, useSubAgentStore } from "@/lib/sub-agent-store";
import type { SubAgentRun } from "@/lib/sub-agent-types";

const noop = () => undefined;

type StoryArgs = ComponentProps<typeof SubAgentSidebar> & {
  initialRuns: SubAgentRun[];
  selectedRunId: string | null;
};

function SidebarWithStore({
  chatId,
  initialRuns,
  selectedRunId,
  ...sidebarProps
}: {
  chatId: string;
  initialRuns: SubAgentRun[];
  selectedRunId: string | null;
} & ComponentProps<typeof SubAgentSidebar>) {
  return (
    <SubAgentProvider>
      <StoreInit chatId={chatId} initialRuns={initialRuns} selectedRunId={selectedRunId} />
      <SubAgentSidebar chatId={chatId} {...sidebarProps} />
    </SubAgentProvider>
  );
}

function StoreInit({
  chatId,
  initialRuns,
  selectedRunId,
}: {
  chatId: string;
  initialRuns: SubAgentRun[];
  selectedRunId: string | null;
}) {
  const store = useSubAgentStore();

  useEffect(() => {
    store.loadRuns(chatId, initialRuns);
  }, []);

  useEffect(() => {
    if (selectedRunId) store.selectRun(selectedRunId);
  }, []);

  return null;
}

const now = new Date("2025-01-15T10:00:00Z");

const completedRecallRun: SubAgentRun = {
  id: "sa-recall-1",
  chatId: "sa-recall-1",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Research Recall",
  toolName: "retrieval_agent",
  status: "completed",
  startedAt: new Date(now.getTime() - 5000).toISOString(),
  finishedAt: now.toISOString(),
  text: "Identified the most relevant saved research folder for this request.",
  toolCalls: [
    {
      toolName: "list_files",
      args: { folder: "ai-research-tools" },
      result: {
        files: ["notes.md", "sources.md"],
      },
      status: "complete",
    },
  ],
  error: null,
  parentMessageId: "msg-1",
};

const runningSeqRun: SubAgentRun = {
  id: "sa-seq-2",
  chatId: "sa-seq-2",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Memory Extraction",
  toolName: "memory_agent",
  status: "running",
  startedAt: new Date(now.getTime() - 12000).toISOString(),
  finishedAt: null,
  text: "Step 1: Analyze the problem domain.\nStep 2: Identify key research areas.\nStep 3: Currently evaluating...",
  toolCalls: [
    {
      toolName: "sequential_thinking",
      args: { thought: "Break down the research question into sub-problems", thoughtNumber: 1, totalThoughts: 5 },
      result: undefined,
      status: "complete",
    },
    {
      toolName: "sequential_thinking",
      args: { thought: "Evaluate the current state of AI research tools", thoughtNumber: 2, totalThoughts: 5 },
      status: "running",
    },
  ],
  error: null,
  parentMessageId: "msg-1",
};

const erroredExtractRun: SubAgentRun = {
  id: "sa-extract-3",
  chatId: "sa-extract-3",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Folder Naming",
  toolName: "name_folder",
  status: "failed",
  startedAt: new Date(now.getTime() - 30000).toISOString(),
  finishedAt: new Date(now.getTime() - 15000).toISOString(),
  text: "Attempting to extract content from https://example.com/research-paper...",
  toolCalls: [
    {
      toolName: "extract_page_content",
      args: { url: "https://example.com/research-paper" },
      result: undefined,
      status: "error",
    },
  ],
  error: "Request timed out after 30s",
  parentMessageId: "msg-1",
};

const meta: Meta<StoryArgs> = {
  title: "Components/SubAgentSidebar",
  component: SubAgentSidebar,
  render: (args) => {
    const { initialRuns, selectedRunId, ...sidebarProps } = args;
    return (
      <div style={{ height: 600, overflow: "hidden", display: "flex" }}>
        <SidebarWithStore initialRuns={initialRuns} selectedRunId={selectedRunId} {...sidebarProps} />
        <div style={{ flex: 1, background: "var(--mantine-color-body)" }} />
      </div>
    );
  },
  args: {
    chatId: "test-chat",
    onClose: noop,
    initialRuns: [],
    selectedRunId: null,
  },
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const WithRuns: Story = {
  args: {
    initialRuns: [completedRecallRun, runningSeqRun, erroredExtractRun],
    selectedRunId: "sa-recall-1",
  },
};

export const Empty: Story = {
  args: {
    initialRuns: [],
    selectedRunId: null,
  },
};

export const WithToolCalls: Story = {
  args: {
    initialRuns: [
      {
        id: "sa-tools-1",
        chatId: "sa-tools-1",
        parentChatId: "test-chat",
        source: "sub-agent",
        name: "Research Agent",
        toolName: "retrieval_agent",
        status: "completed",
        startedAt: new Date(now.getTime() - 20000).toISOString(),
        finishedAt: now.toISOString(),
        text: "Research complete. Compiled findings from tool calls below.",
        toolCalls: [
          {
            toolName: "list_files",
            args: { path: "/research/storybook-setup", recursive: false },
            result: { files: ["setup.md", "addons.md", "vite-config.ts"], count: 3 },
            status: "complete",
          },
          {
            toolName: "read_file",
            args: { path: "/research/storybook-setup/setup.md" },
            result: undefined,
            status: "running",
          },
        ],
        error: null,
        parentMessageId: "msg-2",
      },
    ],
    selectedRunId: "sa-tools-1",
  },
};

export const WithError: Story = {
  args: {
    initialRuns: [erroredExtractRun],
    selectedRunId: "sa-extract-3",
  },
};
