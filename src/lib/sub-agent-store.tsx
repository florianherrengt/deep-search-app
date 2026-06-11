import {
  createContext,
  useCallback,
  useContext,
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
  });

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
      const runs = await readSubAgentRuns(folderName, chatId);
      setState((prev) => ({
        ...prev,
        runsByChat: { ...prev.runsByChat, [chatId]: runs },
      }));
    },
    [],
  );

  const processEvent = useCallback(
    (chatId: string, event: SubAgentEvent) => {
      setState((prev) => {
        const chatRuns = prev.runsByChat[chatId] ?? [];
        const updated = applyEvent(chatRuns, event, chatId);
        return {
          ...prev,
          runsByChat: { ...prev.runsByChat, [chatId]: updated },
        };
      });
    },
    [],
  );

  const clearRuns = useCallback((chatId: string) => {
    setState((prev) => {
      const { [chatId]: _, ...rest } = prev.runsByChat;
      return { ...prev, runsByChat: rest };
    });
  }, []);

  const selectRun = useCallback((runId: string | null) => {
    setState((prev) => ({ ...prev, selectedRunId: runId }));
  }, []);

  const persistRuns = useCallback(
    async (chatId: string, folderName: string) => {
      const runs = state.runsByChat[chatId];
      if (!runs) return;
      await writeSubAgentRuns(folderName, chatId, runs);
    },
    [state.runsByChat],
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
        (run) => run.chatId === runChatId || run.id === runChatId,
      );
      if (existingRun) return runs;

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
          toolCalls: [],
          error: null,
          parentMessageId: event.parentMessageId,
        },
      ];
    }

    case "text-delta":
      return updateRun(runs, event.id, (run) => {
        const next = run.text + event.delta;
        return {
          ...run,
          text:
            next.length > MAX_SUB_AGENT_TEXT_LENGTH
              ? next.slice(0, MAX_SUB_AGENT_TEXT_LENGTH)
              : next,
        };
      });

    case "tool-call":
      return updateRun(runs, event.id, (run) => ({
        ...run,
        toolCalls: [...run.toolCalls, event.toolCall],
      }));

    case "tool-result":
      return updateRun(runs, event.id, (run) => {
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

    case "complete":
      return updateRun(runs, event.id, (run) => ({
        ...run,
        status: "completed",
        finishedAt: new Date().toISOString(),
      }));

    case "error":
      return updateRun(runs, event.id, (run) => ({
        ...run,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: event.error,
      }));
  }
}

function updateRun(
  runs: SubAgentRun[],
  id: string,
  updater: (run: SubAgentRun) => SubAgentRun,
): SubAgentRun[] {
  return runs.map((run) =>
    run.id === id || run.chatId === id ? updater(run) : run,
  );
}
