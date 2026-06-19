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

type JsonSchemaObject = {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
};

function jsonSchemaPropToToolParam(
  prop: JsonSchemaObject,
  required: boolean,
): ToolParameter {
  const result: ToolParameter = {
    type:
      prop.type === "integer" || prop.type === "number"
        ? "number"
        : prop.type === "boolean"
          ? "boolean"
          : "string",
    required,
  };
  if (prop.description) result.description = prop.description;
  if (prop.default !== undefined) result.default = prop.default;
  if (Array.isArray(prop.enum)) {
    result.enum = prop.enum.map((v) => String(v));
  }
  return result;
}

export function zodToParams(
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
): Record<string, ToolParameter> {
  const json = z.toJSONSchema(schema) as {
    properties?: Record<string, JsonSchemaObject>;
    required?: string[];
  };
  const requiredSet = new Set(json.required ?? []);
  const params: Record<string, ToolParameter> = {};
  for (const [key, prop] of Object.entries(json.properties ?? {})) {
    const required = requiredSet.has(key) && prop.default === undefined;
    params[key] = jsonSchemaPropToToolParam(prop, required);
  }
  return params;
}

type AnyTool = {
  description?: unknown;
  execute?: unknown;
};

type ToolExecutor = (
  input: Record<string, unknown>,
  options?: Record<string, unknown>,
) => unknown | Promise<unknown>;

export function describeTool(
  name: string,
  tool: unknown,
  schema: z.ZodObject<Record<string, z.ZodTypeAny>>,
  available: boolean,
): ToolDescriptor {
  const toolLike = tool && typeof tool === "object" ? (tool as AnyTool) : {};
  const toolExecute = toolLike.execute as ToolExecutor;
  // The Tools panel calls execute(params) directly, but tool execute callbacks
  // may read options.toolCallId / options.abortSignal. Pass a defined (empty)
  // options object so those reads never hit "undefined is not an object".
  const execute =
    typeof toolLike.execute === "function"
      ? (params: Record<string, unknown>) =>
          Promise.resolve(toolExecute(params, {}))
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
