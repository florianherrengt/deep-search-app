import { useEffect, useRef, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SubAgentSidebar } from "./sub-agent-sidebar";
import { SubAgentProvider, useSubAgentStore } from "@/lib/sub-agent-store";
import type { SubAgentRun, SubAgentEvent } from "@/lib/sub-agent-types";

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

const completedPlanRun: SubAgentRun = {
  id: "sa-plan-1",
  chatId: "sa-plan-1",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Research Plan",
  toolName: "create_research_plan",
  status: "completed",
  startedAt: new Date(now.getTime() - 8000).toISOString(),
  finishedAt: now.toISOString(),
  text: `## Research Plan: Best Espresso Machines 2024

### Pass 1 — Map the topic
- Survey the current market landscape for espresso machines
- Identify major brands and price tiers

### Pass 2 — Primary evidence
- Find expert reviews from coffee publications
- Compare specs across top-rated models

### Pass 3 — Independent evidence
- Check user reviews on retail sites
- Look for long-term durability reports

### Must-answer questions
1. What are the top 5 espresso machines under $500?
2. Which models have the best temperature stability?
3. What do long-term owners report about reliability?

### Source priority
- Primary: Expert reviews, manufacturer specs
- Secondary: User reviews, forum discussions
- Experiential: Owner testimonials, video reviews`,
  chunksReceived: 47,
  toolCalls: [],
  error: null,
  parentMessageId: "msg-1",
};

const streamingExtractRun: SubAgentRun = {
  id: "sa-extract-2",
  chatId: "sa-extract-2",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Content Extraction",
  toolName: "extract_page_content",
  status: "streaming",
  startedAt: new Date(now.getTime() - 3000).toISOString(),
  finishedAt: null,
  text: "Extracting content from https://example.com/espresso-review...\n\nThe Breville Barista Express is a standout choice for home baristas. It features an integrated conical burr grinder, precise espresso extraction with digital temperature control (PID), and a powerful steam wand for latte art.\n\nKey specs:\n- Grinder: Built-in conical burr\n- Boiler: Thermocoil with PID\n",
  chunksReceived: 14,
  toolCalls: [],
  error: null,
  parentMessageId: "msg-2",
};

const completedRecallRun: SubAgentRun = {
  id: "sa-recall-3",
  chatId: "sa-recall-3",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Research Recall",
  toolName: "retrieval_agent",
  status: "completed",
  startedAt: new Date(now.getTime() - 12000).toISOString(),
  finishedAt: new Date(now.getTime() - 7000).toISOString(),
  text: "Found relevant saved research about espresso machine comparisons.",
  chunksReceived: 8,
  toolCalls: [
    {
      toolName: "list_files",
      args: { folder: "coffee-research" },
      result: { files: ["notes.md", "sources.md"] },
      status: "complete",
    },
    {
      toolName: "read_file",
      args: { path: "/research/coffee-research/notes.md" },
      result: "# Coffee Research\nBreville Barista Express: good value...",
      status: "complete",
    },
  ],
  error: null,
  parentMessageId: "msg-1",
};

const erroredFolderRun: SubAgentRun = {
  id: "sa-folder-4",
  chatId: "sa-folder-4",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Folder Naming",
  toolName: "name_folder",
  status: "failed",
  startedAt: new Date(now.getTime() - 30000).toISOString(),
  finishedAt: new Date(now.getTime() - 25000).toISOString(),
  text: "best-espresso-machines-2024",
  chunksReceived: 6,
  toolCalls: [],
  error: "Research could not start because the research folder name could not be generated. Failed to generate a valid folder name after 3 attempts.",
  report: {
    name: "Folder Naming",
    status: "rejected",
    startedAt: new Date(now.getTime() - 30000).toISOString(),
    finishedAt: new Date(now.getTime() - 25000).toISOString(),
    durationMs: 5000,
    attempts: [
      { attempt: 1, startedAt: "", finishedAt: "", durationMs: 1500, rawOutputPreview: "\"Best Espresso Machines\"", sanitizedOutputPreview: "best-espresso-machines", accepted: false, rejectedReasonCode: "already_exists", rejectedReasonMessage: "Folder already exists" },
      { attempt: 2, startedAt: "", finishedAt: "", durationMs: 1500, rawOutputPreview: "\"Best Espresso 2024\"", sanitizedOutputPreview: "best-espresso-2024", accepted: false, rejectedReasonCode: "already_exists", rejectedReasonMessage: "Folder already exists" },
      { attempt: 3, startedAt: "", finishedAt: "", durationMs: 1500, rawOutputPreview: "\"espresso review\"", sanitizedOutputPreview: "espresso-review", accepted: false, rejectedReasonCode: "already_exists", rejectedReasonMessage: "Folder already exists" },
    ],
    safeForUiMessage: "Folder naming failed because a folder with that name already exists.",
    debugSummary: "Attempt 1: rejected (already_exists)\nAttempt 2: rejected (already_exists)\nAttempt 3: rejected (already_exists)",
  },
  parentMessageId: "msg-1",
};

const runningMemoryRun: SubAgentRun = {
  id: "sa-mem-5",
  chatId: "sa-mem-5",
  parentChatId: "test-chat",
  source: "sub-agent",
  name: "Memory Extraction",
  toolName: "memory_agent",
  status: "running",
  startedAt: new Date(now.getTime() - 2000).toISOString(),
  finishedAt: null,
  text: "Analyzing conversation for memorable facts...",
  chunksReceived: 3,
  toolCalls: [],
  error: null,
  parentMessageId: "msg-3",
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
    initialRuns: [completedPlanRun, streamingExtractRun, runningMemoryRun, erroredFolderRun],
    selectedRunId: "sa-plan-1",
  },
};

