import {
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import {
  DirectTransport,
  shouldContinueAfterToolResult,
  type SearchToolKeys,
} from "@/lib/transport";
import { hasPendingQuestionTool } from "@/lib/chat-attention";
import {
  createResearchChatId,
  saveResearchChatMessages,
} from "@/lib/research-history";
import type { ChatModelConfig as AppChatModelConfig } from "@/lib/chat-providers";
import type { SubAgentEvent } from "@/lib/sub-agent-types";
import { setDirectEventHandler } from "@/lib/sub-agent-emitter";
import {
  answerPendingDeepSearchQuestions,
  createUserMessage,
  deepSearchRequestSchema,
  getDeepSearchResultText,
  getPendingDeepSearchQuestions,
  normalizeDeepSearchAssistantMessage,
  type DeepSearchResponse,
} from "./deep-search-protocol";

const DEFAULT_WAIT_MS = 25_000;

type SessionStatus =
  | "running"
  | "questions"
  | "done"
  | "failed"
  | "cancelled";

interface DeepSearchSession {
  sessionId: string;
  researchChatId: string;
  researchFolder: string | null;
  messages: UIMessage[];
  transport: DirectTransport;
  abortController: AbortController;
  status: SessionStatus;
  error?: string;
  result?: string;
  runPromise?: Promise<void>;
  waiters: Set<() => void>;
}

interface DeepSearchSessionManagerConfig {
  getChatModel: () => AppChatModelConfig | null;
  getSearchKeys: () => SearchToolKeys;
  onResearchFolderChange?: (
    sessionId: string,
    folderName: string,
    chatId: string,
  ) => void;
  onResearchChatSaved?: (folderName: string, chatId: string) => void;
  onSubAgentEvent?: (chatId: string, event: SubAgentEvent) => void;
}

export class DeepSearchSessionManager {
  private sessions = new Map<string, DeepSearchSession>();

  constructor(private config: DeepSearchSessionManagerConfig) {}

  setConfig(config: DeepSearchSessionManagerConfig) {
    this.config = config;
  }

  async handle(rawRequest: unknown): Promise<DeepSearchResponse> {
    const request = deepSearchRequestSchema.parse(rawRequest);

    if (request.cancel) {
      return this.cancel(request.session_id ?? "");
    }

    if (request.question && !request.session_id) {
      const session = this.createSession(request.question);
      this.ensureRunning(session);
      return this.waitAndDescribe(session);
    }

    const session = this.requireSession(request.session_id);

    if (request.question) {
      this.appendFollowUpQuestion(session, request.question);
      await this.saveSession(session);
      this.ensureRunning(session);
      return this.waitAndDescribe(session);
    }

    if (request.answers) {
      if (session.status !== "questions") {
        throw new Error("This research session is not waiting for answers.");
      }
      session.messages = answerPendingDeepSearchQuestions(
        session.messages,
        request.answers,
      );
      await this.saveSession(session);
      session.status = "running";
      session.error = undefined;
      this.notify(session);
      this.ensureRunning(session);
    } else if (session.status === "running") {
      this.ensureRunning(session);
    }

    return this.waitAndDescribe(session);
  }

  cancel(sessionId: string): DeepSearchResponse {
    const session = this.requireSession(sessionId);
    session.abortController.abort();
    session.status = "cancelled";
    this.notify(session);
    return { session_id: session.sessionId, status: "cancelled" };
  }

  private createSession(question: string): DeepSearchSession {
    const sessionId = `mcp-${crypto.randomUUID()}`;
    const researchChatId = createResearchChatId();
    let session: DeepSearchSession;

    const transport = new DirectTransport(
      () => this.config.getChatModel(),
      () => this.config.getSearchKeys(),
      researchChatId,
      null,
      (folderName) => {
        session.researchFolder = folderName;
        this.config.onResearchFolderChange?.(
          session.sessionId,
          folderName,
          session.researchChatId,
        );
      },
    );

    session = {
      sessionId,
      researchChatId,
      researchFolder: null,
      messages: [createUserMessage(question)],
      transport,
      abortController: new AbortController(),
      status: "running",
      waiters: new Set(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  private appendFollowUpQuestion(session: DeepSearchSession, question: string) {
    if (session.status === "running") {
      throw new Error("This research session is still running.");
    }

    if (session.status === "questions") {
      throw new Error(
        "This research session is waiting for answers. Answer the pending questions before sending a follow-up.",
      );
    }

    if (session.status === "cancelled") {
      throw new Error("This research session was cancelled.");
    }

    if (session.status === "failed") {
      throw new Error("This research session failed.");
    }

    session.messages = [...session.messages, createUserMessage(question)];
    session.abortController = new AbortController();
    session.status = "running";
    session.result = undefined;
    session.error = undefined;
    this.notify(session);
  }

  private requireSession(sessionId: string | undefined): DeepSearchSession {
    if (!sessionId) throw new Error("session_id is required.");
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown research session: ${sessionId}`);
    return session;
  }

  private ensureRunning(session: DeepSearchSession) {
    if (session.runPromise) return;
    if (session.status !== "running") return;

    session.runPromise = this.runUntilPause(session)
      .catch((error) => {
        if (session.abortController.signal.aborted) {
          session.status = "cancelled";
        } else {
          session.status = "failed";
          session.error = error instanceof Error ? error.message : String(error);
        }
      })
      .finally(() => {
        session.runPromise = undefined;
        this.notify(session);
      });
  }

  private async runUntilPause(session: DeepSearchSession) {
    setDirectEventHandler(session.researchChatId, (event) => {
      this.config.onSubAgentEvent?.(session.researchChatId, event);
    });

    try {
      while (!session.abortController.signal.aborted) {
        const stream = await session.transport.sendMessages({
          trigger: "submit-message",
          chatId: session.researchChatId,
          messageId: session.messages[session.messages.length - 1]?.id,
          messages: session.messages,
          abortSignal: session.abortController.signal,
        });

        session.messages = await collectMessages(stream, session.messages);
        await this.saveSession(session);

        if (hasPendingQuestionTool(session.messages)) {
          session.status = "questions";
          this.notify(session);
          return;
        }

        if (shouldContinueAfterToolResult({ messages: session.messages })) {
          continue;
        }

        session.status = "done";
        session.result = getDeepSearchResultText(session.messages);
        this.notify(session);
        return;
      }

      session.status = "cancelled";
    } finally {
      setDirectEventHandler(session.researchChatId, null);
    }
  }

  private async saveSession(session: DeepSearchSession) {
    if (!session.researchFolder) return;

    await saveResearchChatMessages(
      session.researchFolder,
      session.researchChatId,
      session.messages,
    );
    this.config.onResearchChatSaved?.(
      session.researchFolder,
      session.researchChatId,
    );
  }

  private async waitAndDescribe(
    session: DeepSearchSession,
  ): Promise<DeepSearchResponse> {
    if (session.status === "running") {
      await waitForSessionChange(session, DEFAULT_WAIT_MS);
    }
    return describeSession(session);
  }

  private notify(session: DeepSearchSession) {
    const waiters = Array.from(session.waiters);
    session.waiters.clear();
    for (const waiter of waiters) waiter();
  }
}

async function collectMessages(
  stream: ReadableStream<UIMessageChunk>,
  messages: UIMessage[],
): Promise<UIMessage[]> {
  const lastMessage = messages[messages.length - 1];
  const lastAssistant =
    lastMessage?.role === "assistant" ? lastMessage : undefined;
  let responseMessage: UIMessage | undefined;

  for await (const message of readUIMessageStream<UIMessage>({
    message: lastAssistant,
    stream,
    terminateOnError: true,
  })) {
    responseMessage = message;
  }

  if (!responseMessage) return messages;

  const normalizedResponse = normalizeDeepSearchAssistantMessage(responseMessage);

  if (lastAssistant && normalizedResponse.id === lastAssistant.id) {
    return [...messages.slice(0, -1), normalizedResponse];
  }

  return [...messages, normalizedResponse];
}

function describeSession(session: DeepSearchSession): DeepSearchResponse {
  switch (session.status) {
    case "running":
      return { session_id: session.sessionId, status: "running" };
    case "questions":
      return {
        session_id: session.sessionId,
        status: "questions",
        questions: getPendingDeepSearchQuestions(session.messages),
      };
    case "done":
      return {
        session_id: session.sessionId,
        status: "done",
        result: session.result ?? getDeepSearchResultText(session.messages),
      };
    case "failed":
      return {
        session_id: session.sessionId,
        status: "failed",
        error: session.error ?? "Research failed.",
      };
    case "cancelled":
      return { session_id: session.sessionId, status: "cancelled" };
  }
}

function waitForSessionChange(
  session: DeepSearchSession,
  timeoutMs: number,
): Promise<void> {
  if (session.status !== "running") return Promise.resolve();

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof globalThis.setTimeout>;

    const waiter = () => {
      globalThis.clearTimeout(timeout);
      resolve();
    };
    timeout = globalThis.setTimeout(() => {
      session.waiters.delete(waiter);
      resolve();
    }, timeoutMs);
    session.waiters.add(waiter);
  });
}
