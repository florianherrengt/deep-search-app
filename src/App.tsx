import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  streamText,
  convertToModelMessages,
  isToolUIPart,
  type ChatTransport,
  type UIMessage,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { SettingsProvider, useSettings } from "@/hooks/use-settings";
import { setupMenu } from "@/lib/setup-menu";
import { questionsTool } from "./tools/questions-tool";
import {
  braveSearchTool,
  setBraveApiKey,
} from "./tools/brave-search-tool";
import {
  exaSearchTool,
  setExaApiKey,
} from "./tools/exa-search-tool";
import {
  serperSearchTool,
  setSerperApiKey,
} from "./tools/serper-search-tool";
import {
  tavilySearchTool,
  setTavilyApiKey,
} from "./tools/tavily-search-tool";
import {
  searxngSearchTool,
  setSearXNGBaseUrl,
} from "./tools/searxng-search-tool";
import { QuestionsToolUI } from "./components/assistant-ui/questions-tool";
import { Thread } from "./components/assistant-ui/thread";
import { SettingsDialog } from "./components/settings-dialog";

declare global {
  interface Window {
    __mockQuestions?: boolean;
    __logs?: Array<Record<string, unknown>>;
  }
}

class DirectTransport implements ChatTransport<UIMessage> {
  constructor(
    private getApiKey: () => string,
    private getModel: () => string,
  ) {}

  async sendMessages({
    messages,
    abortSignal,
  }: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }) {
    const openrouter = createOpenRouter({ apiKey: this.getApiKey() });
    const result = streamText({
      model: openrouter(this.getModel()),
      messages: await convertToModelMessages(messages),
      tools: {
        askQuestions: questionsTool,
        braveSearch: braveSearchTool,
        exaSearch: exaSearchTool,
        serperSearch: serperSearchTool,
        tavilySearch: tavilySearchTool,
        searxngSearch: searxngSearchTool,
      },
      abortSignal,
    });
    return result.toUIMessageStream();
  }

  reconnectToStream(): Promise<ReadableStream | null> {
    return Promise.resolve(null);
  }
}

function shouldContinueAfterToolResult({
  messages,
}: {
  messages: UIMessage[];
}) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;

  let lastToolPartIndex = -1;
  for (let index = last.parts.length - 1; index >= 0; index -= 1) {
    if (isToolUIPart(last.parts[index])) {
      lastToolPartIndex = index;
      break;
    }
  }
  if (lastToolPartIndex === -1) return false;

  const partsAfterTool = last.parts.slice(lastToolPartIndex + 1);
  const hasTextAfterTool = partsAfterTool.some(
    (part) => part.type === "text" && part.text.length > 0,
  );
  if (hasTextAfterTool) return false;

  const toolParts = last.parts.filter(isToolUIPart);
  return toolParts.every(
    (part) =>
      part.state === "output-available" || part.state === "output-error",
  );
}

function AppInner() {
  const { settings, loading } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setupMenu(() => setDialogOpen(true));
  }, []);

  useEffect(() => {
    if (settings.brave_api_key) setBraveApiKey(settings.brave_api_key);
    if (settings.exa_api_key) setExaApiKey(settings.exa_api_key);
    if (settings.serper_api_key) setSerperApiKey(settings.serper_api_key);
    if (settings.tavily_api_key) setTavilyApiKey(settings.tavily_api_key);
    if (settings.searxng_url) setSearXNGBaseUrl(settings.searxng_url);
  }, [settings]);

  if (loading) return null;

  if (!settings.openrouter_api_key) {
    return (
      <>
        <main className="flex flex-col items-center justify-center pt-[10vh] text-center">
          <h1 className="text-2xl font-bold">Deep Search</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Press{" "}
            <kbd className="rounded border px-1.5 py-0.5 text-xs">
              Cmd+,
            </kbd>{" "}
            to open settings and add your OpenRouter API key.
          </p>
        </main>
        <SettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    );
  }

  return (
    <>
      <Chat
        apiKey={settings.openrouter_api_key}
        defaultModel={settings.default_model ?? ""}
      />
      <SettingsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function Chat({
  apiKey,
  defaultModel,
}: {
  apiKey: string;
  defaultModel: string;
}) {
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  const modelRef = useRef(defaultModel);
  modelRef.current = defaultModel;

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
      <div className="h-screen">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
}

function App() {
  return (
    <SettingsProvider>
      <AppInner />
    </SettingsProvider>
  );
}

export default App;
