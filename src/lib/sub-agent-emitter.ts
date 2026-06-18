import type { SubAgentDisplayTarget, SubAgentEvent } from "./sub-agent-types";
import {
  recordSubAgentEvent,
  recordSubAgentHandlerDuration,
  recordSubAgentSubscription,
  startSubAgentProfileMeasure,
} from "./sub-agent-profiler";

type SubAgentEmitter = (event: SubAgentEvent) => void;

let currentEmitter: SubAgentEmitter | null = null;
let currentMessageId: string | null = null;
let currentChatId: string | null = null;
let nextEventSequence = 0;
const directHandlers = new Map<string, SubAgentEmitter>();

function resolveDisplayTarget(event: SubAgentEvent): SubAgentDisplayTarget {
  if (event.type === "start" && event.displayTarget) return event.displayTarget;
  return { type: "sidebar" };
}

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
    if (!directHandlers.has(chatId)) {
      recordSubAgentSubscription(`direct:${chatId}`, "create");
    }
    directHandlers.set(chatId, handler);
  } else {
    if (directHandlers.delete(chatId)) {
      recordSubAgentSubscription(`direct:${chatId}`, "destroy");
    }
  }
}

export function emitSubAgentEvent(event: SubAgentEvent): void {
  const sequencedEvent = addEventSequence(event);
  const resolved = event.type === "start"
    ? ({ ...sequencedEvent, displayTarget: resolveDisplayTarget(event) } as SubAgentEvent)
    : sequencedEvent;
  recordSubAgentEvent(currentChatId, resolved);
  if (currentEmitter) {
    const startedAt = startSubAgentProfileMeasure();
    currentEmitter(resolved);
    recordSubAgentHandlerDuration("emitter.controller", startedAt);
  }
  if (currentChatId) {
    const handler = directHandlers.get(currentChatId);
    if (handler) {
      const startedAt = startSubAgentProfileMeasure();
      handler(resolved);
      recordSubAgentHandlerDuration("emitter.direct", startedAt);
    }
  }
}

export function emitSubAgentEventToChat(
  chatId: string,
  event: SubAgentEvent,
): void {
  const sequencedEvent = addEventSequence(event);
  const resolved = event.type === "start"
    ? ({ ...sequencedEvent, displayTarget: resolveDisplayTarget(event) } as SubAgentEvent)
    : sequencedEvent;
  recordSubAgentEvent(chatId, resolved);

  const handler = directHandlers.get(chatId);
  if (!handler) return;

  const startedAt = startSubAgentProfileMeasure();
  handler(resolved);
  recordSubAgentHandlerDuration("emitter.direct", startedAt);
}

function addEventSequence(event: SubAgentEvent): SubAgentEvent {
  return {
    ...event,
    sequence: nextEventSequence++,
  } as SubAgentEvent;
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
