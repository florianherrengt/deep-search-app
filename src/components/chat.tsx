import { useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { QuestionsToolUI } from "./assistant-ui/questions-tool";
import { Thread } from "./assistant-ui/thread";
import {
  DirectTransport,
  shouldContinueAfterToolResult,
} from "@/lib/transport";
import { saveResearchChatMessages } from "@/lib/research-history";

const DEFAULT_MODEL = "openrouter/free";

export function Chat({
  apiKey,
  defaultModel,
  chatId,
  researchFolder,
  initialMessages = [],
  onResearchFolderChange,
}: {
  apiKey: string;
  defaultModel: string;
  chatId: string;
  researchFolder: string | null;
  initialMessages?: UIMessage[];
  onResearchFolderChange?: (folderName: string) => void;
}) {
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  const modelRef = useRef(defaultModel.trim() || DEFAULT_MODEL);
  modelRef.current = defaultModel.trim() || DEFAULT_MODEL;

  const researchFolderRef = useRef(researchFolder);
  if (researchFolder) {
    researchFolderRef.current = researchFolder;
  }

  const transportRef = useRef(
    new DirectTransport(
      () => apiKeyRef.current,
      () => modelRef.current,
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

      void saveResearchChatMessages(folderName, messages);
    },
  });
  const runtime = useAISDKRuntime(chat);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <QuestionsToolUI />
      <div className="h-full">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}
