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

function resolveParameterSchema(rawField: z.ZodTypeAny) {
  const isOptional = rawField instanceof z.ZodOptional;
  const inner = isOptional ? rawField.unwrap() : rawField;
  const defaultSchema = inner instanceof z.ZodDefault ? inner : null;

  return {
    resolved: (defaultSchema ? defaultSchema.unwrap() : inner) as z.ZodTypeAny,
    required: !isOptional && !defaultSchema,
    defaultValue: defaultSchema ? defaultSchema.parse(undefined) : undefined,
  };
}

function describeParameterType(
  resolved: z.ZodTypeAny,
): Pick<ToolParameter, "type" | "enum"> {
  if (resolved instanceof z.ZodNumber) {
    return { type: "number" };
  }

  if (resolved instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }

  if (resolved instanceof z.ZodEnum) {
    return { type: "string", enum: resolved.options.map(String) };
  }

  return { type: "string" };
}

export function zodToParams(
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
): Record<string, ToolParameter> {
  const params: Record<string, ToolParameter> = {};

  for (const [key, rawField] of Object.entries(schema.shape)) {
    const { resolved, required, defaultValue } =
      resolveParameterSchema(rawField);
    const desc = (rawField as { description?: string }).description;

    params[key] = {
      ...describeParameterType(resolved),
      required,
      ...(desc && { description: desc }),
      ...(defaultValue !== undefined && { default: defaultValue }),
    };
  }

  return params;
}

type AnyTool = {
  description?: unknown;
  execute?: unknown;
};

type ToolExecutor = (
  input: Record<string, unknown>,
) => unknown | Promise<unknown>;

function asToolLike(tool: unknown): AnyTool {
  return tool && typeof tool === "object" ? (tool as AnyTool) : {};
}

export function describeTool(
  name: string,
  tool: unknown,
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
  available: boolean,
): ToolDescriptor {
  const toolLike = asToolLike(tool);
  const toolExecute = toolLike.execute as ToolExecutor;
  const execute =
    typeof toolLike.execute === "function"
      ? (params: Record<string, unknown>) => Promise.resolve(toolExecute(params))
      : () => Promise.resolve(null);

  return {
    name,
    description:
      typeof toolLike.description === "string" ? toolLike.description : name,
    parameters: zodToParams(schema),
    available,
    execute,
  };
}
