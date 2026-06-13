import type { SubAgentEvent } from "./sub-agent-types";

type SubAgentEmitter = (event: SubAgentEvent) => void;

let currentEmitter: SubAgentEmitter | null = null;
let currentMessageId: string | null = null;
let currentChatId: string | null = null;
const directHandlers = new Map<string, SubAgentEmitter>();

export function setActiveSubAgentEmitter(
  emitter: SubAgentEmitter | null,
  parentMessageId: string | null,
  chatId?: string | null,
): void {
  currentEmitter = emitter;
  currentMessageId = parentMessageId;
  if (chatId !== undefined) currentChatId = chatId;
}

export function setDirectEventHandler(
  chatId: string,
  handler: SubAgentEmitter | null,
): void {
  if (handler) {
    directHandlers.set(chatId, handler);
  } else {
    directHandlers.delete(chatId);
  }
}

export function emitSubAgentEvent(event: SubAgentEvent): void {
  if (currentEmitter) {
    currentEmitter(event);
  }
  if (currentChatId) {
    const handler = directHandlers.get(currentChatId);
    if (handler) handler(event);
  }
}

export function getParentMessageId(): string | null {
  return currentMessageId;
}

export function withEmitter<T>(
  emitter: SubAgentEmitter,
  parentMessageId: string,
  fn: () => T,
): T {
  const prevEmitter = currentEmitter;
  const prevMessageId = currentMessageId;
  const prevChatId = currentChatId;
  setActiveSubAgentEmitter(emitter, parentMessageId);
  try {
    return fn();
  } finally {
    currentEmitter = prevEmitter;
    currentMessageId = prevMessageId;
    currentChatId = prevChatId;
  }
}

export async function withEmitterAsync<T>(
  emitter: SubAgentEmitter,
  parentMessageId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prevEmitter = currentEmitter;
  const prevMessageId = currentMessageId;
  const prevChatId = currentChatId;
  setActiveSubAgentEmitter(emitter, parentMessageId);
  try {
    return await fn();
  } finally {
    currentEmitter = prevEmitter;
    currentMessageId = prevMessageId;
    currentChatId = prevChatId;
  }
}
