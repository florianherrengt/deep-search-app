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
import { useSubAgentStore } from "@/lib/sub-agent-store";
import type { SubAgentEvent } from "@/lib/sub-agent-types";
import { isRecord } from "@/lib/json";

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
      );
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

  const subAgentStore = useSubAgentStore();
  const processedPartsByMessageRef = useRef<Record<string, number>>({});

  useEffect(() => {
    for (const message of chat.messages) {
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

        subAgentStore.processEvent(researchChatId, dataPart.data as unknown as SubAgentEvent);
        processedPartsByMessageRef.current[msgId] = i + 1;
      }
    }
  }, [chat.messages, researchChatId]);

  useEffect(() => {
    if (!researchChatId) return;
    if (researchFolder) {
      void subAgentStore.loadRunsFromDisk(researchChatId, researchFolder);
    } else {
      subAgentStore.loadRuns(researchChatId, []);
    }
  }, [researchChatId]);

  useEffect(() => {
    const folderName = researchFolderRef.current;
    if (folderName && researchChatId) {
      void subAgentStore.persistRuns(researchChatId, folderName);
    }
  }, [chat.messages, researchChatId]);

  const runtime = useAISDKRuntime(chat);
  const tokenCount = useMemo(
    () => getCurrentTokenCount(chat.messages),
    [chat.messages],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <QuestionsToolUI />
      <Box style={{ height: "100%" }}>
        {chat.error && (
          <Alert variant="light" color="red" title="Connection Error" withCloseButton mb="xs">
            {chat.error.message}
          </Alert>
        )}
        <Thread
          models={modelsWithContextWindows}
          selectedModelId={selectedModelId}
          onSelectedModelIdChange={handleModelChange}
          onConfigure={onConfigure}
          hasEnabledModel={enabledModels.length > 0}
          tokenCount={tokenCount}
        />
      </Box>
    </AssistantRuntimeProvider>
  );
}
