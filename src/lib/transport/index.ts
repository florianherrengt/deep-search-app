import { isToolUIPart, type ChatTransport, type UIMessage } from "ai";
import {
  createChatLanguageModel,
  type ChatModelConfig,
} from "@/lib/chat-providers";
import { SafePathSegmentSchema } from "@/lib/app-file-storage";
import { createGuardedStream } from "./guarded-stream";
import type { SearchToolKeys } from "./tool-registry";

export { createGuardedStream } from "./guarded-stream";
export type { SearchToolKeys } from "./tool-registry";

export class DirectTransport implements ChatTransport<UIMessage> {
  private researchFolder: string | null = null;

  constructor(
    private getChatModel: () => ChatModelConfig | null,
    private getResearchApiKey: () => string,
    private getSearchKeys: () => SearchToolKeys,
    researchFolder?: string | null,
    private onResearchFolderChange?: (folderName: string) => void,
  ) {
    this.researchFolder = researchFolder
      ? SafePathSegmentSchema.parse(researchFolder)
      : null;
  }

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
    const chatModel = this.getChatModel();
    if (!chatModel) {
      throw new Error("No chat model is configured.");
    }

    const model = createChatLanguageModel(chatModel);

    return createGuardedStream({
      model,
      researchFolder: this.researchFolder,
      apiKey: this.getResearchApiKey(),
      messages,
      abortSignal,
      searchKeys: this.getSearchKeys(),
      onResearchFolderChange: (folderName) => {
        this.researchFolder = folderName;
        this.onResearchFolderChange?.(folderName);
      },
    });
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

  const parts = last.parts;
  const lastToolIndex = parts.reduceRight(
    (found, part, i) => (found === -1 && isToolUIPart(part) ? i : found),
    -1,
  );
  if (lastToolIndex === -1) return false;

  const hasTextAfterTool = parts
    .slice(lastToolIndex + 1)
    .some((p) => p.type === "text" && p.text.length > 0);
  if (hasTextAfterTool) return false;

  return parts
    .filter(isToolUIPart)
    .every((p) => p.state === "output-available" || p.state === "output-error");
}
