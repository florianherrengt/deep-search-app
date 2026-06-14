import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Box, Alert } from "@mantine/core";
import type { UIMessage } from "ai";
import { QuestionsToolUI } from "./assistant-ui/questions-tool";
import { Thread } from "./assistant-ui/thread";
import {
  DirectTransport,
  shouldContinueAfterToolResult,
  type SearchToolKeys,
  type EmbeddingConfig,
  type RerankerConfig,
} from "@/lib/transport";
import type { Currency } from "@/lib/settings-store";
import {
  fetchChatModelContextWindowTokens,
  type ChatModelConfig,
  type ConfiguredChatModelOption,
} from "@/lib/chat-providers";
import { saveResearchChatMessages } from "@/lib/research-history";
import { getCurrentTokenCount } from "@/lib/token-usage";
import { hasPendingQuestionTool } from "@/lib/chat-attention";
import { useSubAgentActions, useSubAgentRunsByChat } from "@/lib/sub-agent-store";
import type { SubAgentEvent, SubAgentRun } from "@/lib/sub-agent-types";
import { setDirectEventHandler } from "@/lib/sub-agent-emitter";
import { isRecord } from "@/lib/json";
import { useSubAgentRenderCounter } from "@/lib/sub-agent-profiler";

const EMPTY_SUB_AGENT_RUNS: SubAgentRun[] = [];

