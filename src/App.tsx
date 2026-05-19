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
import { load } from "@tauri-apps/plugin-store";
import { questionsTool } from "./tools/questions-tool";
import { braveSearchTool, setBraveApiKey } from "./tools/brave-search-tool";
import { QuestionsToolUI } from "./components/assistant-ui/questions-tool";
import { Thread } from "./components/assistant-ui/thread";

declare global {
  interface Window {
    __mockQuestions?: boolean;
    __logs?: Array<Record<string, unknown>>;
  }
}

function createMockQuestionsStream() {
  const args = {
    questions: [
      {
        question: "Which color do you prefer?",
        candidates: [
          { label: "Red", value: "red" },
          { label: "Blue", value: "blue" },
        ],
      },
    ],
  };

  const callId = "call_mock_" + Date.now();
  const msgId = "msg_mock_" + Date.now();
  const textId = "text_mock_" + Date.now();

  const parts = [
    { type: "start" as const, messageId: msgId },
    {
      type: "text-start" as const,
      id: textId,
    },
    {
      type: "text-delta" as const,
      id: textId,
      delta: "I need one clarification before I continue.",
    },
    {
      type: "text-end" as const,
      id: textId,
    },
    {
      type: "tool-input-start" as const,
      toolCallId: callId,
      toolName: "askQuestions",
    },
    {
      type: "tool-input-available" as const,
      toolCallId: callId,
      toolName: "askQuestions",
      input: args,
    },
    { type: "finish" as const, finishReason: "tool-calls" as const },
  ];

  return new ReadableStream({
    start(controller) {
      parts.forEach((part, i) => {
        setTimeout(() => {
          controller.enqueue(part);
          if (i === parts.length - 1) {
            controller.close();
          }
        }, (i + 1) * 100);
      });
    },
  });
}

function createMockFollowUpStream() {
  const msgId = "msg_followup_" + Date.now();
  const textId = "txt_" + Date.now();

  const parts = [
    { type: "start" as const, messageId: msgId },
    {
      type: "text-start" as const,
      id: textId,
    },
    {
      type: "text-delta" as const,
      id: textId,
      delta: "Thanks for your answer! Great choice.",
    },
    {
      type: "text-end" as const,
      id: textId,
    },
    { type: "finish" as const, finishReason: "stop" as const },
  ];

  return new ReadableStream({
    start(controller) {
      parts.forEach((part, i) => {
        setTimeout(() => {
          controller.enqueue(part);
          if (i === parts.length - 1) {
            controller.close();
          }
        }, (i + 1) * 100);
      });
    },
  });
}


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
    if (typeof window !== "undefined" && window.__mockQuestions) {
      if (typeof window !== "undefined") {
        window.__logs = window.__logs || [];
        window.__logs.push({ fn: "sendMessages", hasToolResult: messages.some(m => m.parts.some(p => isToolUIPart(p) && p.state === "output-available")) });
      }
      const hasToolResult = messages.some((m) =>
        m.parts.some(
          (p) => isToolUIPart(p) && p.state === "output-available",
        ),
      );
      if (hasToolResult) {
        return createMockFollowUpStream();
      }
      return createMockQuestionsStream();
    }

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

function shouldContinueAfterToolResult({ messages }: { messages: UIMessage[] }) {
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
    (part) => part.state === "output-available" || part.state === "output-error",
  );
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

export default App;
