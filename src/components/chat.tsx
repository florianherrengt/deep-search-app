import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { Box } from "@mantine/core";
import type { UIMessage } from "ai";
import { QuestionsToolUI } from "./assistant-ui/questions-tool";
import { Thread } from "./assistant-ui/thread";
import {
  DirectTransport,
  type ResearchFolderChangeOptions,
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

export function Chat({
  sessionId,
  modelOptions,
  defaultModelId,
  researchApiKey,
  runtimeChatId,
  researchChatId,
  researchFolder,
  isProvisionalResearchFolder = false,
  selectedModelId,
  initialMessages = [],
  onResearchFolderChange,
  onResearchChatSaved,
  onRunStateChange,
  onSelectedModelIdChange,
  onModelChange,
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
  isProvisionalResearchFolder?: boolean;
  selectedModelId: string;
  initialMessages?: UIMessage[];
  onResearchFolderChange?: (
    sessionId: string,
    folderName: string,
    options: ResearchFolderChangeOptions,
  ) => void;
  onResearchChatSaved?: (folderName: string, chatId: string) => void;
  onRunStateChange?: (sessionId: string, running: boolean) => void;
  onSelectedModelIdChange: (modelId: string) => void;
  onModelChange?: (model: ConfiguredChatModelOption) => void;
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
      isProvisionalResearchFolder,
      (folderName: string, options: ResearchFolderChangeOptions) => {
        researchFolderRef.current = folderName;
        onResearchFolderChangeRef.current?.(sessionId, folderName, options);
      },
    ),
  );

  useEffect(() => {
    transportRef.current.setResearchFolder(researchFolder, {
      isProvisional: isProvisionalResearchFolder,
    });
    researchFolderRef.current = researchFolder;
  }, [isProvisionalResearchFolder, researchFolder]);

  const chat = useChat({
    id: runtimeChatId,
    messages: initialMessages,
    transport: transportRef.current,
    sendAutomaticallyWhen: shouldContinueAfterToolResult,
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

  const runtime = useAISDKRuntime(chat);
  const tokenCount = getCurrentTokenCount(chat.messages);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <QuestionsToolUI />
      <Box style={{ height: "100%" }}>
        <Thread
          models={modelsWithContextWindows}
          selectedModelId={selectedModelId}
          onSelectedModelIdChange={handleModelChange}
          tokenCount={tokenCount}
        />
      </Box>
    </AssistantRuntimeProvider>
  );
}
