import { type LanguageModel, type ToolSet } from "ai";
import {
  questionsTool,
  createDisambiguateTool,
  createSearchTools,
  createSequentialThinkingTool,
  createResearchCheckpointTool,
  type SearchKeys as PkgSearchKeys,
} from "deep-search-core/research-orchestrator";
import { fetch as bridgeFetch, isTauri } from "@/lib/tauri-bridge";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { createCreateFileTool, createReadFileTool, createUpdateFileTool, createMoveFileTool, createDeleteFileTool, createListFilesTool } from "@/tools/file-tools";
import { createLoadSkillTool } from "@/tools/load-skill-tool";
import { createSearchResearchTool } from "@/tools/search-research-tool";
import { createAggregateSearchTool } from "@/tools/aggregate-search-tool";
import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";
import { createCurrencyConversionTool } from "@/tools/currency-conversion-tool";
import { createConfiguredGoogleSearchTool } from "@/tools/google-search-tool";
import {
  createFactsCheckTool,
  createResearchPlanTool,
} from "@/tools/core-research-tools";
import { applyToolCallRequirementSafeguards } from "@/lib/tool-call-requirements";
import type { Currency, ChromeMcpConnectionMode, WebExtractionBackend } from "@/lib/settings-store";
import { createChromeDevToolsMcpTools } from "@/lib/mcp/chrome-devtools-tools";
import { TOOL_NAMES } from "@/lib/tool-names";
import {
  AGGREGATE_SEARCH_SOURCE_GUIDANCE,
  GENERAL_WEB_SEARCH_SOURCE_GUIDANCE,
  YOUTUBE_SEARCH_SOURCE_GUIDANCE,
} from "@/lib/research-source-guidance";
import type { SubAgentEmitter } from "@/lib/sub-agent-emitter";

type CoreLanguageModel = Parameters<typeof createResearchPlanTool>[0];

const RESEARCH_CHECKPOINT_INTERNAL_RETRY_GUIDANCE =
  "If the current instruction starts with `Internal guardrail retry`, treat it as app-generated repair guidance. Use the latest real user request for originalQuestion, not the retry text.";

export interface SearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  youtubeApiKey?: string | null;
  scrapeDoApiKey?: string | null;
  youtubeYtDlpPath?: string | null;
  searxngBaseUrl?: string | null;
  currency?: Currency;
  googleSearchEnabled?: boolean;
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

function appendToolDescription<T extends ToolSet[string]>(
  appTool: T | undefined,
  extra: string,
): T | undefined {
  if (!appTool) return undefined;

  return {
    ...appTool,
    description: [appTool.description, extra].filter(Boolean).join("\n\n"),
  } as T;
}

function addSourceCoverageDescriptions(searchTools: ToolSet): void {
  for (const toolName of [
    TOOL_NAMES.brave_search,
    TOOL_NAMES.exa_search,
    TOOL_NAMES.serper_search,
    TOOL_NAMES.tavily_search,
    TOOL_NAMES.searxng_search,
    TOOL_NAMES.google_search,
  ]) {
    const searchTool = appendToolDescription(
      searchTools[toolName],
      GENERAL_WEB_SEARCH_SOURCE_GUIDANCE,
    );
    if (searchTool) {
      searchTools[toolName] = searchTool;
    }
  }

  const youtubeSearchTool = appendToolDescription(
    searchTools[TOOL_NAMES.youtube_search],
    YOUTUBE_SEARCH_SOURCE_GUIDANCE,
  );
  if (youtubeSearchTool) {
    searchTools[TOOL_NAMES.youtube_search] = youtubeSearchTool;
  }
}

export async function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  searchKeys,
  emitEvent,
  authorizedResearchFolderSwitches,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void | Promise<void>;
  searchKeys?: SearchToolKeys;
  emitEvent?: SubAgentEmitter;
  authorizedResearchFolderSwitches?: ReadonlySet<string>;
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
        youtubeApiKey: searchKeys.youtubeApiKey ?? undefined,
        searxngBaseUrl: searchKeys.searxngBaseUrl ?? undefined,
    }
    : undefined;

  const providerSearchTools = asAppToolSet(
    createSearchTools(pkgSearchKeys, bridgeFetch),
  );
  delete providerSearchTools.aggregate_search;
  const searchTools: ToolSet = {};
  if (isTauri() && searchKeys?.googleSearchEnabled !== false) {
    searchTools[TOOL_NAMES.google_search] = asAppTool(
      createConfiguredGoogleSearchTool(model, searchKeys, { emitEvent }),
    );
  }
  Object.assign(searchTools, providerSearchTools);
  addSourceCoverageDescriptions(searchTools);
  const aggregateSearchTool = appendToolDescription(
    createAggregateSearchTool(pkgSearchKeys),
    AGGREGATE_SEARCH_SOURCE_GUIDANCE,
  );
  const coreModel = model as unknown as CoreLanguageModel;
  const baseResearchCheckpointTool = asAppTool(
    createResearchCheckpointTool(coreModel),
  );
  const researchCheckpointTool =
    appendToolDescription(
      baseResearchCheckpointTool,
      RESEARCH_CHECKPOINT_INTERNAL_RETRY_GUIDANCE,
    ) ?? baseResearchCheckpointTool;
  const currencyConversionTools: ToolSet = {};
  if (searchKeys?.currency) {
    currencyConversionTools.currency_conversion = asAppTool(
      createCurrencyConversionTool(searchKeys.currency),
    );
  }

  const tools = {
    ask_questions: asAppTool(questionsTool),
    disambiguate: asAppTool(createDisambiguateTool(bridgeFetch)),
    ...searchTools,
    ...(aggregateSearchTool
      ? { aggregate_search: asAppTool(aggregateSearchTool) }
      : {}),
    sequential_thinking: asAppTool(createSequentialThinkingTool()),
    create_research_plan: asAppTool(createResearchPlanTool(coreModel, { emitEvent })),
    research_checkpoint: researchCheckpointTool,

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
      {
        ytDlpPath: searchKeys?.youtubeYtDlpPath ?? undefined,
      },
      { emitEvent },
    ),
    facts_check: createFactsCheckTool(model, searchKeys?.scrapeDoApiKey ?? undefined),
    create_file: createCreateFileTool(getResearchFolder),
    read_file: createReadFileTool(getResearchFolder),
    update_file: createUpdateFileTool(getResearchFolder),
    move_file: createMoveFileTool(getResearchFolder),
    delete_file: createDeleteFileTool(getResearchFolder),
    list_files: createListFilesTool(getResearchFolder),
    load_skill: createLoadSkillTool(),
    search_research: createSearchResearchTool(getResearchFolder),
    switch_research_folder: createSwitchResearchFolderTool(
      switchResearchFolder,
      (folderName) =>
        authorizedResearchFolderSwitches?.has(folderName) === true,
    ),
    ...currencyConversionTools,
    ...chromeDevToolsTools,
  } as const satisfies ToolSet;

  return applyToolCallRequirementSafeguards(tools);
}

export type AppToolSet = Awaited<ReturnType<typeof createTools>>;
