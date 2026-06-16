import { type LanguageModel, type ToolSet } from "ai";
import { questionsTool } from "@/tools/questions-tool";
import { createBraveSearchTool } from "@/tools/brave-search-tool";
import { disambiguateTool } from "@/tools/disambiguate-tool";
import { createExaSearchTool } from "@/tools/exa-search-tool";
import { createSerperSearchTool } from "@/tools/serper-search-tool";
import { createTavilySearchTool } from "@/tools/tavily-search-tool";
import { createSearXNGSearchTool } from "@/tools/searxng-search-tool";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { createCreateFileTool, createReadFileTool, createUpdateFileTool, createMoveFileTool, createDeleteFileTool, createListFilesTool } from "@/tools/file-tools";
import { createResearchCheckpointTool } from "@/tools/research-checkpoint-tool";
import { createSequentialThinkingTool } from "@/tools/sequential-thinking-tool";
import { createLoadSkillTool } from "@/tools/load-skill-tool";
import { createSearchResearchTool } from "@/tools/search-research-tool";
import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";
import { createResearchPlanTool } from "@/tools/research-plan-tool";
import { createCurrencyConversionTool } from "@/tools/currency-conversion-tool";
import { createFactsCheckTool } from "@/tools/facts-check-tool";
import { applyToolCallRequirementSafeguards } from "@/lib/tool-call-requirements";
import { isValidServiceUrl } from "@/lib/url-validation";
import type { Currency, ChromeMcpConnectionMode } from "@/lib/settings-store";
import type { EmbeddingConfig, RerankerConfig } from "@/lib/research-search";
import { createChromeDevToolsMcpTools } from "@/lib/mcp/chrome-devtools-tools";

export interface SearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
  currency?: Currency;
  chromeDevToolsMcpEnabled?: boolean;
  chromeDevToolsMcpConnectionMode?: ChromeMcpConnectionMode;
  chromeDevToolsMcpBrowserUrl?: string | null;
}

export async function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  embeddingConfig,
  rerankerConfig,
  searchKeys,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void | Promise<void>;
  embeddingConfig: EmbeddingConfig;
  rerankerConfig: RerankerConfig;
  searchKeys?: SearchToolKeys;
}) {
  const chromeDevToolsToolsRaw = await createChromeDevToolsMcpTools({
    enabled: Boolean(searchKeys?.chromeDevToolsMcpEnabled),
    connectionMode: searchKeys?.chromeDevToolsMcpConnectionMode,
    browserUrl: searchKeys?.chromeDevToolsMcpBrowserUrl ?? undefined,
  });
  const chromeDevToolsTools: ToolSet = {};
  for (const [name, t] of Object.entries(chromeDevToolsToolsRaw)) {
    chromeDevToolsTools[name] = t as any;
  }
  const tools = {
    ask_questions: questionsTool,
    disambiguate: disambiguateTool,
    ...(searchKeys?.braveApiKey ? { brave_search: createBraveSearchTool(searchKeys.braveApiKey) } : {}),
    ...(searchKeys?.exaApiKey ? { exa_search: createExaSearchTool(searchKeys.exaApiKey) } : {}),
    ...(searchKeys?.serperApiKey ? { serper_search: createSerperSearchTool(searchKeys.serperApiKey) } : {}),
    ...(searchKeys?.tavilyApiKey ? { tavily_search: createTavilySearchTool(searchKeys.tavilyApiKey) } : {}),
    ...(searchKeys?.searxngBaseUrl && isValidServiceUrl(searchKeys.searxngBaseUrl) ? { searxng_search: createSearXNGSearchTool(searchKeys.searxngBaseUrl) } : {}),
    extract_page_content: createExtractPageContentTool(model, getResearchFolder),
    create_file: createCreateFileTool(getResearchFolder, embeddingConfig),
    read_file: createReadFileTool(getResearchFolder),
    update_file: createUpdateFileTool(getResearchFolder, embeddingConfig),
    move_file: createMoveFileTool(getResearchFolder, embeddingConfig),
    delete_file: createDeleteFileTool(getResearchFolder),
    list_files: createListFilesTool(getResearchFolder),
    research_checkpoint: createResearchCheckpointTool(model),
    sequential_thinking: createSequentialThinkingTool(),
    load_skill: createLoadSkillTool(),
    search_research: createSearchResearchTool(embeddingConfig, rerankerConfig, model),
    switch_research_folder: createSwitchResearchFolderTool(switchResearchFolder),
    create_research_plan: createResearchPlanTool(model),
    facts_check: createFactsCheckTool(model),
    currency_conversion: createCurrencyConversionTool(searchKeys?.currency ?? "USD"),
    ...chromeDevToolsTools,
  } as const satisfies ToolSet;

  return applyToolCallRequirementSafeguards(tools);
}

export type AppToolSet = Awaited<ReturnType<typeof createTools>>;
