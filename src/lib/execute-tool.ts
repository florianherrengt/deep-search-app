import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import {
  braveSearchTool,
  getBraveApiKey,
} from "@/tools/brave-search-tool";
import {
  exaSearchTool,
  getExaApiKey,
} from "@/tools/exa-search-tool";
import {
  serperSearchTool,
  getSerperApiKey,
} from "@/tools/serper-search-tool";
import {
  tavilySearchTool,
  getTavilyApiKey,
} from "@/tools/tavily-search-tool";
import {
  searxngSearchTool,
  getSearXNGBaseUrl,
} from "@/tools/searxng-search-tool";
import { disambiguateTool } from "@/tools/disambiguate-tool";
import {
  SafePathSegmentSchema,
  writeAppFile,
  listAppSubfolders,
} from "@/lib/app-file-storage";
import { indexResearchFile } from "@/lib/research-search";
import { SEARCH_RESULTS_SUBFOLDER } from "@/lib/research-history";

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

export interface ToolExecuteConfig {
  researchFolder: string | null;
  apiKey: string;
}

function zodToParams(schema: z.ZodObject<Record<string, z.ZodTypeAny>>): Record<string, ToolParameter> {
  const params: Record<string, ToolParameter> = {};

  for (const [key, rawField] of Object.entries(schema.shape)) {
    const field = rawField;
    let required = true;
    let defaultValue: unknown = undefined;

    const isOptional = field instanceof z.ZodOptional;
    const inner = isOptional ? field.unwrap() : field;
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

function makeDescriptor(
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

export function getAvailableTools(config?: ToolExecuteConfig): ToolDescriptor[] {
  const researchFolder = config?.researchFolder;
  const apiKey = config?.apiKey;

  return [
    makeDescriptor("brave_search", braveSearchTool as unknown as AnyTool, z.object({ query: z.string() }), !!getBraveApiKey()),
    makeDescriptor("exa_search", exaSearchTool as unknown as AnyTool, z.object({ query: z.string() }), !!getExaApiKey()),
    makeDescriptor("serper_search", serperSearchTool as unknown as AnyTool, z.object({ query: z.string() }), !!getSerperApiKey()),
    makeDescriptor("tavily_search", tavilySearchTool as unknown as AnyTool, z.object({ query: z.string() }), !!getTavilyApiKey()),
    makeDescriptor("searxng_search", searxngSearchTool as unknown as AnyTool, z.object({ query: z.string() }), !!getSearXNGBaseUrl() && getSearXNGBaseUrl() !== "http://localhost:8080"),
    makeDescriptor("disambiguate", disambiguateTool as unknown as AnyTool, z.object({ question: z.string() }), true),

    {
      name: "extract_page_content",
      description: "Extract the text content of a web page. Uses custom extractors and webview fallback where needed.",
      parameters: {
        url: { type: "string", required: true, description: "URL to extract content from" },
      },
      available: true,
      execute: async (params) => {
        const { extractPageContent } = await import("@/tools/extract-page-content-tool");
        const url = params.url as string;
        const markdown = await extractPageContent(url, {
          summarize: false,
          getResearchFolder: researchFolder ? async () => researchFolder : undefined,
        });
        if (!markdown) throw new Error("Failed to extract page");

        return markdown;
      },
    },

    {
      name: "sequential_thinking",
      description: "Dynamic and reflective problem-solving through structured thoughts.",
      parameters: {
        thought: { type: "string", required: true, description: "Your current thinking step" },
        nextThoughtNeeded: { type: "boolean", required: true, description: "Whether another thought step is needed" },
        thoughtNumber: { type: "number", required: true, description: "Current thought number" },
        totalThoughts: { type: "number", required: true, description: "Estimated total thoughts needed" },
        isRevision: { type: "boolean", required: false, description: "Whether this thought revises previous thinking" },
        revisesThought: { type: "number", required: false, description: "Which thought number is being reconsidered" },
        branchFromThought: { type: "number", required: false, description: "Thought number to branch from" },
        branchId: { type: "string", required: false, description: "Identifier for the current branch" },
        needsMoreThoughts: { type: "boolean", required: false, description: "If more thoughts are needed" },
      },
      available: true,
      execute: async (params) => {
        const tool = await import("@/tools/sequential-thinking-tool");
        const instance = tool.createSequentialThinkingTool();
        const exec = instance.execute as (input: Record<string, unknown>) => Promise<unknown>;
        return exec(params);
      },
    },

    {
      name: "search_research",
      description: "Search across all past research sessions for matching research folders.",
      parameters: {
        query: { type: "string", required: true, description: "Natural language search query" },
        folder: { type: "string", required: false, description: "Limit to a specific research folder" },
        limit: { type: "number", required: false, description: "Max results (default 8)" },
      },
      available: !!apiKey,
      execute: async (params) => {
        type RawResult = { folder_name: string };
        const results = await invoke<RawResult[]>("search_research", {
          apiKey,
          query: params.query,
          folder: params.folder ?? null,
          limit: params.limit ?? 8,
        }).catch(() => []);

        const seen = new Set<string>();
        return results.flatMap((r) => {
          if (seen.has(r.folder_name)) return [];
          seen.add(r.folder_name);
          return [{ folder_name: r.folder_name }];
        });
      },
    },

    {
      name: "save_research_file",
      description: "Save a file to the current research folder.",
      parameters: {
        filename: { type: "string", required: true, description: "Filename, e.g. 'notes.md'" },
        content: { type: "string", required: true, description: "File content to write" },
      },
      available: !!researchFolder,
      execute: async (params) => {
        if (!researchFolder) throw new Error("No research folder selected");
        const filename = SafePathSegmentSchema.parse(params.filename as string);
        const content = params.content as string;
        const subfolder = `search-results/${researchFolder}`;

        await writeAppFile({ subfolder, filename, content });

        if (apiKey) {
          await indexResearchFile(apiKey, researchFolder, filename, content).catch(() => {});
        }

        return { savedTo: `AppData/${subfolder}/${filename}` };
      },
    },

    {
      name: "switch_research_folder",
      description: "Check if a research folder exists.",
      parameters: {
        folder: { type: "string", required: true, description: "Research folder name" },
      },
      available: true,
      execute: async (params) => {
        const folder = SafePathSegmentSchema.parse(params.folder as string);
        const folders = await listAppSubfolders({ subfolder: SEARCH_RESULTS_SUBFOLDER });
        const exists = folders.includes(folder);
        return { folder, exists, availableFolders: folders };
      },
    },

    {
      name: "research_checkpoint",
      description: "Submit a research quality checkpoint (standalone: returns input as-is without LLM review).",
      parameters: {
        originalQuestion: { type: "string", required: true, description: "The original research question" },
        searchesRun: { type: "string", required: false, description: "Comma-separated list of searches run" },
        sourcesOpened: { type: "string", required: false, description: "Comma-separated list of source URLs" },
        claimsVerified: { type: "string", required: false, description: "Comma-separated list of verified claims" },
        unresolvedQuestions: { type: "string", required: false, description: "Comma-separated list of unresolved questions" },
        confidence: { type: "string", required: false, description: "Confidence level", enum: ["low", "medium", "high"] },
        readyToAnswer: { type: "boolean", required: true, description: "Whether you're ready to answer" },
      },
      available: true,
      execute: async (params) => {
        return {
          received: params,
          note: "Standalone mode: no LLM review performed. Input echoed back.",
        };
      },
    },
  ];
}
