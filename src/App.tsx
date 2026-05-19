import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import {
  streamText,
  convertToModelMessages,
  type ChatTransport,
  type UIMessage,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { load } from "@tauri-apps/plugin-store";
import { questionsTool } from "./tools/questions-tool";
import { braveSearchTool, setBraveApiKey } from "./tools/brave-search-tool";
import { QuestionsToolUI } from "./components/assistant-ui/questions-tool";
import { Thread } from "./components/assistant-ui/thread";


class DirectTransport implements ChatTransport<UIMessage> {
  constructor(private getApiKey: () => string) {}

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
      model: openrouter("openrouter/free"),
      messages: await convertToModelMessages(messages),
      tools: { askQuestions: questionsTool, braveSearch: braveSearchTool },
      abortSignal,
    });
    return result.toUIMessageStream();
  }

  reconnectToStream(): Promise<ReadableStream | null> {
    return Promise.resolve(null);
  }
}

function App() {
  const [apiKey, setApiKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [braveApiKey, setBraveApiKeyState] = useState("");
  const [braveKeyInput, setBraveKeyInput] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const store = await load("settings.json", { autoSave: false } as any);
        const key = await store.get<string>("openrouter_api_key");
        if (key) {
          setApiKey(key);
          setKeyInput(key);
        }
        const braveKey = await store.get<string>("brave_api_key");
        if (braveKey) {
          setBraveApiKeyState(braveKey);
          setBraveKeyInput(braveKey);
          setBraveApiKey(braveKey);
        }
      } catch {}
    })();
  }, []);

  async function saveKey() {
    const store = await load("settings.json", { autoSave: false } as any);
    await store.set("openrouter_api_key", keyInput);
    await store.save();
    setApiKey(keyInput);
  }

  async function saveBraveKey() {
    const store = await load("settings.json", { autoSave: false } as any);
    await store.set("brave_api_key", braveKeyInput);
    await store.save();
    setBraveApiKeyState(braveKeyInput);
    setBraveApiKey(braveKeyInput);
  }

  if (!apiKey) {
    return (
      <main className="flex flex-col items-center justify-center pt-[10vh] text-center">
        <h1 className="text-2xl font-bold">Deep Search</h1>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveKey();
          }}
        >
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.currentTarget.value)}
            placeholder="OpenRouter API Key"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={!keyInput}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save Key
          </button>
        </form>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveBraveKey();
          }}
        >
          <input
            type="password"
            value={braveKeyInput}
            onChange={(e) => setBraveKeyInput(e.currentTarget.value)}
            placeholder="Brave Search API Key"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm outline-none focus:border-blue-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={!braveKeyInput}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Save Key
          </button>
        </form>
      </main>
    );
  }

  return <Chat apiKey={apiKey} braveApiKey={braveApiKey} />;
}

function Chat({ apiKey, braveApiKey }: { apiKey: string; braveApiKey: string }) {
  const apiKeyRef = useRef(apiKey);
  apiKeyRef.current = apiKey;

  const braveApiKeyRef = useRef(braveApiKey);
  braveApiKeyRef.current = braveApiKey;

  const transportRef = useRef(new DirectTransport(() => apiKeyRef.current));

  useEffect(() => {
    if (braveApiKeyRef.current) {
      setBraveApiKey(braveApiKeyRef.current);
    }
  }, [braveApiKey]);

  const chat = useChat({ transport: transportRef.current });
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

export default App;
