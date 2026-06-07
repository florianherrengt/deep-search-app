import { describe, expect, it } from "vitest";
import {
  activateChatSession,
  createChatSessionRecord,
  getRunningResearchChatIds,
  getRunningResearchFolders,
  hasRunningResearchFolder,
  updateChatSessionResearchFolder,
  updateChatSessionRunState,
} from "@/App";

describe("chat session state", () => {
  it("allows multiple sessions to remain running in parallel", () => {
    const first = createChatSessionRecord({
      researchChatId: "chat-one",
      researchFolder: "folder-one",
    });
    const second = createChatSessionRecord({
      researchChatId: "chat-two",
      researchFolder: "folder-two",
    });
    const runningSessions = updateChatSessionRunState(
      updateChatSessionRunState([first, second], first.sessionId, true),
      second.sessionId,
      true,
    );

    expect(getRunningResearchFolders(runningSessions)).toEqual([
      "folder-one",
      "folder-two",
    ]);
    expect(getRunningResearchChatIds(runningSessions)).toEqual([
      "chat-one",
      "chat-two",
    ]);
  });

  it("reuses an existing folder chat session instead of replacing a running run", () => {
    const session = createChatSessionRecord({
      researchChatId: "chat-one",
      researchFolder: "folder-one",
    });
    const state = {
      sessions: updateChatSessionRunState([session], session.sessionId, true),
      activeSessionId: session.sessionId,
    };

    const next = activateChatSession(state, {
      researchChatId: "chat-one",
      researchFolder: "folder-one",
    });

    expect(next.sessions).toHaveLength(1);
    expect(next.activeSessionId).toBe(session.sessionId);
    expect(next.sessions[0]?.isRunning).toBe(true);
  });

  it("refreshes a completed existing folder chat session with loaded messages", () => {
    const session = createChatSessionRecord({
      researchChatId: "chat-one",
      researchFolder: "folder-one",
      initialMessages: [
        {
          id: "user-only",
          role: "user",
          parts: [{ type: "text", text: "Old message" }],
        },
      ],
    });
    const state = {
      sessions: [session],
      activeSessionId: session.sessionId,
    };

    const next = activateChatSession(state, {
      researchChatId: "chat-one",
      researchFolder: "folder-one",
      initialMessages: [
        {
          id: "assistant-complete",
          role: "assistant",
          parts: [{ type: "text", text: "Completed in background" }],
        },
      ],
    });

    expect(next.sessions).toHaveLength(1);
    expect(next.activeSessionId).not.toBe(session.sessionId);
    expect(next.sessions[0]?.initialMessages).toEqual([
      {
        id: "assistant-complete",
        role: "assistant",
        parts: [{ type: "text", text: "Completed in background" }],
      },
    ]);
  });

  it("does not change the visible session when a background run creates a folder", () => {
    const visible = createChatSessionRecord({
      researchChatId: "visible-chat",
      researchFolder: "visible-folder",
    });
    const background = createChatSessionRecord({
      researchChatId: "background-chat",
      researchFolder: null,
    });
    const activeSessionId = visible.sessionId;

    const sessions = updateChatSessionResearchFolder(
      [visible, background],
      background.sessionId,
      "generated-background-folder",
    );
    const active = sessions.find((session) => session.sessionId === activeSessionId);
    const updatedBackground = sessions.find(
      (session) => session.sessionId === background.sessionId,
    );

    expect(active?.researchFolder).toBe("visible-folder");
    expect(updatedBackground?.researchFolder).toBe("generated-background-folder");
  });

  it("creates a new session when forceNew is true even for same folder and chat", () => {
    const session = createChatSessionRecord({
      researchChatId: "chat-one",
      researchFolder: "folder-one",
    });
    const state = {
      sessions: [session],
      activeSessionId: session.sessionId,
    };

    const next = activateChatSession(state, {
      researchChatId: "chat-one",
      researchFolder: "folder-one",
      forceNew: true,
    });

    expect(next.sessions).toHaveLength(2);
    expect(next.activeSessionId).not.toBe(session.sessionId);
    expect(next.sessions[0]?.sessionId).toBe(session.sessionId);
  });

  it("hasRunningResearchFolder detects running and non-running folders", () => {
    const running = createChatSessionRecord({
      researchChatId: "chat-running",
      researchFolder: "running-folder",
    });
    const idle = createChatSessionRecord({
      researchChatId: "chat-idle",
      researchFolder: "idle-folder",
    });
    const sessions = updateChatSessionRunState(
      [running, idle],
      running.sessionId,
      true,
    );

    expect(hasRunningResearchFolder(sessions, "running-folder")).toBe(true);
    expect(hasRunningResearchFolder(sessions, "idle-folder")).toBe(false);
    expect(hasRunningResearchFolder(sessions, "nonexistent-folder")).toBe(false);
  });

  it("handles empty sessions array for running folder queries", () => {
    expect(getRunningResearchFolders([])).toEqual([]);
    expect(getRunningResearchChatIds([])).toEqual([]);
    expect(hasRunningResearchFolder([], "any-folder")).toBe(false);
  });
});
