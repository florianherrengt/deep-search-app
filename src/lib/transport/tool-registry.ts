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
import { createRenameResearchFolderTool } from "@/tools/rename-research-folder-tool";
import { createResearchPlanTool } from "@/tools/research-plan-tool";
import { createCurrencyConversionTool } from "@/tools/currency-conversion-tool";
import { createVerifiedResearchIsGoodTool } from "@/tools/verified-research-tool";
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
  chromeDevToolsMcpEnabled?: boolean;
}

export async function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  onFolderRenamed,
  apiKey,
  searchKeys,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void | Promise<void>;
  onFolderRenamed: (newName: string) => void | Promise<void>;
  apiKey: string;
  searchKeys?: SearchToolKeys;
}) {
  const chromeDevToolsTools = await createChromeDevToolsMcpTools({
    enabled: Boolean(searchKeys?.chromeDevToolsMcpEnabled),
  });
  const tools = {
    ask_questions: questionsTool,
    disambiguate: disambiguateTool,
    ...(searchKeys?.braveApiKey ? { brave_search: createBraveSearchTool(searchKeys.braveApiKey) } : {}),
    ...(searchKeys?.exaApiKey ? { exa_search: createExaSearchTool(searchKeys.exaApiKey) } : {}),
    ...(searchKeys?.serperApiKey ? { serper_search: createSerperSearchTool(searchKeys.serperApiKey) } : {}),
    ...(searchKeys?.tavilyApiKey ? { tavily_search: createTavilySearchTool(searchKeys.tavilyApiKey) } : {}),
    ...(searchKeys?.searxngBaseUrl && isValidServiceUrl(searchKeys.searxngBaseUrl) ? { searxng_search: createSearXNGSearchTool(searchKeys.searxngBaseUrl) } : {}),
    extract_page_content: createExtractPageContentTool(model, getResearchFolder),
    create_file: createCreateFileTool(getResearchFolder, apiKey),
    read_file: createReadFileTool(getResearchFolder),
    update_file: createUpdateFileTool(getResearchFolder, apiKey),
    move_file: createMoveFileTool(getResearchFolder, apiKey),
    delete_file: createDeleteFileTool(getResearchFolder),
    list_files: createListFilesTool(getResearchFolder),
    research_checkpoint: createResearchCheckpointTool(model),
    sequential_thinking: createSequentialThinkingTool(),
    load_skill: createLoadSkillTool(),
    search_research: createSearchResearchTool(apiKey, model),
    switch_research_folder: createSwitchResearchFolderTool(switchResearchFolder),
    rename_research_folder: createRenameResearchFolderTool({
      getResearchFolder,
      onFolderRenamed,
      apiKey,
    }),
    create_research_plan: createResearchPlanTool(model),
    verified_research_is_good: createVerifiedResearchIsGoodTool(model, searchKeys),
    currency_conversion: createCurrencyConversionTool(searchKeys?.currency ?? "USD"),
    ...chromeDevToolsTools,
  } as const satisfies ToolSet;

  return applyToolCallRequirementSafeguards(tools);
}

export type AppToolSet = Awaited<ReturnType<typeof createTools>>;
