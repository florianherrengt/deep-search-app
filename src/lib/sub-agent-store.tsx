import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import {
  recordSubAgentHandlerDuration,
  recordSubAgentUpdateDuration,
  startSubAgentProfileMeasure,
} from "./sub-agent-profiler";

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
}

interface SubAgentStoreReaders {
  getRuns: (chatId: string) => SubAgentRun[];
  getSelectedRun: (chatId: string) => SubAgentRun | null;
}

type SubAgentStore = SubAgentStoreState & SubAgentStoreActions & SubAgentStoreReaders;

const SubAgentStateContext = createContext<SubAgentStoreState | null>(null);
const SubAgentActionsContext = createContext<SubAgentStoreActions | null>(null);
const SubAgentReadersContext = createContext<SubAgentStoreReaders | null>(null);
const SubAgentRunsByChatContext = createContext<Record<string, SubAgentRun[]> | null>(null);
const SubAgentSelectedRunIdContext = createContext<string | null>(null);

const EMPTY_SUB_AGENT_RUNS: SubAgentRun[] = [];

const TEXT_DELTA_FLUSH_DELAY_MS = 100;

interface PendingTextDelta {
  chatId: string;
  runId: string;
  delta: string;
  chunksReceived: number;
}

interface PendingTextDeltaFilter {
  chatId?: string;
  runId?: string;
}

