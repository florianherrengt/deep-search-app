import type { SubAgentDisplayTarget, SubAgentEvent } from "./sub-agent-types";
import {
  recordSubAgentEvent,
  recordSubAgentHandlerDuration,
  recordSubAgentSubscription,
  startSubAgentProfileMeasure,
} from "./sub-agent-profiler";

export type SubAgentEmitter = (event: SubAgentEvent) => void;

let currentEmitter: SubAgentEmitter | null = null;
let currentMessageId: string | null = null;
let currentChatId: string | null = null;
let nextEventSequence = 0;
type DirectSubscription = { handler: SubAgentEmitter };
const directHandlers = new Map<string, DirectSubscription[]>();

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
): () => void {
  if (handler) {
    const subscriptions = directHandlers.get(chatId) ?? [];
    if (subscriptions.length === 0) {
      recordSubAgentSubscription(`direct:${chatId}`, "create");
    }
    const subscription = { handler };
    subscriptions.push(subscription);
    directHandlers.set(chatId, subscriptions);
    return () => removeDirectEventHandler(chatId, subscription);
  } else {
    const removed = directHandlers.delete(chatId);
    if (removed) {
      recordSubAgentSubscription(`direct:${chatId}`, "destroy");
    }
    return () => {};
  }
}

function removeDirectEventHandler(
  chatId: string,
  subscription: DirectSubscription,
): void {
  const subscriptions = directHandlers.get(chatId);
  if (!subscriptions) return;

  const index = subscriptions.indexOf(subscription);
  if (index === -1) return;
  subscriptions.splice(index, 1);
  if (subscriptions.length === 0) {
    directHandlers.delete(chatId);
    recordSubAgentSubscription(`direct:${chatId}`, "destroy");
  }
}

function getDirectEventHandler(chatId: string): SubAgentEmitter | null {
  const subscriptions = directHandlers.get(chatId);
  return subscriptions?.[subscriptions.length - 1]?.handler ?? null;
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
    const handler = getDirectEventHandler(currentChatId);
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

  const handler = getDirectEventHandler(chatId);
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
