import { type LanguageModel, type ToolSet } from "ai";
import { questionsTool } from "@/tools/questions-tool";
import { createBraveSearchTool } from "@/tools/brave-search-tool";
import { disambiguateTool } from "@/tools/disambiguate-tool";
import { createExaSearchTool } from "@/tools/exa-search-tool";
import { createSerperSearchTool } from "@/tools/serper-search-tool";
import { createTavilySearchTool } from "@/tools/tavily-search-tool";
import { createSearXNGSearchTool } from "@/tools/searxng-search-tool";
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { createSaveResearchFileTool } from "@/tools/research-file-tool";
import { createResearchCheckpointTool } from "@/tools/research-checkpoint-tool";
import { createSequentialThinkingTool } from "@/tools/sequential-thinking-tool";
import { createSearchResearchTool } from "@/tools/search-research-tool";
import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";
import { createResearchPlanTool } from "@/tools/research-plan-tool";
import { createCurrencyConversionTool } from "@/tools/currency-conversion-tool";
import { applyToolCallRequirementSafeguards } from "@/lib/tool-call-requirements";
import { isValidServiceUrl } from "@/lib/url-validation";
import type { Currency } from "@/lib/settings-store";
import { createChromeDevToolsMcpTools } from "@/lib/mcp/chrome-devtools-tools";

export interface SearchToolKeys {
  braveApiKey?: string | null;
  exaApiKey?: string | null;
  serperApiKey?: string | null;
  tavilyApiKey?: string | null;
  searxngBaseUrl?: string | null;
  currency?: Currency;
}

export async function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  apiKey,
  searchKeys,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void;
  apiKey: string;
  searchKeys?: SearchToolKeys;
}) {
  const chromeDevToolsTools = await createChromeDevToolsMcpTools();
  const tools = {
    ask_questions: questionsTool,
    disambiguate: disambiguateTool,
    ...(searchKeys?.braveApiKey ? { brave_search: createBraveSearchTool(searchKeys.braveApiKey) } : {}),
    ...(searchKeys?.exaApiKey ? { exa_search: createExaSearchTool(searchKeys.exaApiKey) } : {}),
    ...(searchKeys?.serperApiKey ? { serper_search: createSerperSearchTool(searchKeys.serperApiKey) } : {}),
    ...(searchKeys?.tavilyApiKey ? { tavily_search: createTavilySearchTool(searchKeys.tavilyApiKey) } : {}),
    ...(searchKeys?.searxngBaseUrl && isValidServiceUrl(searchKeys.searxngBaseUrl) ? { searxng_search: createSearXNGSearchTool(searchKeys.searxngBaseUrl) } : {}),
    extract_page_content: createExtractPageContentTool(model, getResearchFolder),
    save_research_file: createSaveResearchFileTool(getResearchFolder, apiKey),
    research_checkpoint: createResearchCheckpointTool(model),
    sequential_thinking: createSequentialThinkingTool(),
    search_research: createSearchResearchTool(apiKey),
    switch_research_folder: createSwitchResearchFolderTool(switchResearchFolder),
    create_research_plan: createResearchPlanTool(model),
    currency_conversion: createCurrencyConversionTool(searchKeys?.currency ?? "USD"),
    ...chromeDevToolsTools,
  } as const satisfies ToolSet;

  return applyToolCallRequirementSafeguards(tools);
}

export type AppToolSet = Awaited<ReturnType<typeof createTools>>;