export function SubAgentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SubAgentStoreState>({
    runsByChat: {},
    selectedRunId: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const processedEventFingerprintsRef = useRef<Set<string>>(new Set());
  const pendingTextDeltasRef = useRef<Map<string, PendingTextDelta>>(new Map());
  const textDeltaFlushTimerRef = useRef<number | null>(null);

  const clearScheduledTextDeltaFlush = useCallback(() => {
    if (textDeltaFlushTimerRef.current !== null) {
      window.clearTimeout(textDeltaFlushTimerRef.current);
      textDeltaFlushTimerRef.current = null;
    }
  }, []);

  const flushPendingTextDeltas = useCallback(
    (filter: PendingTextDeltaFilter = {}) => {
      const batches = takePendingTextDeltaBatches(
        pendingTextDeltasRef.current,
        filter,
      );

      if (pendingTextDeltasRef.current.size === 0) {
        clearScheduledTextDeltaFlush();
      }

      if (batches.length === 0) return;

      setState((prev) => {
        const startedAt = startSubAgentProfileMeasure();

        try {
          const nextRunsByChat = applyTextDeltaBatchesToRunsByChat(
            prev.runsByChat,
            batches,
          );
          return nextRunsByChat ? { ...prev, runsByChat: nextRunsByChat } : prev;
        } finally {
          recordSubAgentUpdateDuration("store.flushTextDeltas", startedAt);
        }
      });
    },
    [clearScheduledTextDeltaFlush],
  );

  const scheduleTextDeltaFlush = useCallback(() => {
    if (textDeltaFlushTimerRef.current !== null) return;

    textDeltaFlushTimerRef.current = window.setTimeout(() => {
      textDeltaFlushTimerRef.current = null;
      flushPendingTextDeltas();
    }, TEXT_DELTA_FLUSH_DELAY_MS);
  }, [flushPendingTextDeltas]);

  const clearPendingTextDeltasForChat = useCallback(
    (chatId: string) => {
      const pending = pendingTextDeltasRef.current;
      for (const [key, batch] of pending) {
        if (batch.chatId === chatId) {
          pending.delete(key);
        }
      }

      if (pending.size === 0) {
        clearScheduledTextDeltaFlush();
      }
    },
    [clearScheduledTextDeltaFlush],
  );

  useEffect(
    () => () => {
      clearScheduledTextDeltaFlush();
    },
    [clearScheduledTextDeltaFlush],
  );

  const loadRuns = useCallback((chatId: string, runs: SubAgentRun[]) => {
    clearPendingTextDeltasForChat(chatId);
    setState((prev) => ({
      ...prev,
      runsByChat: {
        ...prev.runsByChat,
        [chatId]: normalizeSubAgentRuns(runs, chatId),
      },
    }));
  }, [clearPendingTextDeltasForChat]);

  const loadRunsFromDisk = useCallback(
    async (chatId: string, folderName: string) => {
      try {
        flushPendingTextDeltas({ chatId });
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
    [flushPendingTextDeltas],
  );

  const processEvent = useCallback(
    (chatId: string, event: SubAgentEvent) => {
      const handlerStartedAt = startSubAgentProfileMeasure();
      try {
        const fingerprint = getEventFingerprint(chatId, event);
        if (fingerprint !== null) {
          const fingerprints = processedEventFingerprintsRef.current;
          if (fingerprints.has(fingerprint)) return;

          fingerprints.add(fingerprint);
          pruneEventFingerprints(fingerprints);
        }

        if (event.type === "text-delta") {
          const pendingKey = getPendingTextDeltaKey(chatId, event.id);
          const existing = pendingTextDeltasRef.current.get(pendingKey);
          if (existing) {
            existing.delta += event.delta;
            existing.chunksReceived += 1;
          } else {
            pendingTextDeltasRef.current.set(pendingKey, {
              chatId,
              runId: event.id,
              delta: event.delta,
              chunksReceived: 1,
            });
          }
          scheduleTextDeltaFlush();
          return;
        }

        const pendingBatches = takePendingTextDeltaBatches(
          pendingTextDeltasRef.current,
          { chatId },
        );
        if (pendingTextDeltasRef.current.size === 0) {
          clearScheduledTextDeltaFlush();
        }

        setState((prev) => {
          const updateStartedAt = startSubAgentProfileMeasure();
          try {
            const runsByChatWithPending = applyTextDeltaBatchesToRunsByChat(
              prev.runsByChat,
              pendingBatches,
            );
            const currentRunsByChat = runsByChatWithPending ?? prev.runsByChat;
            const chatRuns = currentRunsByChat[chatId] ?? [];
            const updated = applyEvent(chatRuns, event, chatId);
            if (updated === chatRuns) {
              return runsByChatWithPending
                ? { ...prev, runsByChat: runsByChatWithPending }
                : prev;
            }
            const nextRunsByChat = runsByChatWithPending ?? { ...prev.runsByChat };
            nextRunsByChat[chatId] = updated;
            return {
              ...prev,
              runsByChat: nextRunsByChat,
            };
          } finally {
            recordSubAgentUpdateDuration(`store.applyEvent.${event.type}`, updateStartedAt);
          }
        });
      } finally {
        recordSubAgentHandlerDuration(`store.processEvent.${event.type}`, handlerStartedAt);
      }
    },
    [clearScheduledTextDeltaFlush, scheduleTextDeltaFlush],
  );

  const clearRuns = useCallback((chatId: string) => {
    clearPendingTextDeltasForChat(chatId);
    removeEventFingerprintsForChat(processedEventFingerprintsRef.current, chatId);
    setState((prev) => {
      const { [chatId]: _, ...rest } = prev.runsByChat;
      return { ...prev, runsByChat: rest };
    });
  }, [clearPendingTextDeltasForChat]);

  const selectRun = useCallback((runId: string | null) => {
    setState((prev) => ({ ...prev, selectedRunId: runId }));
  }, []);

  const persistRuns = useCallback(
    (chatId: string, folderName: string): Promise<void> => {
      const doWrite = async () => {
        const storedRuns = stateRef.current.runsByChat[chatId];
        if (!storedRuns && !hasPendingTextDeltasForChat(pendingTextDeltasRef.current, chatId)) return;

        const runs = getRunsWithPendingTextDeltas(
          storedRuns ?? [],
          chatId,
          pendingTextDeltasRef.current,
        );
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
    (chatId: string) => {
      const stored = state.runsByChat[chatId];
      const pending = pendingTextDeltasRef.current;
      const hasPending = hasPendingTextDeltasForChat(pending, chatId);
      if (!stored && !hasPending) return EMPTY_SUB_AGENT_RUNS;
      if (!hasPending) return stored ?? EMPTY_SUB_AGENT_RUNS;
      return getRunsWithPendingTextDeltas(stored ?? [], chatId, pending);
    },
    [state.runsByChat],
  );

  const getSelectedRun = useCallback(
    (chatId: string) => {
      if (!state.selectedRunId) return null;
      const stored = state.runsByChat[chatId];
      if (!stored) return null;
      const run = stored.find((r) => r.id === state.selectedRunId);
      if (run) return run;
      const pending = pendingTextDeltasRef.current;
      if (!hasPendingTextDeltasForChat(pending, chatId)) return null;
      const withPending = getRunsWithPendingTextDeltas(stored, chatId, pending);
      return withPending.find((r) => r.id === state.selectedRunId) ?? null;
    },
    [state.runsByChat, state.selectedRunId],
  );

  const actions = useMemo<SubAgentStoreActions>(() => ({
    loadRuns,
    loadRunsFromDisk,
    processEvent,
    clearRuns,
    selectRun,
    persistRuns,
  }), [
    clearRuns,
    loadRuns,
    loadRunsFromDisk,
    persistRuns,
    processEvent,
    selectRun,
  ]);

  const readers = useMemo<SubAgentStoreReaders>(() => ({
    getRuns,
    getSelectedRun,
  }), [getRuns, getSelectedRun]);

  return (
    <SubAgentActionsContext.Provider value={actions}>
      <SubAgentRunsByChatContext.Provider value={state.runsByChat}>
        <SubAgentSelectedRunIdContext.Provider value={state.selectedRunId}>
          <SubAgentReadersContext.Provider value={readers}>
            <SubAgentStateContext.Provider value={state}>
              {children}
            </SubAgentStateContext.Provider>
          </SubAgentReadersContext.Provider>
        </SubAgentSelectedRunIdContext.Provider>
      </SubAgentRunsByChatContext.Provider>
    </SubAgentActionsContext.Provider>
  );
}

export function useSubAgentState(): SubAgentStoreState {
  const state = useContext(SubAgentStateContext);
  if (!state) {
    throw new Error("useSubAgentState must be used within a SubAgentProvider");
  }
  return state;
}

export function useSubAgentRunsByChat(): Record<string, SubAgentRun[]> {
  const runsByChat = useContext(SubAgentRunsByChatContext);
  if (runsByChat === null) {
    throw new Error("useSubAgentRunsByChat must be used within a SubAgentProvider");
  }
  return runsByChat;
}

export function useSubAgentSelectedRunId(): string | null {
  return useContext(SubAgentSelectedRunIdContext);
}

export function useSubAgentActions(): SubAgentStoreActions {
  const actions = useContext(SubAgentActionsContext);
  if (!actions) {
    throw new Error("useSubAgentActions must be used within a SubAgentProvider");
  }
  return actions;
}

export function useSubAgentReaders(): SubAgentStoreReaders {
  const readers = useContext(SubAgentReadersContext);
  if (!readers) {
    throw new Error("useSubAgentReaders must be used within a SubAgentProvider");
  }
  return readers;
}

export function useSubAgentStore(): SubAgentStore {
  const state = useSubAgentState();
  const actions = useSubAgentActions();
  const readers = useSubAgentReaders();
  return useMemo(
    () => ({ ...state, ...actions, ...readers }),
    [actions, readers, state],
  );
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
      return applyTextDeltaBatch(runs, event.id, event.delta, 1, parentChatId);
    }

    case "tool-call": {
      const withRun = ensureRun(runs, event.id, parentChatId, event.type);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        toolCalls: [...run.toolCalls, event.toolCall],
      }));
    }

    case "tool-result": {
      const withRun = ensureRun(runs, event.id, parentChatId, event.type);
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
      const withRun = ensureRun(runs, event.id, parentChatId, event.type);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        status: "completed",
        finishedAt: new Date().toISOString(),
      }));
    }

    case "report": {
      const withRun = ensureRun(runs, event.id, parentChatId, event.type);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        report: event.report,
      }));
    }

    case "error": {
      const withRun = ensureRun(runs, event.id, parentChatId, event.type);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: event.error,
      }));
    }

    case "cancelled": {
      const withRun = ensureRun(runs, event.id, parentChatId, event.type);
      return updateRun(withRun, event.id, (run) => ({
        ...run,
        status: "cancelled",
        finishedAt: new Date().toISOString(),
      }));
    }
    default: {
      console.warn("[sub-agent-store] ignoring unknown sub-agent event type", {
        type: (event as { type: string }).type,
      });
      return runs;
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
  eventType: string,
  warnOnStub = true,
): SubAgentRun[] {
  if (runs.some((run) => run.id === id)) return runs;
  if (warnOnStub) {
    console.warn("[sub-agent-store] creating stub run for out-of-order event", { id, eventType });
  }
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

function applyTextDeltaBatch(
  runs: SubAgentRun[],
  id: string,
  delta: string,
  chunksReceived: number,
  parentChatId: string,
  warnOnStub = true,
): SubAgentRun[] {
  const withRun = ensureRun(runs, id, parentChatId, "text-delta", warnOnStub);
  return updateRun(withRun, id, (run) => {
    const next = run.text + delta;
    return {
      ...run,
      status: run.status === "running" ? "streaming" as const : run.status,
      text:
        next.length > MAX_SUB_AGENT_TEXT_LENGTH
          ? next.slice(0, MAX_SUB_AGENT_TEXT_LENGTH)
          : next,
      chunksReceived: run.chunksReceived + chunksReceived,
    };
  });
}

function getPendingTextDeltaKey(chatId: string, runId: string): string {
  return `${chatId}:${runId}`;
}

function takePendingTextDeltaBatches(
  pendingTextDeltas: Map<string, PendingTextDelta>,
  filter: PendingTextDeltaFilter,
): PendingTextDelta[] {
  const batches: PendingTextDelta[] = [];

  for (const [key, batch] of pendingTextDeltas) {
    if (filter.chatId && batch.chatId !== filter.chatId) continue;
    if (filter.runId && batch.runId !== filter.runId) continue;

    batches.push(batch);
    pendingTextDeltas.delete(key);
  }

  return batches;
}

function applyTextDeltaBatchesToRunsByChat(
  runsByChat: Record<string, SubAgentRun[]>,
  batches: PendingTextDelta[],
): Record<string, SubAgentRun[]> | null {
  let nextRunsByChat: Record<string, SubAgentRun[]> | null = null;

  for (const batch of batches) {
    const currentRunsByChat = nextRunsByChat ?? runsByChat;
    const chatRuns = currentRunsByChat[batch.chatId] ?? [];
    const updated = applyTextDeltaBatch(
      chatRuns,
      batch.runId,
      batch.delta,
      batch.chunksReceived,
      batch.chatId,
    );

    if (updated === chatRuns) continue;

    nextRunsByChat ??= { ...runsByChat };
    nextRunsByChat[batch.chatId] = updated;
  }

  return nextRunsByChat;
}

function getRunsWithPendingTextDeltas(
  runs: SubAgentRun[],
  chatId: string,
  pendingTextDeltas: Map<string, PendingTextDelta>,
): SubAgentRun[] {
  let nextRuns = runs;
  for (const batch of pendingTextDeltas.values()) {
    if (batch.chatId !== chatId) continue;
    nextRuns = applyTextDeltaBatch(
      nextRuns,
      batch.runId,
      batch.delta,
      batch.chunksReceived,
      chatId,
      false,
    );
  }
  return nextRuns;
}

function hasPendingTextDeltasForChat(
  pendingTextDeltas: Map<string, PendingTextDelta>,
  chatId: string,
): boolean {
  for (const batch of pendingTextDeltas.values()) {
    if (batch.chatId === chatId) return true;
  }
  return false;
}

function pruneEventFingerprints(fingerprints: Set<string>): void {
  if (fingerprints.size <= 10_000) return;

  const toDelete: string[] = [];
  let i = 0;
  for (const value of fingerprints) {
    if (i >= 5000) break;
    toDelete.push(value);
    i++;
  }
  for (const value of toDelete) fingerprints.delete(value);
}

function removeEventFingerprintsForChat(
  fingerprints: Set<string>,
  chatId: string,
): void {
  const prefix = `${chatId}:`;
  for (const fingerprint of fingerprints) {
    if (fingerprint.startsWith(prefix)) {
      fingerprints.delete(fingerprint);
    }
  }
}

function getEventFingerprint(chatId: string, event: SubAgentEvent): string | null {
  if (typeof event.sequence === "number") {
    return `${chatId}:seq:${event.sequence}`;
  }

  switch (event.type) {
    case "start":
      return `${chatId}:start:${event.id}`;
    case "text-delta":
      return null;
    case "tool-call": {
      const tc = event.toolCall;
      if (!tc || typeof tc !== "object") return null;
      return `${chatId}:tc:${event.id}:${tc.toolCallId ?? tc.toolName ?? ""}`;
    }
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
