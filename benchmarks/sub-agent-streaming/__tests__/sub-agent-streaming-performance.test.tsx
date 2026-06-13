// @vitest-environment jsdom
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { Profiler, useLayoutEffect, useRef, type ProfilerOnRenderCallback } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SubAgentSidebar } from "@/components/sub-agent-sidebar";
import * as subAgentStoreModule from "@/lib/sub-agent-store";
import type { SubAgentEvent, SubAgentRun } from "@/lib/sub-agent-types";

type Actions = {
  processEvent: (chatId: string, event: SubAgentEvent) => void;
};

type Store = Actions & {
  getRuns: (chatId: string) => SubAgentRun[];
};

type StoreModule = typeof subAgentStoreModule & {
  useSubAgentActions?: () => Actions;
};

type ScenarioMode = "text" | "progress";

type Scenario = {
  agents: number;
  sidebarVisible: boolean;
  mode: ScenarioMode;
};

type ScenarioResult = Scenario & {
  label: string;
  events: number;
  textEvents: number;
  progressEvents: number;
  processMs: number;
  flushMs: number;
  totalMs: number;
  actionConsumerRenders: number;
  stateConsumerRenders: number;
  sidebarCommits: number;
  sidebarActualMs: number;
  chunksStored: number;
  textLength: number;
};

const CHAT_ID = "benchmark-chat";
const CHUNKS_PER_AGENT = 60;
const PROGRESS_EVENTS_PER_AGENT = 6;
const CHUNKS_PER_FLUSH_WINDOW = 10;
const SELECTED_SCENARIOS = selectScenarios(buildScenarios());
const benchmarkResults: ScenarioResult[] = [];

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  class ResizeObserverMock {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  }

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.skipIf(process.env.RUN_SUB_AGENT_BENCHMARK !== "1")(
  "sub-agent streaming benchmark",
  () => {
    afterAll(() => {
      if (benchmarkResults.length === 0) return;
      const outputPath = writeBenchmarkResults(benchmarkResults);

      console.table(
        benchmarkResults.map((result) => ({
          agents: result.agents,
          sidebar: result.sidebarVisible ? "visible" : "hidden",
          mode: result.mode,
          events: result.events,
          totalMs: result.totalMs.toFixed(2),
          actionRenders: result.actionConsumerRenders,
          stateRenders: result.stateConsumerRenders,
          sidebarCommits: result.sidebarCommits,
          sidebarMs: result.sidebarActualMs.toFixed(2),
        })),
      );
      console.info(`[sub-agent-benchmark] wrote ${outputPath}`);
    });

    it.each(SELECTED_SCENARIOS)(
      "agents=$agents sidebar=$sidebarVisible mode=$mode",
      (scenario) => {
        vi.useFakeTimers();
        console.info(
          `[sub-agent-benchmark] scenario agents=${scenario.agents} sidebar=${scenario.sidebarVisible ? "visible" : "hidden"} mode=${scenario.mode}`,
        );
        const result = runScenario(scenario);
        benchmarkResults.push(result);

        expect(result.events).toBeGreaterThan(0);
      },
    );
  },
);

function buildScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];
  const modes: ScenarioMode[] = ["text", "progress"];
  for (const agents of [1, 2, 5, 10]) {
    for (const sidebarVisible of [false, true]) {
      for (const mode of modes) {
        scenarios.push({ agents, sidebarVisible, mode });
      }
    }
  }
  return scenarios;
}

function selectScenarios(scenarios: Scenario[]): Scenario[] {
  const limit = Number.parseInt(process.env.BENCHMARK_LIMIT ?? "", 10);
  const offset = Number.parseInt(process.env.BENCHMARK_OFFSET ?? "0", 10);
  const end = Number.isFinite(limit) ? offset + limit : undefined;
  return scenarios.slice(offset, end);
}