export function Chat({
  sessionId,
  modelOptions,
  defaultModelId,
  researchApiKey,
  runtimeChatId,
  researchChatId,
  researchFolder,
  selectedModelId,
  initialMessages = [],
  onResearchFolderChange,
  onResearchChatSaved,
  onRunStateChange,
  onAttentionStateChange,
  onSelectedModelIdChange,
  onModelChange,
  onConfigure,
  searchKeys,
  currency,
  embeddingConfig,
  rerankerConfig,
}: {
  sessionId: string;
  modelOptions: ConfiguredChatModelOption[];
  defaultModelId: string;
  researchApiKey: string;
  runtimeChatId: string;
  researchChatId: string;
  researchFolder: string | null;
  selectedModelId: string;
  initialMessages?: UIMessage[];
  onResearchFolderChange?: (
    sessionId: string,
    folderName: string,
  ) => void;
  onResearchChatSaved?: (folderName: string, chatId: string) => void;
  onRunStateChange?: (sessionId: string, running: boolean) => void;
  onAttentionStateChange?: (sessionId: string, needsAttention: boolean) => void;
  onSelectedModelIdChange: (modelId: string) => void;
  onModelChange?: (model: ConfiguredChatModelOption) => void;
  onConfigure?: () => void;
  searchKeys: SearchToolKeys;
  currency: Currency;
  embeddingConfig: EmbeddingConfig;
  rerankerConfig: RerankerConfig;
}) {
  useSubAgentRenderCounter("Chat");

  const enabledModels = useMemo(
    () => modelOptions.filter((option) => !option.disabled),
    [modelOptions],
  );
  const [fetchedContextWindows, setFetchedContextWindows] = useState<
    Record<string, number | null>
  >({});
  const modelsWithContextWindows = useMemo(
    () =>
      enabledModels.map((option) => {
        const fetchedContextWindow = fetchedContextWindows[option.id];
        if (
          option.contextWindowTokens ||
          fetchedContextWindow === undefined ||
          fetchedContextWindow === null
        ) {
          return option;
        }

        return {
          ...option,
          contextWindowTokens: fetchedContextWindow,
        };
      }),
    [enabledModels, fetchedContextWindows],
  );
  const firstEnabledModelId = enabledModels[0]?.id ?? "";
  const resolvedDefaultModelId =
    enabledModels.some((option) => option.id === defaultModelId)
      ? defaultModelId
      : firstEnabledModelId;

  useEffect(() => {
    const missingModels = enabledModels.filter(
      (option) =>
        !option.contextWindowTokens &&
        fetchedContextWindows[option.id] === undefined,
    );
    if (missingModels.length === 0) return;

    const abortController = new AbortController();
    void Promise.all(
      missingModels.map(async (option) => ({
        id: option.id,
        contextWindowTokens:
          (await fetchChatModelContextWindowTokens(option, {
            abortSignal: abortController.signal,
          })) ?? null,
      })),
    ).then((results) => {
      if (abortController.signal.aborted) return;

      setFetchedContextWindows((current) => {
        let changed = false;
        const next = { ...current };

        for (const result of results) {
          if (next[result.id] !== undefined) continue;
          next[result.id] = result.contextWindowTokens;
          changed = true;
        }

        return changed ? next : current;
      });
    }).catch((err) => {
      if (!abortController.signal.aborted) {
        console.error("[chat] Failed to fetch context windows:", err);
      }
    });

    return () => {
      abortController.abort();
    };
  }, [enabledModels, fetchedContextWindows]);

  useEffect(() => {
    if (
      resolvedDefaultModelId &&
      !enabledModels.some((option) => option.id === selectedModelId)
    ) {
      onSelectedModelIdChange(resolvedDefaultModelId);
    }
  }, [
    enabledModels,
    onSelectedModelIdChange,
    resolvedDefaultModelId,
    selectedModelId,
  ]);

  const modelOptionsRef = useRef(modelOptions);
  modelOptionsRef.current = modelOptions;

  const selectedModelIdRef = useRef(selectedModelId);
  selectedModelIdRef.current = selectedModelId;

  const researchApiKeyRef = useRef(researchApiKey);
  researchApiKeyRef.current = researchApiKey;

  const embeddingConfigRef = useRef(embeddingConfig);
  embeddingConfigRef.current = embeddingConfig;

  const rerankerConfigRef = useRef(rerankerConfig);
  rerankerConfigRef.current = rerankerConfig;

  const effectiveSearchKeys = useMemo(
    () => ({ ...searchKeys, currency }),
    [currency, searchKeys],
  );

  const searchKeysRef = useRef(effectiveSearchKeys);
  searchKeysRef.current = effectiveSearchKeys;

  const researchFolderRef = useRef(researchFolder);
  researchFolderRef.current = researchFolder;

  const researchChatIdRef = useRef(researchChatId);
  researchChatIdRef.current = researchChatId;

  const onResearchChatSavedRef = useRef(onResearchChatSaved);
  onResearchChatSavedRef.current = onResearchChatSaved;

  const onResearchFolderChangeRef = useRef(onResearchFolderChange);
  onResearchFolderChangeRef.current = onResearchFolderChange;

  function getSelectedChatModel(): ChatModelConfig | null {
    const selected = modelOptionsRef.current.find(
      (option) => option.id === selectedModelIdRef.current,
    );
    if (!selected || selected.disabled) return null;

    return {
      provider: selected.provider,
      apiKey: selected.apiKey,
      model: selected.model,
      baseURL: selected.baseURL,
    };
  }

  function handleModelChange(modelId: string) {
    const selected = modelOptions.find(
      (option) => option.id === modelId && !option.disabled,
    );
    if (!selected) return;

    onSelectedModelIdChange(modelId);
    onModelChange?.(selected);
  }

  const transportRef = useRef(
    new DirectTransport(
      getSelectedChatModel,
      () => embeddingConfigRef.current,
      () => rerankerConfigRef.current,
      () => searchKeysRef.current,
      researchChatId,
      researchFolder,
      (folderName: string) => {
        researchFolderRef.current = folderName;
        onResearchFolderChangeRef.current?.(sessionId, folderName);
      },
    ),
  );

  useEffect(() => {
    transportRef.current.setResearchFolder(researchFolder);
    researchFolderRef.current = researchFolder;
  }, [researchFolder]);

  const chat = useChat({
    id: runtimeChatId,
    messages: initialMessages,
    transport: transportRef.current,
    sendAutomaticallyWhen: shouldContinueAfterToolResult,
    onError: (error) => {
      console.error("[chat] Transport error:", error);
    },
    onFinish: ({ messages }) => {
      const folderName = researchFolderRef.current;
      if (!folderName) return;

      const savedChatId = researchChatIdRef.current;
      void saveResearchChatMessages(folderName, savedChatId, messages).then(
        () => {
          onResearchChatSavedRef.current?.(folderName, savedChatId);
        },
      ).catch((err) => {
        console.error("[chat] Failed to save research chat messages:", err);
      });
    },
  });

  const isRunning = chat.status === "submitted" || chat.status === "streaming";
  useEffect(() => {
    onRunStateChange?.(sessionId, isRunning);
  }, [isRunning, onRunStateChange, sessionId]);

  const needsAttention = useMemo(
    () => hasPendingQuestionTool(chat.messages),
    [chat.messages],
  );
  useEffect(() => {
    onAttentionStateChange?.(sessionId, needsAttention);
  }, [needsAttention, onAttentionStateChange, sessionId]);

  const runtime = useAISDKRuntime(chat);
  const tokenCount = useMemo(
    () => getCurrentTokenCount(chat.messages),
    [chat.messages],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SubAgentEventBridge
        initialMessages={initialMessages}
        messages={chat.messages}
        researchChatId={researchChatId}
      />
      <SubAgentRunsLoader
        researchChatId={researchChatId}
        researchFolder={researchFolder}
      />
      <SubAgentRunsPersistence
        researchChatId={researchChatId}
        researchFolder={researchFolder}
      />
      <QuestionsToolUI />
      <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        {chat.error && (
          <Alert variant="light" color="red" title="Connection Error" withCloseButton mb="xs">
            {chat.error.message}
          </Alert>
        )}
        <div style={{ flex: 1, minHeight: 0 }}>
          <Thread
            models={modelsWithContextWindows}
            selectedModelId={selectedModelId}
            onSelectedModelIdChange={handleModelChange}
            onConfigure={onConfigure}
            hasEnabledModel={enabledModels.length > 0}
            tokenCount={tokenCount}
          />
        </div>
      </Box>
    </AssistantRuntimeProvider>
  );
}

