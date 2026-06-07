import { z } from "zod";
import { describe, expect, it } from "vitest";
import { describeTool, zodToParams } from "@/lib/tool-descriptor";

describe("describeTool", () => {
  it("creates a ToolDescriptor with correct fields", async () => {
    const schema = z.object({
      query: z.string().describe("The search query"),
      num: z.number().default(5),
    });

    const descriptor = describeTool(
      "brave_search",
      { description: "Searches the web with Brave" },
      schema,
      true,
    );

    expect(descriptor.name).toBe("brave_search");
    expect(descriptor.description).toBe("Searches the web with Brave");
    expect(descriptor.available).toBe(true);
    expect(descriptor.parameters).toEqual({
      query: { type: "string", required: true, description: "The search query" },
      num: { type: "number", required: false, default: 5 },
    });
    expect(typeof descriptor.execute).toBe("function");
  });

  it("uses name as fallback description when tool has no description", () => {
    const schema = z.object({});
    const descriptor = describeTool("my_tool", {}, schema, false);
    expect(descriptor.description).toBe("my_tool");
  });

  it("returns null-executing execute wrapper for tools without execute", async () => {
    const schema = z.object({});
    const descriptor = describeTool("my_tool", {}, schema, true);
    await expect(descriptor.execute({})).resolves.toBeNull();
  });

  it("wraps tool execute function", async () => {
    const tool = {
      description: "Test tool",
      execute: (params: Record<string, unknown>) => params,
    };
    const schema = z.object({});
    const descriptor = describeTool("test_tool", tool, schema, true);
    await expect(descriptor.execute({ key: "value" })).resolves.toEqual({
      key: "value",
    });
  });

  it("sets available to false when tool is not available", () => {
    const schema = z.object({});
    const descriptor = describeTool("disabled_tool", {}, schema, false);
    expect(descriptor.available).toBe(false);
  });
});

describe("zodToParams", () => {
  it("maps z.string() to { type: 'string', required: true }", () => {
    const schema = z.object({ name: z.string() });
    expect(zodToParams(schema)).toEqual({
      name: { type: "string", required: true },
    });
  });

  it("maps z.number() to { type: 'number', required: true }", () => {
    const schema = z.object({ count: z.number() });
    expect(zodToParams(schema)).toEqual({
      count: { type: "number", required: true },
    });
  });

  it("maps z.boolean() to { type: 'boolean', required: true }", () => {
    const schema = z.object({ enabled: z.boolean() });
    expect(zodToParams(schema)).toEqual({
      enabled: { type: "boolean", required: true },
    });
  });

  it("maps z.enum([...]) to { type: 'string', required: true, enum: [...] }", () => {
    const schema = z.object({ kind: z.enum(["a", "b", "c"]) });
    expect(zodToParams(schema)).toEqual({
      kind: { type: "string", required: true, enum: ["a", "b", "c"] },
    });
  });

  it("maps z.string().optional() to { type: 'string', required: false }", () => {
    const schema = z.object({ name: z.string().optional() });
    expect(zodToParams(schema)).toEqual({
      name: { type: "string", required: false },
    });
  });

  it("maps z.string().default(...) to { type: 'string', required: false, default: ... }", () => {
    const schema = z.object({ name: z.string().default("anon") });
    expect(zodToParams(schema)).toEqual({
      name: { type: "string", required: false, default: "anon" },
    });
  });

  it("maps z.string().describe(...) to include description", () => {
    const schema = z.object({ name: z.string().describe("The name") });
    expect(zodToParams(schema)).toEqual({
      name: { type: "string", required: true, description: "The name" },
    });
  });

  it("maps z.string().url() to { type: 'string', required: true } (format not exposed)", () => {
    const schema = z.object({ url: z.string().url() });
    expect(zodToParams(schema)).toEqual({
      url: { type: "string", required: true },
    });
  });

  it("maps z.array(z.string()) to { type: 'string', required: true } (arrays fall through)", () => {
    const schema = z.object({ tags: z.array(z.string()) });
    expect(zodToParams(schema)).toEqual({
      tags: { type: "string", required: true },
    });
  });

  it("handles combined fields with optional, default, and description", () => {
    const schema = z.object({
      q: z.string(),
      n: z.number().int().min(1).default(5).optional(),
    });
    expect(zodToParams(schema)).toEqual({
      q: { type: "string", required: true },
      n: { type: "number", required: false, default: 5 },
    });
  });

  it("returns empty object for empty schema", () => {
    const schema = z.object({});
    expect(zodToParams(schema)).toEqual({});
  });
});
