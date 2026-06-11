import type { SubAgentEvent } from "./sub-agent-types";

type SubAgentEmitter = (event: SubAgentEvent) => void;

let currentEmitter: SubAgentEmitter | null = null;
let currentMessageId: string | null = null;

export function setActiveSubAgentEmitter(
  emitter: SubAgentEmitter | null,
  parentMessageId: string | null,
): void {
  currentEmitter = emitter;
  currentMessageId = parentMessageId;
}

export function emitSubAgentEvent(event: SubAgentEvent): void {
  if (currentEmitter) {
    currentEmitter(event);
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
  setActiveSubAgentEmitter(emitter, parentMessageId);
  try {
    return fn();
  } finally {
    setActiveSubAgentEmitter(prevEmitter, prevMessageId);
  }
}

export async function withEmitterAsync<T>(
  emitter: SubAgentEmitter,
  parentMessageId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prevEmitter = currentEmitter;
  const prevMessageId = currentMessageId;
  setActiveSubAgentEmitter(emitter, parentMessageId);
  try {
    return await fn();
  } finally {
    setActiveSubAgentEmitter(prevEmitter, prevMessageId);
  }
}
