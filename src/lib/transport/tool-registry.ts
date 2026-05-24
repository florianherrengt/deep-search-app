import { type LanguageModel, type ToolSet } from "ai";
import { questionsTool } from "@/tools/questions-tool";
import {
  braveSearchTool,
  getBraveApiKey,
} from "@/tools/brave-search-tool";
import { disambiguateTool } from "@/tools/disambiguate-tool";
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
import { createExtractPageContentTool } from "@/tools/extract-page-content-tool";
import { createSaveResearchFileTool } from "@/tools/research-file-tool";
import { createResearchCheckpointTool } from "@/tools/research-checkpoint-tool";
import { createSequentialThinkingTool } from "@/tools/sequential-thinking-tool";
import { createSearchResearchTool } from "@/tools/search-research-tool";
import { createSwitchResearchFolderTool } from "@/tools/switch-research-folder-tool";

export function createTools({
  model,
  getResearchFolder,
  switchResearchFolder,
  apiKey,
}: {
  model: LanguageModel;
  getResearchFolder: () => Promise<string>;
  switchResearchFolder: (folderName: string) => void;
  apiKey: string;
}) {
  return {
    ask_questions: questionsTool,
    disambiguate: disambiguateTool,
    ...(getBraveApiKey() ? { brave_search: braveSearchTool } : {}),
    ...(getExaApiKey() ? { exa_search: exaSearchTool } : {}),
    ...(getSerperApiKey() ? { serper_search: serperSearchTool } : {}),
    ...(getTavilyApiKey() ? { tavily_search: tavilySearchTool } : {}),
    ...(getSearXNGBaseUrl() ? { searxng_search: searxngSearchTool } : {}),
    extract_page_content: createExtractPageContentTool(model, getResearchFolder),
    save_research_file: createSaveResearchFileTool(getResearchFolder, apiKey),
    research_checkpoint: createResearchCheckpointTool(model),
    sequential_thinking: createSequentialThinkingTool(),
    search_research: createSearchResearchTool(apiKey),
    switch_research_folder: createSwitchResearchFolderTool(switchResearchFolder),
  } as const satisfies ToolSet;
}

export type AppToolSet = ReturnType<typeof createTools>;
