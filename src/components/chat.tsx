import { useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { QuestionsToolUI } from "./assistant-ui/questions-tool";
import { Thread } from "./assistant-ui/thread";
import {
  DirectTransport,
  shouldContinueAfterToolResult,
} from "@/lib/transport";

const DEFAULT_MODEL = "openrouter/free";

export function Chat({
  apiKey,
  defaultModel,
}: {
  apiKey: string;
  defaultModel: string;
}) {
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  const modelRef = useRef(defaultModel.trim() || DEFAULT_MODEL);
  modelRef.current = defaultModel.trim() || DEFAULT_MODEL;

  const transportRef = useRef(
    new DirectTransport(() => apiKeyRef.current, () => modelRef.current),
  );

  const chat = useChat({
    transport: transportRef.current,
    sendAutomaticallyWhen: shouldContinueAfterToolResult,
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