function runScenario(scenario: Scenario): ScenarioResult {
  vi.clearAllTimers();
  cleanup();

  let actionConsumerRenders = 0;
  let stateConsumerRenders = 0;
  let sidebarCommits = 0;
  let sidebarActualMs = 0;
  let actions: Actions | null = null;
  let store: Store | null = null;

  const onSidebarRender: ProfilerOnRenderCallback = (
    _id,
    _phase,
    actualDuration,
  ) => {
    sidebarCommits += 1;
    sidebarActualMs += actualDuration;
  };

  function ActionConsumer() {
    actionConsumerRenders += 1;
    const moduleWithActions = subAgentStoreModule as StoreModule;
    actions = moduleWithActions.useSubAgentActions
      ? moduleWithActions.useSubAgentActions()
      : subAgentStoreModule.useSubAgentStore();
    return null;
  }

  function StateConsumer() {
    stateConsumerRenders += 1;
    store = subAgentStoreModule.useSubAgentStore();
    return null;
  }

  function OpenFirstRun() {
    const currentStore = subAgentStoreModule.useSubAgentStore();
    const selectedRef = useRef<string | null>(null);
    useLayoutEffect(() => {
      const firstRun = currentStore.getRuns(CHAT_ID)[0];
      if (firstRun && selectedRef.current !== firstRun.id) {
        selectedRef.current = firstRun.id;
        currentStore.selectRun(firstRun.id);
      }
    }, [currentStore]);
    return null;
  }

  render(
    <MantineProvider>
      <subAgentStoreModule.SubAgentProvider>
        <ActionConsumer />
        <StateConsumer />
        {scenario.sidebarVisible && <OpenFirstRun />}
        {scenario.sidebarVisible && (
          <Profiler id="SubAgentSidebar" onRender={onSidebarRender}>
            <SubAgentSidebar chatId={CHAT_ID} onClose={() => undefined} />
          </Profiler>
        )}
      </subAgentStoreModule.SubAgentProvider>
    </MantineProvider>,
  );

  if (!actions) throw new Error("Sub-agent actions were not captured");
  const eventWindows = buildEventWindows(scenario);
  const events = eventWindows.flat();
  const textEvents = events.filter((event) => event.type === "text-delta").length;
  const progressEvents = events.length - textEvents;

  let processMs = 0;
  let flushMs = 0;
  const startedAt = performance.now();
  for (const eventWindow of eventWindows) {
    const processStartedAt = performance.now();
    act(() => {
      for (const event of eventWindow) {
        actions!.processEvent(CHAT_ID, event);
      }
    });
    const processFinishedAt = performance.now();
    processMs += processFinishedAt - processStartedAt;

    act(() => {
      vi.advanceTimersByTime(100);
    });
    flushMs += performance.now() - processFinishedAt;
  }
  const finishedAt = performance.now();

  const runs = store?.getRuns(CHAT_ID) ?? [];
  const chunksStored = runs.reduce((sum, run) => sum + run.chunksReceived, 0);
  const textLength = runs.reduce((sum, run) => sum + run.text.length, 0);

  const result = {
    ...scenario,
    label: process.env.BENCHMARK_LABEL ?? "current",
    events: events.length,
    textEvents,
    progressEvents,
    processMs: round(processMs),
    flushMs: round(flushMs),
    totalMs: round(finishedAt - startedAt),
    actionConsumerRenders,
    stateConsumerRenders,
    sidebarCommits,
    sidebarActualMs: round(sidebarActualMs),
    chunksStored,
    textLength,
  };

  vi.clearAllTimers();
  cleanup();
  return result;
}

function buildEventWindows({ agents, mode }: Scenario): SubAgentEvent[][] {
  const windows: SubAgentEvent[][] = [];
  const includeText = mode === "text";
  const includeProgress = mode === "progress";
  const startEvents: SubAgentEvent[] = [];

  for (let agentIndex = 0; agentIndex < agents; agentIndex += 1) {
    startEvents.push({
      type: "start",
      id: agentId(agentIndex),
      source: "sub-agent",
      name: `Benchmark Agent ${agentIndex}`,
      toolName: "retrieval_agent",
      parentMessageId: "benchmark-message",
    });
  }
  windows.push(startEvents);

  const progressInterval = Math.max(
    1,
    Math.floor(CHUNKS_PER_AGENT / PROGRESS_EVENTS_PER_AGENT),
  );

  for (
    let windowStart = 0;
    windowStart < CHUNKS_PER_AGENT;
    windowStart += CHUNKS_PER_FLUSH_WINDOW
  ) {
    const windowEvents: SubAgentEvent[] = [];
    const windowEnd = Math.min(
      CHUNKS_PER_AGENT,
      windowStart + CHUNKS_PER_FLUSH_WINDOW,
    );

    for (let chunkIndex = windowStart; chunkIndex < windowEnd; chunkIndex += 1) {
      for (let agentIndex = 0; agentIndex < agents; agentIndex += 1) {
        const id = agentId(agentIndex);
        if (includeText) {
          windowEvents.push({
            type: "text-delta",
            id,
            delta: `token-${agentIndex}-${chunkIndex} `,
          });
        }

        if (includeProgress && chunkIndex % progressInterval === 0) {
          const toolCallId = `tool-${agentIndex}-${chunkIndex}`;
          windowEvents.push({
            type: "tool-call",
            id,
            toolCall: {
              toolCallId,
              toolName: "web_search",
              args: { query: `query ${agentIndex} ${chunkIndex}` },
              status: "running",
            },
          });
          windowEvents.push({
            type: "tool-result",
            id,
            toolCallId,
            result: { ok: true, chunkIndex },
          });
        }
      }
    }

    windows.push(windowEvents);
  }

  const completeEvents: SubAgentEvent[] = [];
  for (let agentIndex = 0; agentIndex < agents; agentIndex += 1) {
    completeEvents.push({ type: "complete", id: agentId(agentIndex) });
  }
  windows.push(completeEvents);

  return windows;
}

function writeBenchmarkResults(results: ScenarioResult[]): string {
  mkdirSync(".agent-logs", { recursive: true });
  const label = process.env.BENCHMARK_LABEL ?? "current";
  const outputPath = process.env.BENCHMARK_OUTPUT_PATH ?? `.agent-logs/sub-agent-streaming-benchmark-${label}.json`;
  writeFileSync(outputPath, `${JSON.stringify(results, null, 2)}\n`);
  return outputPath;
}

function agentId(index: number): string {
  return `benchmark-agent-${index}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
