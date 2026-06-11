import { describe, expect, it, vi, afterEach } from "vitest";
import {
  emitSubAgentEvent,
  getParentMessageId,
  setActiveSubAgentEmitter,
  withEmitter,
  withEmitterAsync,
} from "@/lib/sub-agent-emitter";
import type { SubAgentEvent } from "@/lib/sub-agent-types";

describe("emitSubAgentEvent", () => {
  afterEach(() => {
    setActiveSubAgentEmitter(null, null);
  });

  it("does nothing when no emitter is set", () => {
    expect(() =>
      emitSubAgentEvent({ type: "start", id: "1", name: "test", toolName: "t", parentMessageId: "msg" }),
    ).not.toThrow();
  });

  it("calls the active emitter when set", () => {
    const emitter = vi.fn();
    setActiveSubAgentEmitter(emitter, "msg-1");
    const event: SubAgentEvent = { type: "start", id: "1", name: "test", toolName: "t", parentMessageId: "msg-1" };
    emitSubAgentEvent(event);
    expect(emitter).toHaveBeenCalledWith(event);
  });
});

describe("getParentMessageId", () => {
  afterEach(() => {
    setActiveSubAgentEmitter(null, null);
  });

  it("returns null when no emitter is set", () => {
    expect(getParentMessageId()).toBeNull();
  });

  it("returns the parentMessageId when emitter is set", () => {
    const emitter = vi.fn();
    setActiveSubAgentEmitter(emitter, "parent-123");
    expect(getParentMessageId()).toBe("parent-123");
  });
});

describe("withEmitter", () => {
  afterEach(() => {
    setActiveSubAgentEmitter(null, null);
  });

  it("sets emitter for duration of callback, then restores previous", () => {
    const emitter = vi.fn();
    const prevEmitter = vi.fn();
    setActiveSubAgentEmitter(prevEmitter, "old-msg");

    const result = withEmitter(emitter, "new-msg", () => {
      expect(getParentMessageId()).toBe("new-msg");
      emitSubAgentEvent({ type: "start", id: "1", name: "t", toolName: "t", parentMessageId: "new-msg" });
      expect(emitter).toHaveBeenCalled();
      return 42;
    });

    expect(result).toBe(42);
    expect(getParentMessageId()).toBe("old-msg");

    emitSubAgentEvent({ type: "start", id: "2", name: "t", toolName: "t", parentMessageId: "old-msg" });
    expect(prevEmitter).toHaveBeenCalled();
    expect(emitter).toHaveBeenCalledTimes(1);
  });
});

describe("withEmitterAsync", () => {
  afterEach(() => {
    setActiveSubAgentEmitter(null, null);
  });

  it("sets emitter for duration of async callback, then restores previous", async () => {
    const emitter = vi.fn();
    const prevEmitter = vi.fn();
    setActiveSubAgentEmitter(prevEmitter, "old-msg");

    const result = await withEmitterAsync(emitter, "new-msg", async () => {
      expect(getParentMessageId()).toBe("new-msg");
      emitSubAgentEvent({ type: "start", id: "1", name: "t", toolName: "t", parentMessageId: "new-msg" });
      expect(emitter).toHaveBeenCalled();
      return "async-result";
    });

    expect(result).toBe("async-result");
    expect(getParentMessageId()).toBe("old-msg");

    emitSubAgentEvent({ type: "start", id: "2", name: "t", toolName: "t", parentMessageId: "old-msg" });
    expect(prevEmitter).toHaveBeenCalled();
    expect(emitter).toHaveBeenCalledTimes(1);
  });
});

describe("nested withEmitter", () => {
  afterEach(() => {
    setActiveSubAgentEmitter(null, null);
  });

  it("nested withEmitter calls restore the correct previous emitter", () => {
    const outerEmitter = vi.fn();
    const innerEmitter = vi.fn();

    withEmitter(outerEmitter, "outer-msg", () => {
      expect(getParentMessageId()).toBe("outer-msg");

      withEmitter(innerEmitter, "inner-msg", () => {
        expect(getParentMessageId()).toBe("inner-msg");
        emitSubAgentEvent({ type: "start", id: "1", name: "t", toolName: "t", parentMessageId: "inner-msg" });
        expect(innerEmitter).toHaveBeenCalled();
        expect(outerEmitter).not.toHaveBeenCalled();
      });

      expect(getParentMessageId()).toBe("outer-msg");
      emitSubAgentEvent({ type: "start", id: "2", name: "t", toolName: "t", parentMessageId: "outer-msg" });
      expect(outerEmitter).toHaveBeenCalledTimes(1);
    });
  });
});
