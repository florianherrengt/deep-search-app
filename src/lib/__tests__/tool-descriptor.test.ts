import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeTool } from "@/lib/tool-descriptor";

describe("describeTool", () => {
  it("passes a defined options object so execute callbacks can read options.toolCallId", async () => {
    // Reproduces the Tools panel crash: the panel calls execute(params) with no
    // second argument. Before the fix, `options` was undefined and reads like
    // `options.toolCallId` threw "undefined is not an object".
    let receivedOptions: unknown = "untouched";
    const fakeTool = {
      description: "test tool",
      execute: async (_input: unknown, options?: unknown) => {
        receivedOptions = options;
        return "ok";
      },
    };

    const descriptor = describeTool("test_tool", fakeTool, z.object({}), true);
    const result = await descriptor.execute({});

    expect(result).toBe("ok");
    expect(receivedOptions).toBeDefined();
    expect(receivedOptions).toEqual(expect.any(Object));
  });

  it("returns a non-available descriptor with a no-op execute when the tool is missing", async () => {
    const descriptor = describeTool("missing_tool", undefined, z.object({}), false);
    expect(descriptor.available).toBe(false);
    await expect(descriptor.execute({})).resolves.toBeNull();
  });
});
