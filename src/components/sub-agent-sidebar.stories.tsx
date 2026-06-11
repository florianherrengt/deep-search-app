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

const completedBraveRun: SubAgentRun = {
  id: "sa-brave-1",
  name: "brave_search",
  toolName: "brave_search",
  status: "complete",
  startedAt: new Date(now.getTime() - 5000).toISOString(),
  finishedAt: now.toISOString(),
  text: "Found 5 results for the query. Top result discusses modern AI search techniques.",
  toolCalls: [
    {
      toolName: "brave_search",
      args: { query: "AI research tools 2025", count: 5 },
      result: {
        results: [
          { title: "AI Research Tools Comparison", url: "https://example.com/ai-tools" },
          { title: "Best AI Search Engines", url: "https://example.com/search" },
        ],
      },
      status: "complete",
    },
  ],
  error: null,
  parentMessageId: "msg-1",
};

const runningSeqRun: SubAgentRun = {
  id: "sa-seq-2",
  name: "sequential_thinking",
  toolName: "sequential_thinking",
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
  name: "extract_page_content",
  toolName: "extract_page_content",
  status: "error",
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
    initialRuns: [completedBraveRun, runningSeqRun, erroredExtractRun],
    selectedRunId: "sa-brave-1",
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
        name: "research_agent",
        toolName: "research_agent",
        status: "complete",
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
