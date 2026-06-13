import type { SubAgentEvent } from "./sub-agent-types";

type Counter = {
  count: number;
  totalMs: number;
  maxMs: number;
};

type ProfileState = {
  startedAt: number;
  lastLogAt: number;
  events: Record<string, number>;
  eventBytes: number;
  maxEventBytes: number;
  handlers: Record<string, Counter>;
  renders: Record<string, number>;
  subscriptions: Record<string, { created: number; destroyed: number; active: number }>;
  updates: Record<string, Counter>;
};

export type SubAgentProfileSnapshot = {
  elapsedSeconds: number;
  eventsPerSecond: number;
  events: Record<string, number>;
  eventBytes: number;
  maxEventBytes: number;
  handlers: Record<string, Counter>;
  renders: Record<string, number>;
  subscriptions: Record<string, { created: number; destroyed: number; active: number }>;
  updates: Record<string, Counter>;
};

type ProfileApi = {
  reset: () => void;
  snapshot: () => SubAgentProfileSnapshot;
};

declare global {
  interface Window {
    __DEEP_SEARCH_SUB_AGENT_PROFILE__?: boolean;
    __deepSearchSubAgentProfile?: ProfileApi;
  }
}

const PROFILE_LOCAL_STORAGE_KEY = "deep-search-subagent-profile";
const PROFILE_LOG_INTERVAL_MS = 1000;

let profileState: ProfileState | null = null;
let localStorageProfilingEnabled: boolean | null = null;

export function startSubAgentProfileMeasure(): number {
  return isSubAgentProfilingEnabled() ? now() : 0;
}

export function recordSubAgentEvent(
  chatId: string | null,
  event: SubAgentEvent,
): void {
  const state = getProfileState();
  if (!state) return;

  const key = `${event.type}:${chatId ?? "unknown"}`;
  state.events[key] = (state.events[key] ?? 0) + 1;
  const bytes = getPayloadBytes(event);
  state.eventBytes += bytes;
  state.maxEventBytes = Math.max(state.maxEventBytes, bytes);
  logProfileSummaryIfDue(state);
}

export function recordSubAgentHandlerDuration(
  name: string,
  startedAt: number,
): void {
  const state = getProfileState();
  if (!state || startedAt === 0) return;
  updateCounter(state.handlers, name, now() - startedAt);
  logProfileSummaryIfDue(state);
}

export function recordSubAgentRender(name: string): void {
  const state = getProfileState();
  if (!state) return;
  state.renders[name] = (state.renders[name] ?? 0) + 1;
  logProfileSummaryIfDue(state);
}

export function recordSubAgentSubscription(
  name: string,
  action: "create" | "destroy",
): void {
  const state = getProfileState();
  if (!state) return;

  const current = state.subscriptions[name] ?? {
    created: 0,
    destroyed: 0,
    active: 0,
  };
  if (action === "create") {
    current.created += 1;
    current.active += 1;
  } else {
    current.destroyed += 1;
    current.active = Math.max(0, current.active - 1);
  }
  state.subscriptions[name] = current;
  logProfileSummaryIfDue(state);
}

export function recordSubAgentUpdateDuration(
  name: string,
  startedAt: number,
): void {
  const state = getProfileState();
  if (!state || startedAt === 0) return;
  updateCounter(state.updates, name, now() - startedAt);
  logProfileSummaryIfDue(state);
}

export function useSubAgentRenderCounter(name: string): void {
  recordSubAgentRender(name);
}

export function getSubAgentProfileSnapshot(): SubAgentProfileSnapshot {
  const state = profileState ?? createProfileState();
  const elapsedSeconds = Math.max((now() - state.startedAt) / 1000, 0.001);
  const eventCount = Object.values(state.events).reduce((sum, count) => sum + count, 0);
  return {
    elapsedSeconds,
    eventsPerSecond: eventCount / elapsedSeconds,
    events: { ...state.events },
    eventBytes: state.eventBytes,
    maxEventBytes: state.maxEventBytes,
    handlers: cloneCounters(state.handlers),
    renders: { ...state.renders },
    subscriptions: cloneSubscriptions(state.subscriptions),
    updates: cloneCounters(state.updates),
  };
}

export function resetSubAgentProfile(): void {
  localStorageProfilingEnabled = null;
  profileState = createProfileState();
  installProfileApi();
}

function getProfileState(): ProfileState | null {
  if (!isSubAgentProfilingEnabled()) return null;
  if (!profileState) {
    profileState = createProfileState();
  }
  installProfileApi();
  return profileState;
}

function isSubAgentProfilingEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.__DEEP_SEARCH_SUB_AGENT_PROFILE__) return true;
  if (localStorageProfilingEnabled !== null) return localStorageProfilingEnabled;
  try {
    localStorageProfilingEnabled = window.localStorage.getItem(PROFILE_LOCAL_STORAGE_KEY) === "1";
    return localStorageProfilingEnabled;
  } catch {
    localStorageProfilingEnabled = false;
    return false;
  }
}

function installProfileApi(): void {
  if (typeof window === "undefined") return;
  window.__deepSearchSubAgentProfile = {
    reset: resetSubAgentProfile,
    snapshot: getSubAgentProfileSnapshot,
  };
}

function createProfileState(): ProfileState {
  const timestamp = now();
  return {
    startedAt: timestamp,
    lastLogAt: timestamp,
    events: {},
    eventBytes: 0,
    maxEventBytes: 0,
    handlers: {},
    renders: {},
    subscriptions: {},
    updates: {},
  };
}

function updateCounter(
  counters: Record<string, Counter>,
  name: string,
  durationMs: number,
): void {
  const current = counters[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += durationMs;
  current.maxMs = Math.max(current.maxMs, durationMs);
  counters[name] = current;
}

function cloneCounters(counters: Record<string, Counter>): Record<string, Counter> {
  return Object.fromEntries(
    Object.entries(counters).map(([key, value]) => [key, { ...value }]),
  );
}

function cloneSubscriptions(
  subscriptions: ProfileState["subscriptions"],
): ProfileState["subscriptions"] {
  return Object.fromEntries(
    Object.entries(subscriptions).map(([key, value]) => [key, { ...value }]),
  );
}

function getPayloadBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return 0;
  }
}

function logProfileSummaryIfDue(state: ProfileState): void {
  const timestamp = now();
  if (timestamp - state.lastLogAt < PROFILE_LOG_INTERVAL_MS) return;
  state.lastLogAt = timestamp;
  console.debug("[sub-agent-profile]", getSubAgentProfileSnapshot());
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}
