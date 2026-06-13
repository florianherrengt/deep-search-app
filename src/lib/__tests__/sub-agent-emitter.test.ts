import { describe, expect, it, vi, afterEach } from "vitest";
import {
  emitSubAgentEvent,
  getParentMessageId,
  setActiveSubAgentEmitter,
  setDirectEventHandler,
  withEmitter,
  withEmitterAsync,
} from "@/lib/sub-agent-emitter";
import type { SubAgentEvent } from "@/lib/sub-agent-types";

const startEvent = (id: string): SubAgentEvent => ({
  type: "start",
  id,
  name: "test",
  toolName: "t",
  parentMessageId: "msg",
});

describe("emitSubAgentEvent", () => {
  afterEach(() => {
    setActiveSubAgentEmitter(null, null);
    setDirectEventHandler("chatA", null);
    setDirectEventHandler("chatB", null);
  });

  it("does nothing when no emitter is set", () => {
    expect(() => emitSubAgentEvent(startEvent("1"))).not.toThrow();
  });

  it("calls the active emitter when set", () => {
    const emitter = vi.fn();
    setActiveSubAgentEmitter(emitter, "msg-1");
    const event = startEvent("1");
    emitSubAgentEvent(event);
    expect(emitter).toHaveBeenCalledWith(expect.objectContaining(event));
  });

  it("routes direct handler events to the correct chatId", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    setDirectEventHandler("chatA", handlerA);
    setDirectEventHandler("chatB", handlerB);

    setActiveSubAgentEmitter(vi.fn(), null, "chatA");
    emitSubAgentEvent(startEvent("1"));
    expect(handlerA).toHaveBeenCalledWith(expect.objectContaining(startEvent("1")));
    expect(handlerB).not.toHaveBeenCalled();
  });

  it("does not route to wrong chat when multiple handlers registered", () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    setDirectEventHandler("chatA", handlerA);
    setDirectEventHandler("chatB", handlerB);

    setActiveSubAgentEmitter(vi.fn(), null, "chatB");
    emitSubAgentEvent(startEvent("1"));
    expect(handlerB).toHaveBeenCalledWith(expect.objectContaining(startEvent("1")));
    expect(handlerA).not.toHaveBeenCalled();
  });

  it("does not call any handler when chatId does not match", () => {
    const handlerA = vi.fn();
    setDirectEventHandler("chatA", handlerA);

    setActiveSubAgentEmitter(vi.fn(), null, "chatUnknown");
    emitSubAgentEvent(startEvent("1"));
    expect(handlerA).not.toHaveBeenCalled();
  });

  it("unregisters handler when setDirectEventHandler is called with null", () => {
    const handlerA = vi.fn();
    setDirectEventHandler("chatA", handlerA);
    setDirectEventHandler("chatA", null);

    setActiveSubAgentEmitter(vi.fn(), null, "chatA");
    emitSubAgentEvent(startEvent("1"));
    expect(handlerA).not.toHaveBeenCalled();
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
      emitSubAgentEvent(startEvent("1"));
      expect(emitter).toHaveBeenCalled();
      return 42;
    });

    expect(result).toBe(42);
    expect(getParentMessageId()).toBe("old-msg");

    emitSubAgentEvent(startEvent("2"));
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
      emitSubAgentEvent(startEvent("1"));
      expect(emitter).toHaveBeenCalled();
      return "async-result";
    });

    expect(result).toBe("async-result");
    expect(getParentMessageId()).toBe("old-msg");

    emitSubAgentEvent(startEvent("2"));
    expect(prevEmitter).toHaveBeenCalled();
    expect(emitter).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent chat isolation", () => {
  afterEach(() => {
    setActiveSubAgentEmitter(null, null);
    setDirectEventHandler("chatA", null);
    setDirectEventHandler("chatB", null);
  });

  it("events from one chat do not leak to another chat's emitter", () => {
    const emitterA = vi.fn();
    const emitterB = vi.fn();

    setActiveSubAgentEmitter(emitterA, "msg-a", "chatA");
    setActiveSubAgentEmitter(emitterB, "msg-b", "chatB");

    emitSubAgentEvent(startEvent("1"));
    expect(emitterB).toHaveBeenCalledWith(expect.objectContaining(startEvent("1")));
    expect(emitterA).not.toHaveBeenCalled();

    setActiveSubAgentEmitter(emitterA, "msg-a", "chatA");
    emitSubAgentEvent(startEvent("2"));
    expect(emitterA).toHaveBeenCalledWith(expect.objectContaining(startEvent("2")));
  });

  it("captured emitter function continues routing after global is cleared", () => {
    const capturedEmitter = vi.fn();

    setActiveSubAgentEmitter(capturedEmitter, "msg-a", "chatA");
    setActiveSubAgentEmitter(null, null, null);

    capturedEmitter(startEvent("1"));
    expect(capturedEmitter).toHaveBeenCalledWith(startEvent("1"));
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
        emitSubAgentEvent(startEvent("1"));
        expect(innerEmitter).toHaveBeenCalled();
        expect(outerEmitter).not.toHaveBeenCalled();
      });

      expect(getParentMessageId()).toBe("outer-msg");
      emitSubAgentEvent(startEvent("2"));
      expect(outerEmitter).toHaveBeenCalledTimes(1);
    });
  });
});
