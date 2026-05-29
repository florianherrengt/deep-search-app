import { z } from "zod";

export interface ToolParameter {
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: string[];
}

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  available: boolean;
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export function zodToParams(
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
): Record<string, ToolParameter> {
  const params: Record<string, ToolParameter> = {};

  for (const [key, rawField] of Object.entries(schema.shape)) {
    let required = true;
    let defaultValue: unknown = undefined;

    const isOptional = rawField instanceof z.ZodOptional;
    const inner = isOptional ? rawField.unwrap() : rawField;
    const hasDefault = inner instanceof z.ZodDefault;

    if (isOptional) {
      required = false;
    }
    if (hasDefault) {
      required = false;
      defaultValue = (inner._def as { defaultValue: () => unknown }).defaultValue();
    }

    const resolved = hasDefault ? inner.removeDefault() : inner;

    let type: ToolParameter["type"] = "string";
    let enumValues: string[] | undefined;

    if (resolved instanceof z.ZodString) {
      type = "string";
    } else if (resolved instanceof z.ZodNumber) {
      type = "number";
    } else if (resolved instanceof z.ZodBoolean) {
      type = "boolean";
    } else if (resolved instanceof z.ZodEnum) {
      type = "string";
      enumValues = resolved.options as string[];
    }

    const desc = (rawField as { description?: string }).description;

    params[key] = {
      type,
      required,
      ...(desc && { description: desc }),
      ...(defaultValue !== undefined && { default: defaultValue }),
      ...(enumValues && { enum: enumValues }),
    };
  }

  return params;
}

type AnyTool = {
  description?: string;
  execute?: (input: Record<string, unknown>) => Promise<unknown>;
};

export function describeTool(
  name: string,
  tool: AnyTool,
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
  available: boolean,
): ToolDescriptor {
  return {
    name,
    description: tool.description ?? name,
    parameters: zodToParams(schema),
    available,
    execute: tool.execute ?? (() => Promise.resolve(null)),
  };
}
