import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  type SubAgentRun,
  type SubAgentEvent,
  isSubAgentStartEvent,
  MAX_SUB_AGENT_TEXT_LENGTH,
} from "./sub-agent-types";
import {
  normalizeSubAgentRuns,
  readSubAgentRuns,
  writeSubAgentRuns,
} from "./sub-agent-persistence";

interface SubAgentStoreState {
  runsByChat: Record<string, SubAgentRun[]>;
  selectedRunId: string | null;
  processedEventFingerprints: Set<string>;
}

interface SubAgentStoreActions {
  loadRuns: (chatId: string, runs: SubAgentRun[]) => void;
  loadRunsFromDisk: (chatId: string, folderName: string) => Promise<void>;
  processEvent: (chatId: string, event: SubAgentEvent) => void;
  clearRuns: (chatId: string) => void;
  selectRun: (runId: string | null) => void;
  persistRuns: (chatId: string, folderName: string) => Promise<void>;
  getRuns: (chatId: string) => SubAgentRun[];
  getSelectedRun: (chatId: string) => SubAgentRun | null;
}

type SubAgentStore = SubAgentStoreState & SubAgentStoreActions;

const SubAgentContext = createContext<SubAgentStore | null>(null);

export function SubAgentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SubAgentStoreState>({
    runsByChat: {},
    selectedRunId: null,
    processedEventFingerprints: new Set(),
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

  const loadRuns = useCallback((chatId: string, runs: SubAgentRun[]) => {
    setState((prev) => ({
      ...prev,
      runsByChat: {
        ...prev.runsByChat,
        [chatId]: normalizeSubAgentRuns(runs, chatId),
      },
    }));
  }, []);

  const loadRunsFromDisk = useCallback(
    async (chatId: string, folderName: string) => {
      try {
        const runs = await readSubAgentRuns(folderName, chatId);
        setState((prev) => {
          const existing = prev.runsByChat[chatId] ?? [];
          const existingIds = new Set(existing.map((r) => r.id));
          const merged = runs.filter((r) => !existingIds.has(r.id));
          return {
            ...prev,
            runsByChat: {
              ...prev.runsByChat,
              [chatId]: [...existing, ...merged],
            },
          };
        });
      } catch (error) {
        console.error("[sub-agent-store] failed to load runs from disk", {
          chatId,
          folderName,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    },
    [],
  );

  const processEvent = useCallback(
    (chatId: string, event: SubAgentEvent) => {
      const fingerprint = getEventFingerprint(chatId, event);
      if (fingerprint !== null) {
        setState((prev) => {
          if (prev.processedEventFingerprints.has(fingerprint)) {
            return prev;
          }
          const nextFingerprints = new Set(prev.processedEventFingerprints);
          nextFingerprints.add(fingerprint);
          if (nextFingerprints.size > 10_000) {
            const toDelete: string[] = [];
            let i = 0;
            for (const v of nextFingerprints) {
              if (i >= 5000) break;
              toDelete.push(v);
              i++;
            }
            for (const v of toDelete) nextFingerprints.delete(v);
          }
          const chatRuns = prev.runsByChat[chatId] ?? [];
          const updated = applyEvent(chatRuns, event, chatId);
          return {
            ...prev,
            processedEventFingerprints: nextFingerprints,
            runsByChat: { ...prev.runsByChat, [chatId]: updated },
          };
        });
      } else {
        setState((prev) => {
          const chatRuns = prev.runsByChat[chatId] ?? [];
          const updated = applyEvent(chatRuns, event, chatId);
          return {
            ...prev,
            runsByChat: { ...prev.runsByChat, [chatId]: updated },
          };
        });
      }
    },
    [],
  );

  const clearRuns = useCallback((chatId: string) => {
    setState((prev) => {
      const { [chatId]: _, ...rest } = prev.runsByChat;
      const prefix = `${chatId}:`;
      const nextFingerprints = new Set(
        [...prev.processedEventFingerprints].filter((fp) => !fp.startsWith(prefix)),
      );
      return { ...prev, runsByChat: rest, processedEventFingerprints: nextFingerprints };
    });
  }, []);

  const selectRun = useCallback((runId: string | null) => {
    setState((prev) => ({ ...prev, selectedRunId: runId }));
  }, []);

  const persistRuns = useCallback(
    (chatId: string, folderName: string): Promise<void> => {
      const doWrite = async () => {
        const runs = stateRef.current.runsByChat[chatId];
        if (!runs) return;
        await writeSubAgentRuns(folderName, chatId, runs);
      };
      const prev = writeQueueRef.current;
      const next = prev.then(doWrite, doWrite);
      writeQueueRef.current = next.catch((error) => {
        console.error("[sub-agent-store] failed to persist sub-agent runs", {
          chatId,
          folderName,
          error: error instanceof Error ? error.message : "unknown",
        });
      });
      return next;
    },
    [],
  );

  const getRuns = useCallback(
    (chatId: string) => state.runsByChat[chatId] ?? [],
    [state.runsByChat],
  );

  const getSelectedRun = useCallback(
    (chatId: string) => {
      if (!state.selectedRunId) return null;
      return (
        state.runsByChat[chatId]?.find((r) => r.id === state.selectedRunId) ??
        null
      );
    },
    [state.runsByChat, state.selectedRunId],
  );

  const store: SubAgentStore = {
    ...state,
    loadRuns,
    loadRunsFromDisk,
    processEvent,
    clearRuns,
    selectRun,
    persistRuns,
    getRuns,
    getSelectedRun,
  };

  return (
    <SubAgentContext.Provider value={store}>{children}</SubAgentContext.Provider>
  );
}

export function useSubAgentStore(): SubAgentStore {
  const store = useContext(SubAgentContext);
  if (!store) {
    throw new Error("useSubAgentStore must be used within a SubAgentProvider");
  }
  return store;
}

const STUB_NAME = "Sub-agent";
const STUB_TOOL_NAME = "unknown";

function isStubValue(value: string, stub: string): boolean {
  return !value || value === stub;
}

function applyEvent(
  runs: SubAgentRun[],
  event: SubAgentEvent,
  parentChatId: string,
): SubAgentRun[] {
  switch (event.type) {
    case "start": {
      if (!isSubAgentStartEvent(event)) return runs;

      const runChatId = event.chatId ?? event.id;
      const existingRun = runs.find(
        (run) => run.id === runChatId,
      );
      if (existingRun) {
        if (isStubValue(existingRun.name, STUB_NAME) || isStubValue(existingRun.toolName, STUB_TOOL_NAME)) {
          return updateRun(runs, runChatId, (run) => ({
            ...run,
            name: isStubValue(run.name, STUB_NAME) ? event.name : run.name,
            toolName: isStubValue(run.toolName, STUB_TOOL_NAME) ? event.toolName : run.toolName,
            parentMessageId: run.parentMessageId || event.parentMessageId,
            chatId: runChatId,
          }));
        }
        return runs;
      }

      return [
        ...runs,
        {
          id: runChatId,
          chatId: runChatId,
          parentChatId,
          source: "sub-agent",
          name: event.name,
          toolName: event.toolName,
          status: "running",
          startedAt: new Date().toISOString(),
          finishedAt: null,
          text: "",
          chunksReceived: 0,
          toolCalls: [],
          error: null,
          parentMessageId: event.parentMessageId,
        },
      ];
    }

    case "text-delta": {
      const withRun = ensureRun(runs, event.id, parentChatId);
      return updateRun(withRun, event.id, (run) => {
        const next = run.text + event.delta;
        return {
          ...run,
          status: run.status === "running" ? "streaming" as const : run.status,
          text:
            next.length > MAX_SUB_AGENT_TEXT_LENGTH
              ? next.slice(0, MAX_SUB_AGENT_TEXT_LENGTH)
              : next,
          chunksReceived: run.chunksReceived + 1,
        };
      });
    }

    case "tool-call": {
      const withRun = ensureRun(runs, event.id, parentChatId);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        toolCalls: [...run.toolCalls, event.toolCall],
      }));
    }

    case "tool-result": {
      const withRun = ensureRun(runs, event.id, parentChatId);
      return updateRun(withRun, event.id, (run) => {
        const calls = [...run.toolCalls];
        const toolCallIndex =
          typeof event.toolCallIndex === "number"
            ? event.toolCallIndex
            : calls.findIndex((call) => call.toolCallId === event.toolCallId);

        if (toolCallIndex >= 0 && calls[toolCallIndex]) {
          calls[toolCallIndex] = {
            ...calls[toolCallIndex],
            result: event.result,
            status: event.status ?? "complete",
          };
        }
        return { ...run, toolCalls: calls };
      });
    }

    case "complete": {
      const withRun = ensureRun(runs, event.id, parentChatId);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        status: "completed",
        finishedAt: new Date().toISOString(),
      }));
    }

    case "report": {
      const withRun = ensureRun(runs, event.id, parentChatId);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        report: event.report,
      }));
    }

    case "error": {
      const withRun = ensureRun(runs, event.id, parentChatId);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: event.error,
      }));
    }

    case "cancelled": {
      const withRun = ensureRun(runs, event.id, parentChatId);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        status: "cancelled",
        finishedAt: new Date().toISOString(),
      }));
    }
  }
}

