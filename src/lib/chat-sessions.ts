import type { UIMessage } from "ai";

export interface ChatSessionRecord {
  sessionId: string;
  runtimeChatId: string;
  researchChatId: string;
  researchFolder: string | null;
  initialMessages: UIMessage[];
  isRunning: boolean;
  needsAttention: boolean;
}

export interface ChatSessionState {
  sessions: ChatSessionRecord[];
  activeSessionId: string;
}

export interface CreateChatSessionInput {
  researchChatId: string;
  researchFolder: string | null;
  initialMessages?: UIMessage[];
}

export function createChatSessionRecord({
  researchChatId,
  researchFolder,
  initialMessages = [],
}: CreateChatSessionInput): ChatSessionRecord {
  return {
    sessionId: createChatSessionId("session"),
    runtimeChatId: createChatSessionId("chat"),
    researchChatId,
    researchFolder,
    initialMessages,
    isRunning: false,
    needsAttention: false,
  };
}

export function activateChatSession(
  current: ChatSessionState,
  input: CreateChatSessionInput & { forceNew?: boolean },
): ChatSessionState {
  const existing = input.forceNew
    ? undefined
    : current.sessions.find(
        (session) =>
          session.researchFolder === input.researchFolder &&
          session.researchChatId === input.researchChatId,
      );

  if (existing) {
    if (!existing.isRunning && !existing.needsAttention) {
      const session = createChatSessionRecord(input);
      return {
        sessions: current.sessions
          .filter(
            (currentSession) =>
              currentSession.sessionId !== existing.sessionId,
          )
          .concat(session),
        activeSessionId: session.sessionId,
      };
    }

    return { ...current, activeSessionId: existing.sessionId };
  }

  const session = createChatSessionRecord(input);
  return {
    sessions: [...current.sessions, session],
    activeSessionId: session.sessionId,
  };
}

export function updateChatSessionResearchFolder(
  sessions: ChatSessionRecord[],
  sessionId: string,
  folderName: string,
) {
  return sessions.map((session) =>
    session.sessionId === sessionId
      ? {
          ...session,
          researchFolder: folderName,
        }
      : session,
  );
}

export function updateChatSessionRunState(
  sessions: ChatSessionRecord[],
  sessionId: string,
  isRunning: boolean,
) {
  return sessions.map((session) =>
    session.sessionId === sessionId
      ? { ...session, isRunning }
      : session,
  );
}

export function updateChatSessionAttentionState(
  sessions: ChatSessionRecord[],
  sessionId: string,
  needsAttention: boolean,
) {
  return sessions.map((session) =>
    session.sessionId === sessionId
      ? { ...session, needsAttention }
      : session,
  );
}

export function getRunningResearchFolders(sessions: ChatSessionRecord[]) {
  return Array.from(
    new Set(
      sessions
        .filter((session) => session.isRunning && session.researchFolder)
        .map((session) => session.researchFolder as string),
    ),
  );
}

export function getRunningResearchChatIds(sessions: ChatSessionRecord[]) {
  return sessions
    .filter((session) => session.isRunning)
    .map((session) => session.researchChatId);
}

export function getAttentionRequiredResearchFolders(
  sessions: ChatSessionRecord[],
) {
  return Array.from(
    new Set(
      sessions
        .filter((session) => session.needsAttention && session.researchFolder)
        .map((session) => session.researchFolder as string),
    ),
  );
}

export function getAttentionRequiredResearchChatIds(
  sessions: ChatSessionRecord[],
) {
  return sessions
    .filter((session) => session.needsAttention)
    .map((session) => session.researchChatId);
}

export function hasRunningResearchFolder(
  sessions: ChatSessionRecord[],
  folderName: string,
) {
  return sessions.some(
    (session) => session.isRunning && session.researchFolder === folderName,
  );
}

function createChatSessionId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
