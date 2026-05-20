import {
  streamText,
  convertToModelMessages,
  isToolUIPart,
  type ChatTransport,
  type UIMessage,
} from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { questionsTool } from "@/tools/questions-tool";
import {
  braveSearchTool,
  setBraveApiKey,
} from "@/tools/brave-search-tool";
import { duckDuckGoInstantAnswerTool } from "@/tools/duckduckgo-instant-answer-tool";
import {
  exaSearchTool,
  setExaApiKey,
} from "@/tools/exa-search-tool";
import {
  serperSearchTool,
  setSerperApiKey,
} from "@/tools/serper-search-tool";
import {
  tavilySearchTool,
  setTavilyApiKey,
} from "@/tools/tavily-search-tool";
import {
  searxngSearchTool,
  setSearXNGBaseUrl,
} from "@/tools/searxng-search-tool";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import systemPrompt from "./system-prompt.md?raw";

export { setBraveApiKey, setExaApiKey, setSerperApiKey, setTavilyApiKey, setSearXNGBaseUrl };

export class DirectTransport implements ChatTransport<UIMessage> {
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
    const model = openrouter(this.getModel());
    const result = streamText({
      model,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      tools: {
        ask_questions: questionsTool,
        brave_search: braveSearchTool,
        duckduckgo_instant_answer: duckDuckGoInstantAnswerTool,
        exa_search: exaSearchTool,
        serper_search: serperSearchTool,
        tavily_search: tavilySearchTool,
        searxng_search: searxngSearchTool,
        extract_page_content: createExtractPageContentTool(model),
      },
      abortSignal,
    });
    const stream = result.toUIMessageStream();

    if (abortSignal?.aborted) {
      stream.cancel();
    } else if (abortSignal) {
      abortSignal.addEventListener(
        "abort",
        () => {
          stream.cancel();
        },
        { once: true },
      );
    }

    return stream;
  }

  reconnectToStream(): Promise<ReadableStream | null> {
    return Promise.resolve(null);
  }
}

export function shouldContinueAfterToolResult({
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