function updateRun(
  runs: SubAgentRun[],
  id: string,
  updater: (run: SubAgentRun) => SubAgentRun,
): SubAgentRun[] {
  return runs.map((run) =>
    run.id === id ? updater(run) : run,
  );
}

function ensureRun(
  runs: SubAgentRun[],
  id: string,
  parentChatId: string,
): SubAgentRun[] {
  if (runs.some((run) => run.id === id)) return runs;
  console.warn("[sub-agent-store] creating stub run for out-of-order event", { id, eventType: "unknown" });
  return [
    ...runs,
    {
      id,
      chatId: id,
      parentChatId,
      source: "sub-agent",
      name: STUB_NAME,
      toolName: STUB_TOOL_NAME,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      text: "",
      chunksReceived: 0,
      toolCalls: [],
      error: null,
      parentMessageId: "",
    },
  ];
}

function getEventFingerprint(chatId: string, event: SubAgentEvent): string | null {
  switch (event.type) {
    case "start":
      return `${chatId}:start:${event.id}`;
    case "text-delta": {
      const run = event as { id: string; delta: string };
      return `${chatId}:td:${run.id}:${run.delta}`;
    }
    case "tool-call":
      return `${chatId}:tc:${event.id}:${event.toolCall.toolCallId ?? event.toolCall.toolName}`;
    case "tool-result":
      return `${chatId}:tr:${event.id}:${event.toolCallIndex ?? ""}:${event.toolCallId ?? ""}`;
    case "complete":
      return `${chatId}:done:${event.id}`;
    case "error":
      return `${chatId}:err:${event.id}`;
    case "cancelled":
      return `${chatId}:cancel:${event.id}`;
    case "report":
      return `${chatId}:rpt:${event.id}`;
  }
}