function SubAgentEventBridge({
  initialMessages,
  messages,
  researchChatId,
}: {
  initialMessages: UIMessage[];
  messages: UIMessage[];
  researchChatId: string;
}) {
  useSubAgentRenderCounter("SubAgentEventBridge");
  const { processEvent } = useSubAgentActions();

  useEffect(() => {
    const handler = (event: SubAgentEvent) => {
      processEvent(researchChatId, event);
    };
    setDirectEventHandler(researchChatId, handler);
    return () => setDirectEventHandler(researchChatId, null);
  }, [processEvent, researchChatId]);

  const processedPartsByMessageRef = useRef<Record<string, number>>(
    getProcessedPartCounts(initialMessages),
  );
  const processedResearchChatIdRef = useRef(researchChatId);
  if (processedResearchChatIdRef.current !== researchChatId) {
    processedResearchChatIdRef.current = researchChatId;
    processedPartsByMessageRef.current = getProcessedPartCounts(initialMessages);
  }

  useEffect(() => {
    for (const message of messages) {
      if (!("parts" in message) || !Array.isArray(message.parts)) continue;
      if (!("id" in message) || typeof message.id !== "string") continue;

      const msgId = message.id;
      const startIdx = processedPartsByMessageRef.current[msgId] ?? 0;

      for (let i = startIdx; i < message.parts.length; i++) {
        const part = message.parts[i];
        if (!isRecord(part)) continue;
        const type = part.type as string;
        if (!type.startsWith("data-")) continue;
        const name = type.slice("data-".length);
        if (name !== "subagent_event") continue;

        const dataPart = part as { data: unknown };
        if (!isRecord(dataPart.data)) continue;

        processEvent(researchChatId, dataPart.data as unknown as SubAgentEvent);
        processedPartsByMessageRef.current[msgId] = i + 1;
      }
    }
  }, [messages, processEvent, researchChatId]);

  return null;
}

function SubAgentRunsLoader({
  researchChatId,
  researchFolder,
}: {
  researchChatId: string;
  researchFolder: string | null;
}) {
  useSubAgentRenderCounter("SubAgentRunsLoader");
  const { loadRuns, loadRunsFromDisk } = useSubAgentActions();

  useEffect(() => {
    if (!researchChatId) return;
    if (researchFolder) {
      void loadRunsFromDisk(researchChatId, researchFolder).catch((err) => {
        console.error("[chat] Failed to load sub-agent runs from disk:", err);
      });
    } else {
      loadRuns(researchChatId, []);
    }
  }, [loadRuns, loadRunsFromDisk, researchChatId, researchFolder]);

  return null;
}

function SubAgentRunsPersistence({
  researchChatId,
  researchFolder,
}: {
  researchChatId: string;
  researchFolder: string | null;
}) {
  useSubAgentRenderCounter("SubAgentRunsPersistence");
  const runsByChat = useSubAgentRunsByChat();
  const { persistRuns } = useSubAgentActions();
  const persistedTerminalRunsKeyRef = useRef<Record<string, string>>({});
  const subAgentRunsForChat = runsByChat[researchChatId] ?? EMPTY_SUB_AGENT_RUNS;

  useEffect(() => {
    if (!researchFolder || !researchChatId) return;

    const terminalRuns = subAgentRunsForChat.filter(
      (run) => run.status !== "running" && run.status !== "streaming",
    );
    if (terminalRuns.length === 0) return;

    const terminalRunsKey = terminalRuns
      .map((run) =>
        [
          run.id,
          run.status,
          run.finishedAt ?? "",
          run.text.length,
          run.toolCalls.length,
          run.error ?? "",
        ].join(":"),
      )
      .join("|");

    if (persistedTerminalRunsKeyRef.current[researchChatId] === terminalRunsKey) {
      return;
    }

    persistedTerminalRunsKeyRef.current[researchChatId] = terminalRunsKey;
    void persistRuns(researchChatId, researchFolder).catch((err) => {
      console.error("[chat] Failed to persist sub-agent runs:", err);
    });
  }, [persistRuns, researchChatId, researchFolder, subAgentRunsForChat]);

  return null;
}

function getProcessedPartCounts(messages: UIMessage[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    if (!Array.isArray(message.parts)) continue;
    counts[message.id] = message.parts.length;
  }
  return counts;
}
