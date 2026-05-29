import { useEffect, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { QuestionsToolUI } from "./assistant-ui/questions-tool";
import { Thread } from "./assistant-ui/thread";
import {
  DirectTransport,
  shouldContinueAfterToolResult,
  type SearchToolKeys,
} from "@/lib/transport";
import {
  type ChatModelConfig,
  type ConfiguredChatModelOption,
} from "@/lib/chat-providers";
import { saveResearchChatMessages } from "@/lib/research-history";

export function Chat({
  modelOptions,
  defaultModelId,
  researchApiKey,
  chatId,
  researchChatId,
  researchFolder,
  selectedModelId,
  initialMessages = [],
  onResearchFolderChange,
  onResearchChatSaved,
  onSelectedModelIdChange,
  onModelChange,
  searchKeys,
}: {
  modelOptions: ConfiguredChatModelOption[];
  defaultModelId: string;
  researchApiKey: string;
  chatId: string;
  researchChatId: string;
  researchFolder: string | null;
  selectedModelId: string;
  initialMessages?: UIMessage[];
  onResearchFolderChange?: (folderName: string) => void;
  onResearchChatSaved?: (folderName: string, chatId: string) => void;
  onSelectedModelIdChange: (modelId: string) => void;
  onModelChange?: (model: ConfiguredChatModelOption) => void;
  searchKeys: SearchToolKeys;
}) {
  const enabledModels = useMemo(
    () => modelOptions.filter((option) => !option.disabled),
    [modelOptions],
  );
  const firstEnabledModelId = enabledModels[0]?.id ?? "";
  const resolvedDefaultModelId =
    enabledModels.some((option) => option.id === defaultModelId)
      ? defaultModelId
      : firstEnabledModelId;

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

  const searchKeysRef = useRef(searchKeys);
  searchKeysRef.current = searchKeys;

  const researchFolderRef = useRef(researchFolder);
  if (researchFolder) {
    researchFolderRef.current = researchFolder;
  }

  const researchChatIdRef = useRef(researchChatId);
  researchChatIdRef.current = researchChatId;

  const onResearchChatSavedRef = useRef(onResearchChatSaved);
  onResearchChatSavedRef.current = onResearchChatSaved;

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
      () => researchApiKeyRef.current,
      () => searchKeysRef.current,
      researchFolder,
      (folderName) => {
        researchFolderRef.current = folderName;
        onResearchFolderChange?.(folderName);
      },
    ),
  );

  const chat = useChat({
    id: chatId,
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
  const runtime = useAISDKRuntime(chat);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <QuestionsToolUI />
      <div className="h-full">
        <Thread
          models={enabledModels}
          selectedModelId={selectedModelId}
          onSelectedModelIdChange={handleModelChange}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}
