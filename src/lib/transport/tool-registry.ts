import { type LanguageModel, type ToolSet } from "ai";
import {
  questionsTool,
  createDisambiguateTool,
  createSearchTools,
  createSequentialThinkingTool,
  createResearchPlanTool,
  createResearchCheckpointTool,
  type SearchKeys as PkgSearchKeys,
} from "deep-search-core/research-orchestrator";
import { fetch as bridgeFetch } from "@/lib/tauri-bridge";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { createCreateFileTool, createReadFileTool, createUpdateFileTool, createMoveFileTool, createDeleteFileTool, createListFilesTool } from "@/tools/file-tools";
import { createLoadSkillTool } from "@/tools/load-skill-tool";
import { createSearchResearchTool } from "@/tools/search-research-tool";
import { createAggregateSearchTool } from "@/tools/aggregate-search-tool";
import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";
import { createCurrencyConversionTool } from "@/tools/currency-conversion-tool";
import { createFactsCheckTool } from "@/tools/facts-check-tool";
import { applyToolCallRequirementSafeguards } from "@/lib/tool-call-requirements";
import type { Currency, ChromeMcpConnectionMode, WebExtractionBackend } from "@/lib/settings-store";
import { createChromeDevToolsMcpTools } from "@/lib/mcp/chrome-devtools-tools";

type CoreLanguageModel = Parameters<typeof createResearchPlanTool>[0];

export interface SearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  scrapeDoApiKey?: string | null;
  searxngBaseUrl?: string | null;
  currency?: Currency;
  chromeDevToolsMcpEnabled?: boolean;
  chromeDevToolsMcpConnectionMode?: ChromeMcpConnectionMode;
  chromeDevToolsMcpBrowserUrl?: string | null;
  chromeDevToolsMcpNodePath?: string | null;
  webExtractionBackend?: WebExtractionBackend;
}

function asAppTool(tool: unknown): ToolSet[string] {
  return tool as ToolSet[string];
}

function asAppToolSet(tools: unknown): ToolSet {
  return tools as ToolSet;
}

export async function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  searchKeys,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void | Promise<void>;
  searchKeys?: SearchToolKeys;
}) {
  const chromeDevToolsToolsRaw = await createChromeDevToolsMcpTools({
    enabled: Boolean(searchKeys?.chromeDevToolsMcpEnabled),
    connectionMode: searchKeys?.chromeDevToolsMcpConnectionMode,
    browserUrl: searchKeys?.chromeDevToolsMcpBrowserUrl ?? undefined,
    nodePath: searchKeys?.chromeDevToolsMcpNodePath ?? undefined,
  });
  const chromeDevToolsTools: ToolSet = {};
  for (const [name, t] of Object.entries(chromeDevToolsToolsRaw)) {
    chromeDevToolsTools[name] = t as any;
  }

  const pkgSearchKeys: PkgSearchKeys | undefined = searchKeys
    ? {
        braveApiKey: searchKeys.braveApiKey ?? undefined,
        exaApiKey: searchKeys.exaApiKey ?? undefined,
        serperApiKey: searchKeys.serperApiKey ?? undefined,
        tavilyApiKey: searchKeys.tavilyApiKey ?? undefined,
        searxngBaseUrl: searchKeys.searxngBaseUrl ?? undefined,
    }
    : undefined;

  const searchTools = asAppToolSet(createSearchTools(pkgSearchKeys, bridgeFetch));
  delete searchTools.aggregate_search;
  const aggregateSearchTool = createAggregateSearchTool(pkgSearchKeys);
  const coreModel = model as unknown as CoreLanguageModel;

  const tools = {
    ask_questions: asAppTool(questionsTool),
    disambiguate: asAppTool(createDisambiguateTool(bridgeFetch)),
    ...searchTools,
    ...(aggregateSearchTool
      ? { aggregate_search: asAppTool(aggregateSearchTool) }
      : {}),
    sequential_thinking: asAppTool(createSequentialThinkingTool()),
    create_research_plan: asAppTool(createResearchPlanTool(coreModel)),
    research_checkpoint: asAppTool(createResearchCheckpointTool(coreModel)),

    extract_page_content: createExtractPageContentTool(
      model,
      getResearchFolder,
      searchKeys?.chromeDevToolsMcpEnabled
        ? {
            enabled: true,
            connectionMode: searchKeys.chromeDevToolsMcpConnectionMode,
            browserUrl: searchKeys.chromeDevToolsMcpBrowserUrl ?? undefined,
            nodePath: searchKeys.chromeDevToolsMcpNodePath ?? undefined,
            backend: searchKeys?.webExtractionBackend ?? "tauri-webview",
          }
        : undefined,
      searchKeys?.scrapeDoApiKey ?? undefined,
    ),
    facts_check: createFactsCheckTool(model, searchKeys?.scrapeDoApiKey ?? undefined),
    create_file: createCreateFileTool(getResearchFolder),
    read_file: createReadFileTool(getResearchFolder),
    update_file: createUpdateFileTool(getResearchFolder),
    move_file: createMoveFileTool(getResearchFolder),
    delete_file: createDeleteFileTool(getResearchFolder),
    list_files: createListFilesTool(getResearchFolder),
    load_skill: createLoadSkillTool(),
    search_research: createSearchResearchTool(model, getResearchFolder),
    switch_research_folder: createSwitchResearchFolderTool(switchResearchFolder),
    currency_conversion: createCurrencyConversionTool(searchKeys?.currency ?? "USD"),
    ...chromeDevToolsTools,
  } as const satisfies ToolSet;

  return applyToolCallRequirementSafeguards(tools);
}

export type AppToolSet = Awaited<ReturnType<typeof createTools>>;