export const Empty: Story = {
  args: {
    initialRuns: [],
    selectedRunId: null,
  },
};

export const StreamingPlan: Story = {
  args: {
    initialRuns: [
      {
        ...completedPlanRun,
        id: "sa-stream-plan",
        chatId: "sa-stream-plan",
        status: "streaming",
        finishedAt: null,
        text: `## Research Plan: Best Espresso Machines 2024

### Pass 1 — Map the topic
- Survey the current market landscape for espresso machines
- Identify major brands and price tiers

### Pass 2 — Primary evidence
- Find expert reviews from coffee publications`,
        chunksReceived: 22,
        toolCalls: [],
      },
    ],
    selectedRunId: "sa-stream-plan",
  },
};

export const WithToolCalls: Story = {
  args: {
    initialRuns: [completedRecallRun],
    selectedRunId: "sa-recall-3",
  },
};

export const WithError: Story = {
  args: {
    initialRuns: [erroredFolderRun],
    selectedRunId: "sa-folder-4",
  },
};

export const AllCompleted: Story = {
  args: {
    initialRuns: [
      {
        id: "sa-all-1",
        chatId: "sa-all-1",
        parentChatId: "test-chat",
        source: "sub-agent",
        name: "Folder Naming",
        toolName: "name_folder",
        status: "completed",
        startedAt: new Date(now.getTime() - 60000).toISOString(),
        finishedAt: new Date(now.getTime() - 58000).toISOString(),
        text: "best-coffee-beans",
        chunksReceived: 3,
        toolCalls: [],
        error: null,
        parentMessageId: "msg-1",
      },
      {
        id: "sa-all-2",
        chatId: "sa-all-2",
        parentChatId: "test-chat",
        source: "sub-agent",
        name: "Research Plan",
        toolName: "create_research_plan",
        status: "completed",
        startedAt: new Date(now.getTime() - 55000).toISOString(),
        finishedAt: new Date(now.getTime() - 45000).toISOString(),
        text: "## Research Plan\n\n1. Survey the market\n2. Compare top models\n3. Check user reviews",
        chunksReceived: 20,
        toolCalls: [],
        error: null,
        parentMessageId: "msg-1",
      },
      {
        id: "sa-all-3",
        chatId: "sa-all-3",
        parentChatId: "test-chat",
        source: "sub-agent",
        name: "Content Extraction",
        toolName: "extract_page_content",
        status: "completed",
        startedAt: new Date(now.getTime() - 40000).toISOString(),
        finishedAt: new Date(now.getTime() - 20000).toISOString(),
        text: "Extracting content from https://example.com/review...\n\nThe Breville Barista Express is the best value pick. Key features include a built-in grinder and PID temperature control.",
        chunksReceived: 15,
        toolCalls: [],
        error: null,
        parentMessageId: "msg-1",
      },
    ],
    selectedRunId: "sa-all-2",
  },
};

const STREAMING_PLAN_TEXT = `## Research Plan: Best Espresso Machines 2024

### Pass 1 — Map the topic
- Survey the current market landscape for espresso machines
- Identify major brands and price tiers (Breville, De'Longhi, Rancilio, ECM)

### Pass 2 — Primary evidence
- Find expert reviews from coffee publications (Sprudge, Home-Barista)
- Compare specs across top-rated models under $500

### Pass 3 — Independent evidence
- Check user reviews on retail sites (Amazon, Whole Latte Love)
- Look for long-term durability reports from owners (1+ years)

### Must-answer questions
1. What are the top 5 espresso machines under $500?
2. Which models have the best temperature stability?
3. What do long-term owners report about reliability?

### Source priority
- **Primary:** Expert reviews, manufacturer specs
- **Secondary:** User reviews, forum discussions
- **Experiential:** Owner testimonials, video reviews

### Confidence rules
- Prefer recent reviews (2023-2024)
- Cross-reference at least 2 independent sources
- Weight hands-on reviews higher than spec comparisons

### Stop conditions
- All must-answer questions are answered
- At least 3 models compared in depth
- Price and availability confirmed`;

function StreamingSimulator({ chatId }: { chatId: string }) {
  const store = useSubAgentStore();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const runId = "sa-live-stream";
    const events: SubAgentEvent[] = [
      {
        type: "start",
        id: runId,
        source: "sub-agent",
        name: "Research Plan",
        toolName: "create_research_plan",
        parentMessageId: "msg-live",
      },
    ];

    const words = STREAMING_PLAN_TEXT.split(/(\s+)/);
    let buf = "";
    for (const w of words) {
      if (!w) continue;
      buf += w;
      if (buf.length >= 12 || w.includes("\n")) {
        events.push({ type: "text-delta", id: runId, delta: buf });
        buf = "";
      }
    }
    if (buf) {
      events.push({ type: "text-delta", id: runId, delta: buf });
    }
    events.push({ type: "complete", id: runId });

    const timers: ReturnType<typeof setTimeout>[] = [];
    let delay = 0;
    for (const event of events) {
      delay += 80;
      timers.push(
        setTimeout(() => {
          store.processEvent(chatId, event);
          if (event.type === "start") {
            store.selectRun(runId);
          }
        }, delay),
      );
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [chatId, store.processEvent]);

  return null;
}

export const LiveStreaming: Story = {
  render: () => {
    const chatId = "live-chat";
    return (
      <div style={{ height: 600, overflow: "hidden", display: "flex" }}>
        <SubAgentProvider>
          <StreamingSimulator chatId={chatId} />
          <SubAgentSidebar chatId={chatId} onClose={noop} />
        </SubAgentProvider>
        <div style={{ flex: 1, background: "var(--mantine-color-body)" }} />
      </div>
    );
  },
};
